import fs from 'node:fs'
import { Command } from 'commander'
import os from 'node:os'
import path from 'node:path'
import {
  AppGeneratorHelper,
  runtimePrefixFor,
  type AppTemplateVariables,
} from '@src/bin/helper/app-generator.helper.js'
import { GeneratorCLI } from '@src/bin/generator.js'

const VARIABLES: AppTemplateVariables = {
  appName: 'my-cool-bot',
  displayName: 'My Cool Bot',
  version: '3.1.0',
  packageManager: 'bun',
  runtimePrefix: runtimePrefixFor('bun'),
}

describe('AppGeneratorHelper', () => {
  const helper = new AppGeneratorHelper()
  const targets: string[] = []
  let target: string
  let written: string[]

  beforeAll(() => {
    target = fs.mkdtempSync(path.join(os.tmpdir(), 'meocord-app-'))
    targets.push(target)
    written = helper.generateApp(target, VARIABLES)
  })

  afterAll(() => targets.forEach(dir => fs.rmSync(dir, { recursive: true, force: true })))

  const read = (relative: string) => fs.readFileSync(path.join(target, relative), 'utf8')

  it('writes the whole template', () => {
    expect(written.length).toBeGreaterThan(20)
    expect(written).toContain(path.join('src', 'main.ts'))
  })

  // The suffix marks a file as packaged; leaving it on would ship a project of
  // `.template` files that no toolchain recognises.
  it('drops the template suffix from every written name', () => {
    expect(written.filter(name => name.endsWith('.template'))).toEqual([])
  })

  // npm omits dotfiles from a published tarball, so they are packaged under a stand-in
  // prefix and have to come back as dotfiles here.
  it.each(['.gitignore', '.env.example', '.prettierrc.mjs'])('restores %s as a dotfile', name => {
    expect(fs.existsSync(path.join(target, name))).toBe(true)
  })

  it('names the package after the application', () => {
    expect(JSON.parse(read('package.json')).name).toBe('my-cool-bot')
  })

  // A scaffolded application has to depend on the framework that scaffolded it, so the
  // pinned version comes from the running CLI rather than from the template.
  it('pins the framework to the version doing the generating', () => {
    expect(JSON.parse(read('package.json')).dependencies.meocord).toBe('^3.1.0')
  })

  it('carries the readable name into the config and the readme', () => {
    expect(read('meocord.config.ts')).toContain("appName: 'My Cool Bot'")
    expect(read('README.md')).toContain('# My Cool Bot')
  })

  it('shows every generator in the readme, by its alias', () => {
    const generate = new GeneratorCLI('MeoCord').register(new Command()).commands.find(command => command.name() === 'generate')!
    const aliases = generate.commands.map(command => command.alias())

    expect(aliases).toContain('ob')
    for (const alias of aliases) expect(read('README.md')).toContain(`npx meocord g ${alias} `)
  })

  it('uses the chosen package manager in the readme', () => {
    expect(read('README.md')).toContain('bun run start:dev')
  })

  it('leaves no placeholder unsubstituted', () => {
    const unresolved = written.filter(name => /\{\{\w+\}\}/.test(read(name)))

    expect(unresolved).toEqual([])
  })

  // The token is read from the environment because this file is committed.
  it('puts the app\'s type declarations in src/types: the theme as a module, the assets as a script', () => {
    const theme = read('src/types/theme.d.ts')
    const assets = read('src/types/assets.d.ts')

    // An import makes the theme's `declare module` an augmentation; without one it would replace meocord/interface
    expect(theme.split('\n').find(line => line.trim() !== '' && !line.startsWith('//'))).toBe("import 'meocord/interface'")
    expect(theme).toContain("declare module 'meocord/interface'")
    // A wildcard module declaration only works in a file with no import or export
    expect(assets).not.toMatch(/^(import|export) /m)
    expect(assets).toMatch(/^declare module '\*\.png'/m)
    expect(fs.existsSync(path.join(target, 'src', 'assets.d.ts'))).toBe(false)
  })

  it('does not write a token into the committed config', () => {
    expect(read('meocord.config.ts')).toContain('process.env.DISCORD_TOKEN')
    expect(read('.gitignore')).toContain('.env')
  })

  // A parameter has to own its segment, so a pattern the framework rejects would leave
  // every generated application crashing on the first import.
  it('ships component patterns the framework accepts', () => {
    expect(read(path.join('src', 'controllers', 'button', 'sample.button.controller.ts'))).toContain(
      "@Command('button-with/{ownerId}', CommandType.BUTTON)",
    )
  })

  // The builder is reused by more than one @Command, so ignoring the name it is given
  // registers the same command twice and Discord rejects the payload.
  it('builds slash commands under the name they were registered with', () => {
    expect(read(path.join('src', 'controllers', 'slash', 'builders', 'sample.builder.ts'))).toContain(
      'setName(commandName)',
    )
  })
})

// Without `--bun`, bun honours the CLI's node interpreter line and hands it to node,
// which an image built on bun alone does not have.
describe('runtimePrefixFor', () => {
  it('puts the framework on bun when the project was created with bun', () => {
    expect(runtimePrefixFor('bun')).toBe('bun --bun ')
  })

  it.each(['npm', 'pnpm', 'yarn'])('adds nothing for %s, whose runtime is already node', pm => {
    expect(runtimePrefixFor(pm)).toBe('')
  })

  // The template writes `{{runtimePrefix}}meocord` with nothing between them, so the
  // separator has to come from the value or the two words run together.
  it('separates itself from the command that follows', () => {
    expect(runtimePrefixFor('bun').endsWith(' ')).toBe(true)
  })
})

describe('generated scripts', () => {
  const render = (packageManager: string) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meocord-scripts-'))
    new AppGeneratorHelper().generateApp(dir, {
      ...VARIABLES,
      packageManager,
      runtimePrefix: runtimePrefixFor(packageManager),
    })
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
    fs.rmSync(dir, { recursive: true, force: true })
    return manifest.scripts as Record<string, string>
  }

  it('runs the framework under bun for a bun project', () => {
    expect(render('bun')['start:dev']).toBe('bun --bun meocord start --dev')
  })

  // Only the framework's own commands move; the linter and the test runner are left
  // where they are rather than being dragged onto a runtime they were not chosen for.
  it('leaves the other scripts alone', () => {
    const scripts = render('bun')

    expect(scripts.test).toBe('vitest run')
    expect(scripts.lint).not.toContain('bun --bun')
  })

  it.each(['npm', 'pnpm', 'yarn'])('calls the framework directly for a %s project', pm => {
    expect(render(pm)['start:dev']).toBe('meocord start --dev')
  })

  // `npm start`, and a host that runs it, start the production build; building stays its own step
  it.each(['bun', 'npm', 'pnpm', 'yarn'])('starts the production build as the %s project\'s start script', pm => {
    const scripts = render(pm)
    expect(scripts.start).toBe(`${runtimePrefixFor(pm)}meocord start --prod`)
    expect(scripts.start).toBe(scripts['start:prod'])
  })
})
