import { execFileSync, spawnSync } from 'child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { createRequire } from 'module'
import { tmpdir } from 'os'
import path from 'path'
import { pathToFileURL } from 'url'
import { createRsbuild, rspack } from '@rsbuild/core'
import { vi } from 'vitest'
import { createRsbuildConfig } from '@src/build/rsbuild-config.js'
import { installStackRemapper, rejectionMode, reportRejection, reportUncaught } from '@src/build/stack-remap.js'
import { meocordListener } from '@src/util/process-listener.util.js'
import { bun, node } from '@src/spec-runtimes.js'

describe('installStackRemapper', () => {
  // The long form: os.tmpdir() can be a Windows 8.3 short path, such as RUNNER~1, where Bun names the long one
  const directory = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'meocord-remap-')))
  // CommonJS, so Node's own loader runs it rather than the test runner's, which rewrites what it loads
  const bundle = path.join(directory, 'main.cjs')
  const load = createRequire(import.meta.url)
  const runtimeHook = Error.prepareStackTrace

  // A compiled file whose map points its throw back to line 4 of boom.ts
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

  // Node has process.sourceMapsEnabled and Bun has none, so the spec defines it as each row needs, and puts back
  // what the runtime had
  const sourceMaps = Object.getOwnPropertyDescriptor(process, 'sourceMapsEnabled')
  const setSourceMaps = (enabled: boolean) => Object.defineProperty(process, 'sourceMapsEnabled', { get: () => enabled, configurable: true })
  // On Bun the remapper also hooks inspection and reports uncaught errors itself; each row's install is undone
  const INSPECT = Symbol.for('nodejs.util.inspect.custom')
  const inspect = Object.getOwnPropertyDescriptor(Error.prototype, INSPECT)
  const listeners = { uncaughtException: process.listeners('uncaughtException'), unhandledRejection: process.listeners('unhandledRejection') }

  beforeEach(() => {
    setSourceMaps(false)
  })

  afterEach(() => {
    Error.prepareStackTrace = runtimeHook
    if (sourceMaps) Object.defineProperty(process, 'sourceMapsEnabled', sourceMaps)
    else Reflect.deleteProperty(process, 'sourceMapsEnabled')
    if (inspect) Object.defineProperty(Error.prototype, INSPECT, inspect)
    else Reflect.deleteProperty(Error.prototype, INSPECT)
    for (const [event, kept] of Object.entries(listeners) as ['uncaughtException' | 'unhandledRejection', NodeJS.UncaughtExceptionListener[]][]) {
      for (const listener of process.listeners(event)) if (!kept.includes(listener as NodeJS.UncaughtExceptionListener)) process.off(event, listener)
    }
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
    // Left undefined, not deleted: once deleted, JavaScriptCore ignores every later hook for the rest of the process
    Reflect.set(Error, 'prepareStackTrace', undefined)

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
    setSourceMaps(true)
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
    const { stack, hooked } = run(root, node)
    const { thrower, caller, lines } = frames(stack)

    expect(hooked).toBe(true)
    expect(stack.split('\n')[0]).toBe('Error: boom')
    expect(lines[0]).toBe(`    at explode (${source('boom.ts')}:2:${thrower?.[2]})`)
    expect(thrower?.slice(0, 2)).toEqual([source('boom.ts'), '2'])
    expect(caller?.slice(0, 2)).toEqual([source('main.ts'), '12'])
  })

  it('leaves Node to map the stack itself with --enable-source-maps, as meocord start runs it', () => {
    const { stack, hooked } = run(root, node, ['--enable-source-maps'])
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
    ['Node', node, ['--import', pathToFileURL(path.join(root, 'before.mjs')).href]],
    ['Bun', bun, ['--no-install', '--preload', path.join(root, 'before.mjs')]],
  ])('hands a hook set before it the mapped call sites, on %s', (_name, runtime, flags) => {
    const { stack } = run(root, runtime, flags)

    expect(stack).toBe(`before ${source('boom.ts')}:2 ${source('main.ts')}:12`)
  })

  // As follow-redirects, which axios loads, does at import: Bun's own hook throws on such a target
  it.each([
    ['Node', node, [] as string[], 'Plainish: plain'],
    ['Bun', bun, ['--no-install'], 'Error'],
  ])('writes the stack Error.captureStackTrace gives a plain object, as the runtime does, on %s', (_name, runtime, flags, header) => {
    const { stack } = run(root, runtime, flags, { STACK_CASE: 'plain' })

    expect(stack.split('\n')[0]).toBe(header)
    expect(frames(stack).thrower?.slice(0, 2)).toEqual([source('main.ts'), lineOf('Error.captureStackTrace(target)')])
  })

  it.each([
    ['Node', node, [] as string[], 'Error [ERR_REDIRECT]: redirected'],
    ['Bun', bun, ['--no-install'], 'Error'],
  ])('writes the stack of an error type made from a function, as follow-redirects makes one, on %s', (_name, runtime, flags, header) => {
    const { stack } = run(root, runtime, flags, { STACK_CASE: 'custom' })

    expect(stack.split('\n')[0]).toBe(header)
    expect(frames(stack).thrower?.[0]).toBe(source('main.ts'))
  })

  it.each([
    ['Node', node, [] as string[]],
    ['Bun', bun, ['--no-install']],
  ])('gives the same stack each time it is read, on %s', (_name, runtime, flags) => {
    const { stack } = run(root, runtime, flags, { STACK_CASE: 'twice' })

    expect(stack.split('\n')[0]).toBe('Error: twice')
    expect(frames(stack).thrower?.slice(0, 2)).toEqual([source('main.ts'), lineOf("new Error('twice')")])
  })

  it.each([
    ['Node', node, ['--import', pathToFileURL(path.join(root, 'throwing.mjs')).href]],
    ['Bun', bun, ['--no-install', '--preload', path.join(root, 'throwing.mjs')]],
  ])('writes the stack itself when a hook set before it throws, on %s', (_name, runtime, flags) => {
    const { stack } = run(root, runtime, flags)

    expect(stack.split('\n')[0]).toBe('Error: boom')
    expect(frames(stack).thrower?.slice(0, 2)).toEqual([source('boom.ts'), '2'])
  })

  it('stays in the chain under a hook set after it that calls the one it found', () => {
    const { stack } = run(root, node, [], { STACK_HOOK: 'after' })

    expect(stack.startsWith('after Error: boom\n')).toBe(true)
    expect(frames(stack).thrower?.slice(0, 2)).toEqual([source('boom.ts'), '2'])
  })

  it('gives way to a hook set after it that replaces it', () => {
    const { stack } = run(root, node, [], { STACK_HOOK: 'replace' })

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

    const { stack, hooked } = run(root, node)

    expect(hooked).toBe(false)
    expect(frames(stack).thrower?.[0]).toBe(pathToFileURL(path.join(root, 'dist', 'main.js')).href)
  })
})

describe('rejectionMode', () => {
  it.each([
    [[], undefined],
    [['--unhandled-rejections=throw'], 'throw'],
    [['--unhandled-rejections=warn'], 'warn'],
    [['--unhandled-rejections', 'none'], 'none'],
    [['--unhandled-rejections=strict', '--smol', '--unhandled-rejections', 'warn-with-error-code'], 'warn-with-error-code'],
  ])('reads %j as %s', (execArgv, mode) => {
    expect(rejectionMode(execArgv)).toBe(mode)
  })
})

describe('reportRejection and reportUncaught', () => {
  const execArgv = process.execArgv

  beforeEach(() => {
    process.execArgv = []
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
  })

  afterEach(() => {
    process.execArgv = execArgv
    vi.restoreAllMocks()
  })

  const listening = (...listeners: ((...args: never[]) => void)[]) =>
    vi.spyOn(process, 'listeners').mockImplementation(() => listeners as ReturnType<typeof process.listeners>)

  it('reports a rejection and exits 1 when its own listener is the only one', () => {
    listening(meocordListener(reportRejection))

    reportRejection(new Error('boom'))

    expect(console.error).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' }))
    expect(process.exit).toHaveBeenCalledWith(1)
  })

  it('still prints the name and message of an error that throws as it is printed', () => {
    listening(meocordListener(reportUncaught))
    vi.mocked(console.error).mockImplementation(() => {
      throw new Error('unprintable')
    })
    const written = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    reportUncaught(new TypeError('boom'))
    reportUncaught(
      Object.defineProperties(new Error(), {
        name: { get: () => 'Odd' },
        message: {
          get: () => {
            throw new Error('no message')
          },
        },
      }),
    )

    expect(written.mock.calls).toEqual([['TypeError: boom\n'], ['Odd (it could not be printed)\n']])
    expect(process.exit).toHaveBeenCalledTimes(2)
  })

  // The refusal reporter reports a refused rejection itself, and rejects any other again once it stops listening
  it("stands aside while another of MeoCord's listeners, the refusal reporter, listens", () => {
    listening(
      meocordListener(reportRejection),
      meocordListener(() => undefined),
    )

    reportRejection(new Error('boom'))

    expect(console.error).not.toHaveBeenCalled()
    expect(process.exit).not.toHaveBeenCalled()
  })
})

/**
 * An application that inspects an error, throws one or leaves one rejected, as CRASH_CASE says, and first prints how
 * many listeners each crash event has. With APP_LISTENER=after it listens for both itself, after MeoCord, with
 * APP_LISTENER=uncaught for uncaught errors only, and with APP_LISTENER=removed it listens for both and stops again.
 */
const CRASH_MAIN = `import { explode } from './boom'

const own = (event: string) => (error: unknown) => console.log(\`app saw \${event}: \${(error as Error).message}\`)
if (process.env.APP_LISTENER === 'after' || process.env.APP_LISTENER === 'uncaught') {
  process.on('uncaughtException', own('uncaughtException'))
}
if (process.env.APP_LISTENER === 'after') process.on('unhandledRejection', own('unhandledRejection'))
if (process.env.APP_LISTENER === 'removed') {
  const listener = own('a removed listener')
  for (const event of ['uncaughtException', 'unhandledRejection'] as const) process.on(event, listener).off(event, listener)
}
console.log(
  JSON.stringify({
    uncaught: process.listenerCount('uncaughtException'),
    rejection: process.listenerCount('unhandledRejection'),
    inspectHook: Object.hasOwn(Error.prototype, Symbol.for('nodejs.util.inspect.custom')),
  }),
)

const logged = () => Object.assign(new Error('logged', { cause: new TypeError('inner') }), { code: 50013 })

// An error with no stack of its own, alone and as a cause, and an error inspecting itself its own way
const unusual = () => {
  console.error(new DOMException('aborted', 'AbortError'))
  console.error(new Error('outer', { cause: new DOMException('inner') }))
  const own = new Error('own')
  Reflect.set(own, Symbol.for('nodejs.util.inspect.custom'), () => 'its own inspection')
  console.error(own)
}

// Two errors made under the runtime's own stack hook, as before MeoCord installs its own, one of them read at once.
// RUNTIME_HOOK saves the runtime's hook before the bundle loads
const unmapped = () => {
  const hook = Error.prepareStackTrace
  Error.prepareStackTrace = Reflect.get(globalThis, 'runtimeStackHook')
  const unread = new Error('first read later')
  const read = new Error('read at once')
  void read.stack
  Error.prepareStackTrace = hook
  console.error(unread)
  console.error(read)
}

// An uncaught error whose stack throws as it is read, is no string, or is gone
const oddStack = (shape: string) => {
  const error = new Error(\`odd \${shape}\`)
  if (shape === 'getter') Object.defineProperty(error, 'stack', { get: () => { throw new Error('unreadable') } })
  else if (shape === 'number') Object.defineProperty(error, 'stack', { value: 42 })
  else Reflect.deleteProperty(error, 'stack')
  throw error
}

const scenario = process.env.CRASH_CASE
if (scenario === 'logged') console.error(logged())
else if (scenario === 'unmapped') unmapped()
else if (scenario === 'unusual') unusual()
else if (scenario === 'uncaught') setTimeout(explode, 0)
else if (scenario === 'rejected') void Promise.resolve().then(explode)
else if (scenario?.startsWith('odd-')) setTimeout(() => oddStack(scenario.slice('odd-'.length)), 0)
`
// Run before the bundle: the runtime's own stack hook, saved for an error made as if MeoCord had installed nothing
const RUNTIME_HOOK = `globalThis.runtimeStackHook = Error.prepareStackTrace\n`
// Run before the bundle, as a listener the application adds before MeoCord's
const APP_LISTENER = `process.on('uncaughtException', error => console.log('app saw uncaughtException: ' + error.message))
process.on('unhandledRejection', error => console.log('app saw unhandledRejection: ' + error.message))
`
// Run before the bundle, as listeners the application adds before MeoCord's, each removing itself as it runs
const APP_LISTENER_ONCE = APP_LISTENER.replaceAll('process.on(', 'process.once(')

interface Crash {
  status: number | null
  counts: { uncaught: number; rejection: number; inspectHook: boolean }
  stdout: string
  stderr: string
}

function crash(root: string, runtime: string, args: string[], env: NodeJS.ProcessEnv): Crash {
  const { status, stdout, stderr } = spawnSync(runtime, [...args, path.join(root, 'dist', 'main.js')], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NODE_OPTIONS: '', ...env },
  })
  return { status, counts: JSON.parse(stdout.split('\n')[0]), stdout, stderr }
}

describe('what Bun prints itself', () => {
  const { root, write } = fixtureApp()
  write('src/main.ts', CRASH_MAIN)
  write('app-listener.mjs', APP_LISTENER)
  write('app-listener-once.mjs', APP_LISTENER_ONCE)
  write('runtime-hook.mjs', RUNTIME_HOOK)
  const source = (file: string) => path.join(root, 'src', file)
  const bundled = path.join(root, 'dist', 'main.js')
  const loggedLine = String(CRASH_MAIN.split('\n').findIndex(line => line.includes("new Error('logged'")) + 1)
  const onBun = (env: NodeJS.ProcessEnv, flags: string[] = []) => crash(root, bun, ['--no-install', ...flags], env)

  beforeAll(async () => {
    await build(root, 'production', false)
  }, 120_000)

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('inspects an error with the mapped stack, keeping its own properties and cause, as console.error prints it', () => {
    const { status, stderr } = onBun({ CRASH_CASE: 'logged' })
    const [error, cause] = stderr.split('[cause]')

    expect(status).toBe(0)
    expect(error).toMatch(/^Error: logged\n/)
    expect(error).toContain(`${source('main.ts')}:${loggedLine}:`)
    expect(error).toContain('code: 50013')
    expect(cause).toMatch(/^: TypeError: inner\n/)
    expect(cause).toContain(`${source('main.ts')}:${loggedLine}:`)
    expect(stderr).not.toContain(bundled)
  })

  it('inspects an error with no stack of its own as Bun would, and one inspecting itself its own way', () => {
    const { status, stderr } = onBun({ CRASH_CASE: 'unusual' })
    const outerLine = String(CRASH_MAIN.split('\n').findIndex(line => line.includes("new Error('outer'")) + 1)

    expect(status).toBe(0)
    expect(stderr).toContain('aborted')
    expect(stderr).toContain('AbortError')
    expect(stderr).toMatch(/Error: outer\n/)
    expect(stderr).toContain(`${source('main.ts')}:${outerLine}:`)
    expect(stderr).toContain('inner')
    expect(stderr).toContain('its own inspection')
    expect(stderr).not.toContain('can only be used on instances')
  })

  // Under the runtime's own hook, Bun writes an error's stack when it is first read, not when the error is made
  it('maps an error made before the stack hook was in place unless its stack was read before', () => {
    const { status, stderr } = onBun({ CRASH_CASE: 'unmapped' }, ['--preload', path.join(root, 'runtime-hook.mjs')])
    const [unread, read] = stderr.split(/(?=^Error: read at once$)/m)
    const unreadLine = String(CRASH_MAIN.split('\n').findIndex(line => line.includes("new Error('first read later')")) + 1)

    expect(status).toBe(0)
    expect(unread).toMatch(/^Error: first read later\n/)
    expect(unread).toContain(`${source('main.ts')}:${unreadLine}:`)
    expect(read).toMatch(/^Error: read at once\n/)
    expect(read).toContain(bundled)
    expect(read).not.toContain(source('main.ts'))
  })

  it.each([
    ['an uncaught error', 'uncaught', [] as string[]],
    ['a rejection', 'rejected', [] as string[]],
    ['a rejection under --unhandled-rejections=strict', 'rejected', ['--unhandled-rejections=strict']],
    ['a rejection under --unhandled-rejections=throw', 'rejected', ['--unhandled-rejections=throw']],
  ])('reports %s with the mapped stack, and exits 1 as Bun does', (_name, scenario, flags) => {
    const { status, counts, stderr } = onBun({ CRASH_CASE: scenario }, flags)

    expect(counts).toEqual({ uncaught: 1, rejection: 1, inspectHook: true })
    expect(status).toBe(1)
    expect(stderr).toMatch(/^Error: boom\n/)
    expect(stderr).toContain(`${source('boom.ts')}:2:`)
    expect(stderr).not.toContain(bundled)
  })

  it('warns of a rejection with the mapped stack and exits 1 under --unhandled-rejections=warn-with-error-code', () => {
    const { status, stderr } = onBun({ CRASH_CASE: 'rejected' }, ['--unhandled-rejections=warn-with-error-code'])

    expect(status).toBe(1)
    expect(stderr).toMatch(/UnhandledPromiseRejectionWarning: Error: boom\n/)
    expect(stderr).toContain(`${source('boom.ts')}:2:`)
    expect(stderr).not.toContain(bundled)
  })

  // Strict mode raises the rejection as an uncaught error first; Bun warns of it once that is handled
  it("warns of a rejection the application's uncaughtException listener handled, under --unhandled-rejections=strict", () => {
    const { status, stdout, stderr } = onBun({ APP_LISTENER: 'uncaught', CRASH_CASE: 'rejected' }, ['--unhandled-rejections=strict'])

    expect(stdout).toContain('app saw uncaughtException: boom')
    expect(status).toBe(0)
    expect(stderr).toMatch(/UnhandledPromiseRejectionWarning: Error: boom\n/)
    expect(stderr).toContain(`${source('boom.ts')}:2:`)
  })

  // Explicit throw raises the rejection as an uncaught error; Bun's default ends the process whatever listens for those
  it("hands a rejection to the application's uncaughtException listener under --unhandled-rejections=throw only", () => {
    const thrown = onBun({ APP_LISTENER: 'uncaught', CRASH_CASE: 'rejected' }, ['--unhandled-rejections=throw'])

    expect(thrown.stdout).toContain('app saw uncaughtException: boom')
    expect(thrown.status).toBe(0)
    expect(thrown.stderr).toBe('')

    const unflagged = onBun({ APP_LISTENER: 'uncaught', CRASH_CASE: 'rejected' })

    expect(unflagged.stdout).not.toContain('app saw')
    expect(unflagged.status).toBe(1)
    expect(unflagged.stderr).toMatch(/^Error: boom\n/)
    expect(unflagged.stderr).toContain(`${source('boom.ts')}:2:`)
  })

  // Bun keeps no frames of its own for an error made under a stack hook, and gives a listener no throw site
  it.each(['getter', 'number', 'deleted'])('prints an uncaught error whose stack is %s as Bun does, and exits 1', shape => {
    const { status, stderr } = onBun({ CRASH_CASE: `odd-${shape}` })

    expect(status).toBe(1)
    expect(stderr).toMatch(new RegExp(`^error: odd ${shape}$`, 'm'))
  })

  it('prints nothing for a rejection, and goes on, under --unhandled-rejections=none', () => {
    const { status, stderr } = onBun({ CRASH_CASE: 'rejected' }, ['--unhandled-rejections=none'])

    expect(status).toBe(0)
    expect(stderr).toBe('')
  })

  it.each([
    ['before', { APP_LISTENER: 'none' }, ['--preload', path.join(root, 'app-listener.mjs')]],
    ['before, removing itself as it runs,', { APP_LISTENER: 'none' }, ['--preload', path.join(root, 'app-listener-once.mjs')]],
    ['after', { APP_LISTENER: 'after' }, []],
  ])("leaves the error and the exit to the application's own listener, added %s MeoCord's", (_when, env, flags) => {
    for (const [scenario, event] of [
      ['uncaught', 'uncaughtException'],
      ['rejected', 'unhandledRejection'],
    ]) {
      const { status, counts, stdout, stderr } = onBun({ ...env, CRASH_CASE: scenario }, flags)

      expect(counts).toEqual({ uncaught: 2, rejection: 2, inspectHook: true })
      expect(stdout).toContain(`app saw ${event}: boom`)
      expect(status).toBe(0)
      expect(stderr).toBe('')
    }
  })

  it("reports the crash once the application's own listener is removed", () => {
    for (const scenario of ['uncaught', 'rejected']) {
      const { status, counts, stderr } = onBun({ APP_LISTENER: 'removed', CRASH_CASE: scenario })

      expect(counts).toEqual({ uncaught: 1, rejection: 1, inspectHook: true })
      expect(status).toBe(1)
      expect(stderr).toMatch(/^Error: boom\n/)
    }
  })

  it('installs nothing under Node, which maps what it prints itself', () => {
    const { status, counts, stderr } = crash(root, node, [], { CRASH_CASE: 'uncaught' })

    expect(counts).toEqual({ uncaught: 0, rejection: 0, inspectHook: false })
    expect(status).toBe(1)
    expect(stderr).toContain(`${source('boom.ts')}:2:`)
  })

  it('installs nothing on Bun when the config sets sourceMappedStacks: false', () => {
    write('dist/meocord.config.mjs', 'export default { sourceMappedStacks: false }\n')
    try {
      const { status, counts, stderr } = onBun({ CRASH_CASE: 'uncaught' })

      expect(counts).toEqual({ uncaught: 0, rejection: 0, inspectHook: false })
      expect(status).toBe(1)
      expect(stderr).toContain(bundled)
    } finally {
      rmSync(path.join(root, 'dist', 'meocord.config.mjs'))
    }
  })
})
