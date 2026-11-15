import { existsSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { inspect, type InspectOptions, types } from 'node:util'
import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping'
// Relative: the pre-entry that imports this file is bundled from its source, where no alias resolves
import { appListenerCount, meocordListener, meocordListenerCount } from '../util/process-listener.util.js'
import { comparablePath, framePath } from '../util/source-path.util.js'

type PrepareStackTrace = (error: Error, sites: NodeJS.CallSite[]) => unknown

/** The key `util.inspect`, and Bun's console with it, reads an object's own inspection from. */
const INSPECT = Symbol.for('nodejs.util.inspect.custom')
/** The runtime flag that sets what a rejection nothing handles does. */
const UNHANDLED_REJECTIONS_FLAG = '--unhandled-rejections'
/** The warning a rejection nothing handles prints in the modes that warn, under Bun as under Node. */
const REJECTION_WARNING = 'UnhandledPromiseRejectionWarning'
/** The exit code of a process an error nothing handles ends. */
const CRASH_EXIT_CODE = 1

/**
 * Maps stack traces to the source through the `.map` beside the bundle, when the runtime maps nothing itself:
 * under Bun, or Node without `--enable-source-maps`. A hook already set receives the mapped call sites, and
 * each map is read the first time a stack needs it. Under Bun, what the runtime prints without reading
 * `error.stack` is mapped too (see `mapBunOutput`). Returns whether the hook was installed.
 */
export function installStackRemapper(bundle: string): boolean {
  if (process.sourceMapsEnabled) return false
  if (!existsSync(`${bundle}.map`)) return false

  const directory = canonical(path.dirname(bundle))
  const inDirectory = (file: string) => comparablePath(path.dirname(file)) === comparablePath(directory)
  // One map per file, or null for a file with none or one that cannot be read
  const maps = new Map<string, TraceMap | null>()
  const mapFor = (file: string): TraceMap | null => {
    const cached = maps.get(file)
    if (cached !== undefined) return cached
    // Set first, so an error while reading the map formats its own stack without reading it again
    maps.set(file, null)
    const real = canonical(file)
    if (!inDirectory(real) || !existsSync(`${real}.map`)) return null
    const map = new TraceMap(readFileSync(`${real}.map`, 'utf8'))
    maps.set(file, map)
    return map
  }

  const previous = Error.prepareStackTrace as PrepareStackTrace | undefined
  // Named, so a stack hook can be told apart from the runtime's own, which Node and Bun both define
  function meocordSourceMappedStackTrace(error: Error, sites: NodeJS.CallSite[]): unknown {
    let mapped = sites
    try {
      mapped = sites.map(site => remapSite(site, directory, mapFor))
    } catch {
      // A stack is never lost to a map that cannot be read: it keeps the bundle's positions.
    }
    // The runtime's own hook, which Node and Bun both name ErrorPrepareStackTrace, gets only native errors:
    // Bun's throws on a plain object given to Error.captureStackTrace, as follow-redirects gives one
    if (previous && (types.isNativeError(error) || previous.name !== 'ErrorPrepareStackTrace')) {
      try {
        return previous(error, mapped)
      } catch {
        // A hook that throws still leaves the call a stack, rather than failing the code that asked for it
      }
    }
    return formatStack(error, mapped)
  }
  Error.prepareStackTrace = meocordSourceMappedStackTrace
  if (process.versions.bun) mapBunOutput()
  return true
}

/**
 * Bun prints an error's frames without reading `error.stack` when it inspects one, as `console.error` does, and when
 * it reports an uncaught error or a rejection nothing handles. An inspection hook on `Error.prototype` gives the
 * first the mapped stack, and a listener for each event reports the others with it, ending the process as Bun would.
 * A listener acts only when the application has none of its own for that event, decided as the event fires. Each runs
 * first, so it sees an application listener that removes itself as it runs, as `process.once` does; one put ahead of it
 * later that removes itself, as `process.prependOnceListener` adds one, is gone by then, and the error is reported too.
 */
function mapBunOutput(): void {
  if (!Object.hasOwn(Error.prototype, INSPECT)) {
    Object.defineProperty(Error.prototype, INSPECT, { value: meocordSourceMappedInspect, configurable: true, writable: true })
  }
  process.prependListener('uncaughtException', meocordListener(reportUncaught))
  process.prependListener('unhandledRejection', meocordListener(reportRejection))
}

/**
 * The default inspection of an error, with the stack its own `stack` property holds, which Bun writes through the stack
 * hook when it is first read: a copy of its own properties is inspected, so a cause and the rest, such as a
 * DiscordAPIError's code, print as before. An error whose `stack` is no string of its own, such as a DOMException,
 * whose getters work only on itself, or one whose `stack` is a getter, is returned as it is, which the runtime then
 * inspects in its own way, without reading `stack`.
 */
function meocordSourceMappedInspect(this: Error, _depth: number, options?: InspectOptions, inspectWith = inspect): string | Error {
  if (typeof Object.getOwnPropertyDescriptor(this, 'stack')?.value !== 'string') return this
  const copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this)) as Error
  // The copy is inspected as a plain error, rather than through this hook again
  Object.defineProperty(copy, INSPECT, { value: undefined, configurable: true })
  return inspectWith(copy, options)
}

/**
 * An uncaught error, under `--unhandled-rejections=strict` or `throw` a rejection too, which ends the process as Bun
 * does.
 */
export function reportUncaught(error: unknown): void {
  if (appListenerCount('uncaughtException') > 0) return
  printError(error)
  process.exit(CRASH_EXIT_CODE)
}

/** A rejection nothing handles, reported as Bun's `--unhandled-rejections` mode would report it with no listener. */
export function reportRejection(reason: unknown): void {
  if (appListenerCount('unhandledRejection') > 0) return
  // MeoCord's refusal reporter, while it listens, reports a refused rejection and rejects any other again without itself
  if (meocordListenerCount('unhandledRejection') > 1) return
  switch (rejectionMode(process.execArgv)) {
    // Without the flag, Bun ends the process even when the application listens for uncaught errors
    case undefined:
      printError(reason)
      process.exit(CRASH_EXIT_CODE)
      break
    // Raised as an uncaught error, which the application's listener for those handles, as Bun hands it on
    case 'throw':
      process.emit('uncaughtException', reason as Error, 'unhandledRejection')
      break
    case 'warn-with-error-code':
      process.exitCode = CRASH_EXIT_CODE
      warnRejection(reason)
      break
    // Reached once the application's uncaughtException listener has handled the rejection
    case 'strict':
      warnRejection(reason)
      break
    // 'warn' prints Bun's own warning beside a listener too, and 'none' prints nothing
  }
}

/**
 * The runtime's `--unhandled-rejections` mode: the last one given, in either the `=` or the two-argument form, or
 * `undefined` without the flag, where Bun behaves unlike any mode it names.
 */
export function rejectionMode(execArgv: readonly string[]): string | undefined {
  let mode: string | undefined
  execArgv.forEach((arg, index) => {
    if (arg === UNHANDLED_REJECTIONS_FLAG) mode = execArgv[index + 1] ?? mode
    else if (arg.startsWith(`${UNHANDLED_REJECTIONS_FLAG}=`)) mode = arg.slice(UNHANDLED_REJECTIONS_FLAG.length + 1)
  })
  return mode
}

/** Prints a crash, and something even for an error that throws as it is inspected, before the process ends. */
function printError(error: unknown): void {
  try {
    console.error(error)
  } catch {
    process.stderr.write(`${describeUnprintable(error)}\n`)
  }
}

/** What can be read of an error that throws as it is inspected: its name and message, each where it can be read. */
function describeUnprintable(error: unknown): string {
  const read = (key: 'name' | 'message') => {
    try {
      const value = (error as Record<string, unknown> | null | undefined)?.[key]
      return typeof value === 'string' ? value : undefined
    } catch {
      return undefined
    }
  }
  const name = read('name') ?? 'Error'
  const message = read('message')
  return message ? `${name}: ${message}` : `${name} (it could not be printed)`
}

function warnRejection(reason: unknown): void {
  try {
    process.emitWarning(inspect(reason), REJECTION_WARNING)
  } catch {
    // A reason that cannot be inspected is left unprinted
  }
}

/**
 * The path with links resolved and, on Windows, 8.3 short names such as RUNNER~1 expanded, as the OS
 * resolves it; runtimes name one directory either way. The path itself when it cannot be resolved.
 */
function canonical(file: string): string {
  try {
    return realpathSync.native(file)
  } catch {
    return file
  }
}

/** A call site at its source position, or the site itself when its file has no map or the map no entry. */
function remapSite(site: NodeJS.CallSite, directory: string, mapFor: (file: string) => TraceMap | null): NodeJS.CallSite {
  const name = site.getFileName()
  const line = site.getLineNumber()
  const column = site.getColumnNumber()
  if (!name || !line || !column) return site

  const file = framePath(name)
  const map = mapFor(file)
  if (!map) return site
  const position = originalPositionFor(map, { line, column: column - 1 })
  if (!position.source || position.line === null || position.column === null) return site

  // Sources are relative to the map, such as ../src/main.ts; a scheme such as webpack:// stays as written
  const source = /^[a-z][a-z\d+.-]*:\/\//i.test(position.source)
    ? position.source
    : path.resolve(directory, position.source)
  return mappedSite(site, name, source, position.line, position.column + 1)
}

/**
 * A call site that reports a source position and delegates everything else to the runtime's own. Its
 * `toString()` is the runtime's frame with only the location replaced, so the frame keeps its format. The
 * methods sit on its prototype, as a runtime's do, for hooks that clone a call site from its prototype.
 */
function mappedSite(site: NodeJS.CallSite, name: string, source: string, line: number, column: number): NodeJS.CallSite {
  const delegated: Record<string, unknown> = {}
  let prototype: object | null = Object.getPrototypeOf(site)
  for (; prototype && prototype !== Object.prototype; prototype = Object.getPrototypeOf(prototype)) {
    for (const key of Object.getOwnPropertyNames(prototype)) {
      const value = (site as unknown as Record<string, unknown>)[key]
      if (key !== 'constructor' && typeof value === 'function' && !(key in delegated)) {
        delegated[key] = (...args: unknown[]) => (value as (...args: unknown[]) => unknown).apply(site, args)
      }
    }
  }

  const location = `${source}:${line}:${column}`
  const original = `${name}:${site.getLineNumber()}:${site.getColumnNumber()}`
  const methods = Object.assign(delegated, {
    getFileName: () => source,
    getScriptNameOrSourceURL: () => source,
    getLineNumber: () => line,
    getColumnNumber: () => column,
    toString: () => {
      const frame = String(site)
      const at = frame.lastIndexOf(original)
      if (at !== -1) return frame.slice(0, at) + location + frame.slice(at + original.length)
      const functionName = site.getFunctionName()
      return functionName ? `${functionName} (${location})` : location
    },
  })
  return Object.create(methods) as NodeJS.CallSite
}

/** The stack as the runtime writes it with no hook: the error's own text, then a line per frame. */
function formatStack(error: Error, sites: NodeJS.CallSite[]): string {
  return stackHeader(error) + sites.map(frameLine).join('')
}

/** The stack's first line: the error's own text, or under Bun just `Error` for a target that is no native error. */
function stackHeader(error: Error): string {
  if (process.versions.bun && !types.isNativeError(error)) return 'Error'
  try {
    return Error.prototype.toString.call(error)
  } catch {
    return 'Error'
  }
}

function frameLine(site: NodeJS.CallSite): string {
  try {
    return `\n    at ${String(site)}`
  } catch {
    return ''
  }
}
