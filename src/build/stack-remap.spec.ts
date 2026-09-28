import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { createRequire } from 'module'
import { tmpdir } from 'os'
import path from 'path'
import { pathToFileURL } from 'url'
import { createRsbuild, rspack } from '@rsbuild/core'
import { vi } from 'vitest'
import { createRsbuildConfig } from '@src/build/rsbuild-config.js'
import { installStackRemapper } from '@src/build/stack-remap.js'

describe('installStackRemapper', () => {
  // The long form: os.tmpdir() can be a Windows 8.3 short path, such as RUNNER~1, where Bun names the long one
  const directory = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'meocord-remap-')))
  // CommonJS, so Node's own loader runs it rather than the test runner's, which rewrites what it loads
  const bundle = path.join(directory, 'main.cjs')
  const load = createRequire(import.meta.url)
  const runtimeHook = Error.prepareStackTrace

  // A compiled file whose map points line 2 of its code back to line 3 of boom.ts
  const compile = (writeMap = true) => {
    const { code, map } = rspack.experiments.swc.transformSync(
      "// the source\n\nexport function explode(): never {\n  throw new Error('boom')\n}\n",
      {
        filename: 'boom.ts',
        sourceMaps: true,
        jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
        module: { type: 'commonjs' },
      },
    )
    writeFileSync(bundle, `${code}\n//# sourceMappingURL=main.cjs.map\n`)
    if (writeMap) writeFileSync(`${bundle}.map`, map!)
    else rmSync(`${bundle}.map`, { force: true })
  }
  // Loaded afresh each time, so the module is evaluated from the file as it now is
  const explode = async (): Promise<Error> => {
    delete load.cache[bundle]
    const { explode } = load(bundle) as { explode: () => never }
    try {
      explode()
    } catch (error) {
      return error as Error
    }
    throw new Error('explode() returned')
  }

  beforeEach(() => {
    vi.spyOn(process, 'sourceMapsEnabled', 'get').mockReturnValue(false)
  })

  afterEach(() => {
    Error.prepareStackTrace = runtimeHook
    vi.restoreAllMocks()
  })

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  it('maps each frame to its source, in the frame format of the runtime', async () => {
    compile()

    expect(installStackRemapper(bundle)).toBe(true)
    const [header, top] = (await explode()).stack!.split('\n')

    expect(header).toBe('Error: boom')
    const column = top.match(/:(\d+)\)$/)?.[1]
    expect(top).toBe(`    at explode (${path.join(directory, 'boom.ts')}:4:${column})`)
  })

  // Node and Bun define a hook of their own; a runtime without one gets the same text from this one
  it('writes the stack itself where the runtime has no hook', async () => {
    compile()
    Reflect.deleteProperty(Error, 'prepareStackTrace')

    installStackRemapper(bundle)
    const [header, top] = (await explode()).stack!.split('\n')

    expect(header).toBe('Error: boom')
    expect(top).toMatch(/^ {4}at explode \(.+boom\.ts:4:\d+\)$/)
  })

  it('hands a hook set before it the mapped call sites', async () => {
    compile()
    Error.prepareStackTrace = (_error, sites) => sites.map(site => `${site.getFileName()}:${site.getLineNumber()}`)

    installStackRemapper(bundle)

    expect((await explode()).stack![0]).toBe(`${path.join(directory, 'boom.ts')}:4`)
  })

  // As source-map-support does, which copies a site's methods from its prototype
  it('gives a hook that clones call sites from their prototype the mapped positions', async () => {
    compile()
    Error.prepareStackTrace = (_error, sites) =>
      sites.map(site => {
        const clone: Record<string, () => unknown> = {}
        for (const name of Object.getOwnPropertyNames(Object.getPrototypeOf(site))) {
          const method = (site as unknown as Record<string, (...args: unknown[]) => unknown>)[name]
          if (/^(?:is|get)/.test(name)) clone[name] = () => method.call(site)
        }
        return `${clone.getFileName()}:${clone.getLineNumber()}`
      })

    installStackRemapper(bundle)

    expect((await explode()).stack![0]).toBe(`${path.join(directory, 'boom.ts')}:4`)
  })

  // As with a Windows 8.3 short path: the bundle is named one way and the runtime names its frames another
  it('maps frames when the bundle path names its directory another way than the runtime does', async () => {
    compile()
    const alias = path.join(realpathSync.native(tmpdir()), `meocord-remap-alias-${process.pid}`)
    symlinkSync(directory, alias, process.platform === 'win32' ? 'junction' : 'dir')
    try {
      installStackRemapper(path.join(alias, 'main.cjs'))

      expect((await explode()).stack!.split('\n')[1]).toContain(`${path.join(directory, 'boom.ts')}:4:`)
    } finally {
      rmSync(alias, { recursive: true, force: true })
    }
  })

  it('keeps the bundle positions when the map cannot be read', async () => {
    compile()
    writeFileSync(`${bundle}.map`, '{ not json')

    installStackRemapper(bundle)

    expect((await explode()).stack!.split('\n')[1]).toContain(`${bundle}:`)
  })

  it('installs nothing where the runtime maps stacks itself, or the bundle has no map', () => {
    compile(false)
    expect(installStackRemapper(bundle)).toBe(false)

    compile()
    vi.spyOn(process, 'sourceMapsEnabled', 'get').mockReturnValue(true)
    expect(installStackRemapper(bundle)).toBe(false)
    expect(Error.prepareStackTrace).toBe(runtimeHook)
  })
})

/**
 * Builds an application with the pre-entry, whose code throws from src/boom.ts, and runs it as a bot is
 * run: on Node with and without `--enable-source-maps`, and on Bun, from development and production
 * builds, bundled and not.
 */
const BOOM = `export function explode(): never {
  throw new Error('boom')
}
`
// The call to explode() is on line 12
const MAIN = `import { explode } from './boom'

if (process.env.STACK_HOOK === 'after') {
  const found = Error.prepareStackTrace
  Error.prepareStackTrace = (error, sites) => \`after \${found ? found(error, sites) : sites.join(' ')}\`
} else if (process.env.STACK_HOOK === 'replace') {
  Error.prepareStackTrace = (error, sites) => \`replaced \${sites.map(site => site.getFileName()).join(' ')}\`
}

function stack(): string {
  try {
    explode()
  } catch (error) {
    return (error as Error).stack ?? ''
  }
  return ''
}

// An error type made the way follow-redirects, which axios uses, makes its own: a function, not a class
function CustomError(this: { stack?: string; message: string }) {
  Error.captureStackTrace(this, CustomError)
  this.message = 'redirected'
}
CustomError.prototype = new Error()
Object.defineProperty(CustomError.prototype, 'name', { value: 'Error [ERR_REDIRECT]' })

const cases: Record<string, () => unknown> = {
  plain: () => {
    const target: { message: string; name: string; stack?: string } = { message: 'plain', name: 'Plainish' }
    Error.captureStackTrace(target)
    return target.stack
  },
  custom: () => new (CustomError as unknown as new () => Error)().stack,
  twice: () => {
    const error = new Error('twice')
    const first = error.stack
    return first === error.stack ? first : 'the second read differed'
  },
}

const scenario = process.env.STACK_CASE
console.log(
  JSON.stringify(
    scenario
      ? { stack: cases[scenario](), hooked: Error.prepareStackTrace?.name === 'meocordSourceMappedStackTrace' }
      : { stack: stack(), hooked: Error.prepareStackTrace?.name === 'meocordSourceMappedStackTrace' },
  ),
)
`
/** The line of the fixture's main.ts a piece of it is on. */
const lineOf = (text: string) => String(MAIN.split('\n').findIndex(line => line.includes(text)) + 1)
// Set before the bundle runs, as a broken preloaded error tracker's would be
const THROWING = `Error.prepareStackTrace = () => {
  throw new Error('the tracker broke')
}
`
// Set before the bundle runs, as a preloaded error tracker would; shows the call sites it is given
const BEFORE = `Error.prepareStackTrace = (error, sites) =>
  'before ' + sites.slice(0, 2).map(site => site.getFileName() + ':' + site.getLineNumber()).join(' ')
`

const bun = process.versions.bun ? process.execPath : 'bun'

interface Run {
  stack: string
  hooked: boolean
}

function fixtureApp() {
  const root = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'meocord-stacks-')))
  const write = (file: string, content: string) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    writeFileSync(path.join(root, file), content)
  }
  write('package.json', JSON.stringify({ name: 'stacks-spec', private: true, type: 'module' }))
  write('tsconfig.json', JSON.stringify({ compilerOptions: { target: 'es2022' } }))
  write('src/boom.ts', BOOM)
  write('src/main.ts', MAIN)
  write('before.mjs', BEFORE)
  write('throwing.mjs', THROWING)
  return { root, write }
}

async function build(root: string, mode: 'production' | 'development', bundleDependencies: boolean) {
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(root)
  try {
    const config = createRsbuildConfig({ mode, bundleDependencies })
    const rsbuild = await createRsbuild({ cwd: root, config: { ...config, performance: { printFileSize: false } } })
    await rsbuild.build()
  } finally {
    cwd.mockRestore()
  }
}

function run(root: string, runtime: string, args: string[] = [], env: NodeJS.ProcessEnv = {}): Run {
  const output = execFileSync(runtime, [...args, path.join(root, 'dist', 'main.js')], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NODE_OPTIONS: '', ...env },
  })
  return JSON.parse(output.trim())
}

/** The file, line and column of the frames for explode() and for its caller in main.ts. */
function frames(stack: string) {
  const lines = stack.split('\n').filter(line => line.startsWith('    at '))
  const location = (line: string | undefined) => line?.match(/\(?([^ ()]+):(\d+):(\d+)\)?$/)?.slice(1)
  return { thrower: location(lines[0]), caller: location(lines[1]), lines }
}

describe.each([
  ['production', false],
  ['production', true],
  ['development', false],
  ['development', true],
] as const)('a %s build (bundleDependencies: %s)', (mode, bundleDependencies) => {
  const { root } = fixtureApp()
  const source = (file: string) => path.join(root, 'src', file)

  beforeAll(async () => {
    await build(root, mode, bundleDependencies)
  }, 120_000)

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('names the source on Node without --enable-source-maps, in the frame format Node writes', () => {
    const { stack, hooked } = run(root, 'node')
    const { thrower, caller, lines } = frames(stack)

    expect(hooked).toBe(true)
    expect(stack.split('\n')[0]).toBe('Error: boom')
    expect(lines[0]).toBe(`    at explode (${source('boom.ts')}:2:${thrower?.[2]})`)
    expect(thrower?.slice(0, 2)).toEqual([source('boom.ts'), '2'])
    expect(caller?.slice(0, 2)).toEqual([source('main.ts'), '12'])
  })

  it('leaves Node to map the stack itself with --enable-source-maps, as meocord start runs it', () => {
    const { stack, hooked } = run(root, 'node', ['--enable-source-maps'])
    const { thrower, caller } = frames(stack)

    expect(hooked).toBe(false)
    expect(thrower?.slice(0, 2)).toEqual([source('boom.ts'), '2'])
    expect(caller?.slice(0, 2)).toEqual([source('main.ts'), '12'])
  })

  it('names the source on Bun', () => {
    const { stack, hooked } = run(root, bun, ['--no-install'])
    const { thrower, caller, lines } = frames(stack)

    expect(hooked).toBe(true)
    expect(lines[0]).toBe(`    at explode (${source('boom.ts')}:2:${thrower?.[2]})`)
    expect(thrower?.slice(0, 2)).toEqual([source('boom.ts'), '2'])
    expect(caller?.slice(0, 2)).toEqual([source('main.ts'), '12'])
  })
})

describe('the stack hook alongside others', () => {
  const { root, write } = fixtureApp()
  const source = (file: string) => path.join(root, 'src', file)

  beforeAll(async () => {
    await build(root, 'production', false)
  }, 120_000)

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it.each([
    // A URL, which --import takes where a Windows path would read as one with a scheme
    ['Node', 'node', ['--import', pathToFileURL(path.join(root, 'before.mjs')).href]],
    ['Bun', bun, ['--no-install', '--preload', path.join(root, 'before.mjs')]],
  ])('hands a hook set before it the mapped call sites, on %s', (_name, runtime, flags) => {
    const { stack } = run(root, runtime, flags)

    expect(stack).toBe(`before ${source('boom.ts')}:2 ${source('main.ts')}:12`)
  })

  // As follow-redirects, which axios loads, does at import: Bun's own hook throws on such a target
  it.each([
    ['Node', 'node', [] as string[], 'Plainish: plain'],
    ['Bun', bun, ['--no-install'], 'Error'],
  ])('writes the stack Error.captureStackTrace gives a plain object, as the runtime does, on %s', (_name, runtime, flags, header) => {
    const { stack } = run(root, runtime, flags, { STACK_CASE: 'plain' })

    expect(stack.split('\n')[0]).toBe(header)
    expect(frames(stack).thrower?.slice(0, 2)).toEqual([source('main.ts'), lineOf('Error.captureStackTrace(target)')])
  })

  it.each([
    ['Node', 'node', [] as string[], 'Error [ERR_REDIRECT]: redirected'],
    ['Bun', bun, ['--no-install'], 'Error'],
  ])('writes the stack of an error type made from a function, as follow-redirects makes one, on %s', (_name, runtime, flags, header) => {
    const { stack } = run(root, runtime, flags, { STACK_CASE: 'custom' })

    expect(stack.split('\n')[0]).toBe(header)
    expect(frames(stack).thrower?.[0]).toBe(source('main.ts'))
  })

  it.each([
    ['Node', 'node', [] as string[]],
    ['Bun', bun, ['--no-install']],
  ])('gives the same stack each time it is read, on %s', (_name, runtime, flags) => {
    const { stack } = run(root, runtime, flags, { STACK_CASE: 'twice' })

    expect(stack.split('\n')[0]).toBe('Error: twice')
    expect(frames(stack).thrower?.slice(0, 2)).toEqual([source('main.ts'), lineOf("new Error('twice')")])
  })

  it.each([
    ['Node', 'node', ['--import', pathToFileURL(path.join(root, 'throwing.mjs')).href]],
    ['Bun', bun, ['--no-install', '--preload', path.join(root, 'throwing.mjs')]],
  ])('writes the stack itself when a hook set before it throws, on %s', (_name, runtime, flags) => {
    const { stack } = run(root, runtime, flags)

    expect(stack.split('\n')[0]).toBe('Error: boom')
    expect(frames(stack).thrower?.slice(0, 2)).toEqual([source('boom.ts'), '2'])
  })

  it('stays in the chain under a hook set after it that calls the one it found', () => {
    const { stack } = run(root, 'node', [], { STACK_HOOK: 'after' })

    expect(stack.startsWith('after Error: boom\n')).toBe(true)
    expect(frames(stack).thrower?.slice(0, 2)).toEqual([source('boom.ts'), '2'])
  })

  it('gives way to a hook set after it that replaces it', () => {
    const { stack } = run(root, 'node', [], { STACK_HOOK: 'replace' })

    expect(stack).toMatch(/^replaced .*dist[\\/]main\.js/)
  })

  it('installs nothing when the config sets sourceMappedStacks: false', () => {
    write('dist/meocord.config.mjs', 'export default { sourceMappedStacks: false }\n')
    try {
      const { stack, hooked } = run(root, bun, ['--no-install'])

      expect(hooked).toBe(false)
      expect(frames(stack).thrower?.[0]).toBe(path.join(root, 'dist', 'main.js'))
    } finally {
      rmSync(path.join(root, 'dist', 'meocord.config.mjs'))
    }
  })

  it('installs nothing when the build wrote no source map', () => {
    rmSync(path.join(root, 'dist', 'main.js.map'))

    const { stack, hooked } = run(root, 'node')

    expect(hooked).toBe(false)
    expect(frames(stack).thrower?.[0]).toBe(pathToFileURL(path.join(root, 'dist', 'main.js')).href)
  })
})
