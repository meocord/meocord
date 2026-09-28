import path from 'path'
import { isExplainedError } from '@src/common/explained-error.js'
import { Logger } from '@src/common/logger.js'
import { isBuiltApplication } from '@src/util/bundle-entry.util.js'

const REFUSAL = Symbol.for('meocord.refusal')

/** Whether this process reports refusals yet; see `reportRefusals`. */
let reporting = false

/**
 * Marks an error MeoCord raises for code it refuses as the application loads, such as a decorator given what it
 * cannot use, so the built application reports it as one line rather than a stack. The error is otherwise unchanged.
 */
export function refuse<E extends Error>(error: E): E {
  if (Object.isExtensible(error)) Object.defineProperty(error, REFUSAL, { value: true, enumerable: false })
  // Before the error is thrown, so a built application reports it however the throw ends
  if (!reporting && isBuiltApplication()) reportRefusals()
  return error
}

/** What a decorator is applied to, as a refusal names it: `Class.method` on a method, `Class` on a class. */
export function decoratedName(target: object, propertyKey?: string | symbol): string {
  if (propertyKey === undefined) return (target as { name?: string }).name || 'a class'
  return `${(target as { constructor: { name: string } }).constructor.name}.${String(propertyKey)}`
}

/** Whether an error is one MeoCord raised for code it refuses. */
export function isRefusal(error: unknown): error is Error {
  return typeof error === 'object' && error !== null && (error as Record<symbol, unknown>)[REFUSAL] === true
}

// A stack frame's function and file: `at fn (file:line:col)` or `at file:line:col`, the file possibly a file:// URL
const FRAME = /^\s*at (?:(.*?) \()?(?:file:\/\/)?(.+?):\d+:\d+\)?$/

/**
 * A refusal as the application reports it: the message, and the first file of the application's own source the stack
 * passes through, other than its entry, which only loads the rest. The file alone: a line from a development build's
 * source map can be off, and a compiler's decorate helper can be placed in any file, so those frames are skipped.
 */
export function describeRefusal(error: Error, root: string): string {
  const source = path.join(root, 'src') + path.sep
  const entry = path.join(source, 'main.ts')
  for (const line of (error.stack ?? '').split('\n').slice(1)) {
    const [, fn, file] = FRAME.exec(line) ?? []
    if (!file?.startsWith(source) || file === entry || file.includes(`${path.sep}node_modules${path.sep}`)) continue
    if (fn?.endsWith('decorate')) continue
    return `${error.message}\n    in ${path.relative(root, file).split(path.sep).join('/')}`
  }
  return error.message
}

/**
 * Reports a refusal the application doesn't catch as one line, with where it is in the source, and exits 1. A
 * monitor, so any other error keeps the runtime's own report. Installed by the first refusal in a built application;
 * a test or script that throws one gets the error as it is.
 */
export function reportRefusals(
  log: (text: string) => void = text => new Logger('MeoCord').error(text),
  exit: (code: number) => void = code => process.exit(code),
): void {
  reporting = true
  process.on('uncaughtExceptionMonitor', error => {
    if (!isRefusal(error)) return
    if (!isExplainedError(error)) log(describeRefusal(error, process.cwd()))
    exit(1)
  })
}
