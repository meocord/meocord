import { existsSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { types } from 'node:util'
import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping'
// Relative: the pre-entry that imports this file is bundled from its source, where no alias resolves
import { comparablePath, framePath } from '../util/source-path.util.js'

type PrepareStackTrace = (error: Error, sites: NodeJS.CallSite[]) => unknown

/**
 * Maps stack traces to the source through the `.map` beside the bundle, when the runtime maps nothing itself:
 * under Bun, or Node without `--enable-source-maps`. A hook already set receives the mapped call sites, and
 * each map is read the first time a stack needs it. Returns whether the hook was installed.
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
  return true
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
