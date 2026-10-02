import path from 'path'
import { isExplainedError } from '@src/common/explained-error.js'
import { Logger } from '@src/common/logger.js'
import { isBuiltApplication } from '@src/util/bundle-entry.util.js'
import { comparablePath, framePath } from '@src/util/source-path.util.js'

const REFUSAL = Symbol.for('meocord.refusal')

/** Whether this process reports refusals yet; see `reportRefusals`. */
let reporting = false

/** Refusals someone else reports, and ends the process for, which `reportRefusals` leaves to them. */
const handedOff = new WeakSet<object>()

/** Leaves a refusal to whoever reports it instead, such as a shard's manager: going uncaught, it is neither logged nor exits. */
export function handOffRefusal(error: Error): void {
  handedOff.add(error)
}

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
const FRAME = /^\s*at (?:(.*?) \()?(.+?):\d+:\d+\)?$/

/**
 * A refusal as the application reports it: the message, and the first file of the application's own source the stack
 * passes through, other than its entry, which only loads the rest. The file alone: a line from a development build's
 * source map can be off, and a compiler's decorate helper can be placed in any file, so those frames are skipped.
 */
export function describeRefusal(error: Error, root: string, windows = process.platform === 'win32'): string {
  const paths = windows ? path.win32 : path.posix
  const source = comparablePath(paths.join(root, 'src') + paths.sep, windows)
  const entry = comparablePath(paths.join(root, 'src', 'main.ts'), windows)
  const dependencies = comparablePath(`${paths.sep}node_modules${paths.sep}`, windows)
  for (const line of (error.stack ?? '').split('\n').slice(1)) {
    const [, fn, name] = FRAME.exec(line) ?? []
    if (!name || fn?.endsWith('decorate')) continue
    const file = paths.normalize(framePath(name, windows))
    const compared = comparablePath(file, windows)
    if (!compared.startsWith(source) || compared === entry || compared.includes(dependencies)) continue
    return `${error.message}\n    in ${paths.relative(root, file).split(paths.sep).join('/')}`
  }
  return error.message
}

/**
 * Reports a refusal nothing catches as one line, with its source file, and exits 1; other errors keep the runtime's
 * report. Installed by the first refusal in a built application. Bun has no monitor event for a rejection, so there a
 * listener reports a refused rejection and rejects any other again without itself, unless the app listens itself.
 */
export function reportRefusals(
  log: (text: string) => void = text => new Logger('MeoCord').error(text),
  exit: (code: number) => void = code => process.exit(code),
  { bun = process.versions.bun !== undefined, reject = (reason: unknown) => void Promise.reject(reason) } = {},
): void {
  reporting = true
  const report = (error: Error) => {
    if (handedOff.has(error)) return
    if (!isExplainedError(error)) log(describeRefusal(error, process.cwd()))
    exit(1)
  }
  process.on('uncaughtExceptionMonitor', error => {
    if (isRefusal(error)) report(error)
  })
  if (!bun) return

  const onRejection = (reason: unknown) => {
    // An application that listens for rejections handles them, a refusal too, as under Node, where the monitor sees
    // none it handles; this listener stays, for when it no longer does
    if (process.listenerCount('unhandledRejection') > 1) return
    if (isRefusal(reason)) return report(reason)
    process.off('unhandledRejection', onRejection)
    reject(reason)
  }
  process.on('unhandledRejection', onRejection)
}
