import { existsSync, mkdtempSync, readFileSync, rmSync, appendFileSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { vi } from 'vitest'
import { ControllerType } from '@src/enum/controller.enum.js'
import { ControllerGeneratorHelper } from '@src/bin/helper/controller-generator.helper.js'
import { toClassName } from '@src/util/generator-cli.util.js'

describe('ControllerGeneratorHelper', () => {
  const helper = new ControllerGeneratorHelper()

  // The type list the CLI offers is derived from the enum, so a member without a
  // template file is not a compile error -- it is a crash the first time somebody
  // generates that controller.
  it.each(Object.values(ControllerType))('renders a template for the %s controller type', type => {
    const rendered = helper.buildControllerTemplate('Sample', type)

    expect(rendered).toContain('@Controller()')
    expect(rendered).toContain('Sample')
    expect(rendered).not.toContain('{{className}}')
  })

  // The generated spec file imports `<Name><Type>Controller`, derived from the type
  // rather than read from the template. A template that names its class anything else
  // produces a spec that does not compile.
  it.each(Object.values(ControllerType))('names the %s controller class the way its spec imports it', type => {
    const expected = `Sample${toClassName(type.replace(/-/g, ' '))}Controller`

    expect(helper.buildControllerTemplate('Sample', type)).toContain(`export class ${expected}`)
  })

  // Each controller imports its own builder, written beside it and named after it, wherever the
  // controller is nested.
  describe('builder import path', () => {
    const builderTypes = [ControllerType.SLASH, ControllerType.CONTEXT_MENU, ControllerType.PRIMARY_ENTRY_POINT]

    it.each(builderTypes)('imports the %s builder named after the controller', type => {
      const rendered = helper.buildControllerTemplate('Greeting', type)

      expect(rendered).toContain(`import { GreetingCommandBuilder } from '@src/controllers/${type}/builders/greeting.builder'`)
      expect(rendered).toContain("@Command('greeting', GreetingCommandBuilder)")
    })

    it.each(builderTypes)('follows a nested %s name to where the builder is written', type => {
      expect(helper.buildControllerTemplate('Profile', type, ['admin'])).toContain(
        `'@src/controllers/${type}/admin/builders/profile.builder'`,
      )
    })

    it('follows more than one level of nesting', () => {
      expect(helper.buildControllerTemplate('Profile', ControllerType.SLASH, ['admin', 'users'])).toContain(
        "'@src/controllers/slash/admin/users/builders/profile.builder'",
      )
    })
  })

  it('rejects a controller type it has no template for', () => {
    expect(() => helper.buildControllerTemplate('Sample', 'nope' as ControllerType)).toThrow(
      'Unsupported controller type: nope',
    )
  })

  describe('generating on disk', () => {
    let root: string

    beforeEach(() => {
      root = mkdtempSync(path.join(tmpdir(), 'meocord-generate-'))
      writeFileSync(path.join(root, 'package.json'), '{"name":"bot","private":true}')
      vi.spyOn(process, 'cwd').mockReturnValue(root)
      // A refusal ends the process; thrown here so the test sees it and nothing continues.
      vi.spyOn(process, 'exit').mockImplementation(code => {
        throw new Error(`process.exit(${code})`)
      })
    })

    afterEach(() => {
      vi.restoreAllMocks()
      rmSync(root, { recursive: true, force: true })
    })

    const read = (...segments: string[]) => readFileSync(path.join(root, 'src', 'controllers', ...segments), 'utf8')
    const generate = (name: string, type: ControllerType) => helper.generateController({ controllerName: name }, type)

    it.each([ControllerType.SLASH, ControllerType.CONTEXT_MENU, ControllerType.PRIMARY_ENTRY_POINT])(
      'writes a %s builder of its own, named after the controller, registering the name @Command gives it',
      type => {
        generate('Greeting', type)

        // The name is written once, in @Command, so the builder can't register another
        const builder = read(type, 'builders', 'greeting.builder.ts')
        expect(builder).toContain('export class GreetingCommandBuilder')
        expect(builder).toContain('build(commandName: string)')
        expect(builder).not.toMatch(/name: ['"]greeting['"]|setName\(['"]greeting['"]\)/)
        expect(read(type, `greeting.${type}.controller.ts`)).toContain("@Command('greeting', GreetingCommandBuilder)")
      },
    )

    it('writes a user context menu command by default, and a message one when asked, typing the handler to match', () => {
      generate('Report', ControllerType.CONTEXT_MENU)
      helper.generateController({ controllerName: 'Quote' }, ControllerType.CONTEXT_MENU, { message: true })

      expect(read('context-menu', 'builders', 'report.builder.ts')).toContain('.setType(ApplicationCommandType.User)')
      expect(read('context-menu', 'report.context-menu.controller.ts')).toContain('handleReport(interaction: UserContextMenuCommandInteraction)')
      expect(read('context-menu', 'builders', 'quote.builder.ts')).toContain('.setType(ApplicationCommandType.Message)')
      expect(read('context-menu', 'quote.context-menu.controller.ts')).toContain('handleQuote(interaction: MessageContextMenuCommandInteraction)')
    })

    // Controllers of one type each own their builder, so generating one never touches another's.
    it('gives two slash controllers separate builders and distinct command names', () => {
      generate('Greeting', ControllerType.SLASH)
      appendFileSync(path.join(root, 'src/controllers/slash/builders/greeting.builder.ts'), '// my edit\n')
      generate('Profile', ControllerType.SLASH)

      expect(read('slash', 'builders', 'greeting.builder.ts')).toContain('// my edit')
      expect(read('slash', 'builders', 'profile.builder.ts')).toContain('export class ProfileCommandBuilder')
      expect(read('slash', 'greeting.slash.controller.ts')).toContain("@Command('greeting'")
      expect(read('slash', 'profile.slash.controller.ts')).toContain("@Command('profile'")
    })

    // Command names are global to the application; folders only keep files apart.
    it('names a nested command after its whole path', () => {
      generate('admin/ban', ControllerType.SLASH)
      generate('ban', ControllerType.SLASH)

      expect(read('slash', 'admin', 'ban.slash.controller.ts')).toContain("@Command('admin-ban', AdminBanCommandBuilder)")
      expect(read('slash', 'admin', 'builders', 'ban.builder.ts')).toContain('export class AdminBanCommandBuilder')
      expect(read('slash', 'ban.slash.controller.ts')).toContain("@Command('ban', BanCommandBuilder)")
    })

    // A spec that only checks the controller exists passes whatever the handler does
    it.each(Object.values(ControllerType))('writes a %s spec that invokes the handler', type => {
      generate('Greeting', type)

      const spec = read(type, `greeting.${type}.controller.spec.ts`)
      expect(spec).toContain('module.invoke(')
      expect(spec).not.toContain('toBeDefined()')
    })

    it('completes the slash command generated under the same name', () => {
      generate('Greeting', ControllerType.AUTOCOMPLETE)

      expect(read('autocomplete', 'greeting.autocomplete.controller.ts')).toContain("@Autocomplete('greeting', 'query')")
    })

    it('refuses to overwrite a controller that already exists, and writes nothing', () => {
      generate('Greeting', ControllerType.SLASH)
      const controller = path.join(root, 'src/controllers/slash/greeting.slash.controller.ts')
      appendFileSync(controller, '// my edit\n')

      expect(() => generate('Greeting', ControllerType.SLASH)).toThrow('process.exit(1)')
      expect(readFileSync(controller, 'utf8')).toContain('// my edit')
    })

    // Checked before anything is written, so a refusal never leaves half a controller behind.
    it('refuses when only the builder exists, before writing the controller', () => {
      mkdirSync(path.join(root, 'src/controllers/slash/builders'), { recursive: true })
      writeFileSync(path.join(root, 'src/controllers/slash/builders/greeting.builder.ts'), '// hand-written\n')

      expect(() => generate('Greeting', ControllerType.SLASH)).toThrow('process.exit(1)')
      expect(read('slash', 'builders', 'greeting.builder.ts')).toBe('// hand-written\n')
      expect(existsSync(path.join(root, 'src/controllers/slash/greeting.slash.controller.ts'))).toBe(false)
      expect(existsSync(path.join(root, 'src/controllers/slash/greeting.slash.controller.spec.ts'))).toBe(false)
    })
  })
})
