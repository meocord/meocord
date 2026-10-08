import path from 'path'
import { warnDeprecatedBehaviour } from '@src/common/deprecation.js'
import { isExplainedError } from '@src/common/explained-error.js'
import { Logger } from '@src/common/logger.js'
import { isBuiltApplication, STARTUP_ERRORS_KEY } from '@src/util/bundle-entry.util.js'
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

/**
 * Refuses a decorator that goes only on a method, or on a member, where it is applied to a class, directly or through
 * `applyDecorators`, rather than store what nothing reads or fail on the method it lacks.
 */
export function refuseOnClass(decorator: string, target: object, propertyKey: string | symbol | undefined, place = 'a method'): void {
  if (propertyKey === undefined) throw refuse(new Error(`${decoratedName(target)}: ${decorator} goes on ${place}, not on a class.`))
}

/** Refuses a decorator that goes only on a class where it is applied to a method, directly or through `applyDecorators`. */
export function refuseOnMethod(decorator: string, target: object, propertyKey: string | symbol | undefined): void {
  if (propertyKey !== undefined) throw refuse(new Error(`${decoratedName(target, propertyKey)}: ${decorator} goes on a class, not on a method.`))
}

/**
 * Whether a decorator that goes only on a class, and that 4.0 let pass on a method doing nothing, is applied to a
 * method. If so it warns once that 5.0 refuses it, and the decorator applies nothing, as in 4.0.
 */
export function deprecatedOnMethod(decorator: string, target: object, propertyKey: string | symbol | undefined): boolean {
  if (propertyKey === undefined) return false
  const old = `${decorator} on the method ${decoratedName(target, propertyKey)}`
  warnDeprecatedBehaviour(new Logger(decorator.slice(1)), old, 'is refused', `${decorator} on a class`)
  return true
}

/** Whether an error is one MeoCord raised for code it refuses. */
export function isRefusal(error: unknown): error is Error {
  return typeof error === 'object' && error !== null && (error as Record<symbol, unknown>)[REFUSAL] === true
}

// A stack frame's function and file: `at fn (file:line:col)` or `at file:line:col`, the file possibly a file:// URL
const FRAME = /^\s*at (?:(.*?) \()?(.+?):\d+:\d+\)?$/

/**
 * The first file of the application's own source an error's stack passes through, other than its entry, which only
 * loads the rest, relative to `root`. The file alone: a line from a development build's source map can be off, and a
 * compiler's decorate helper can be placed in any file, so those frames are skipped.
 */
export function sourceFileOf(error: Error, root: string, windows = process.platform === 'win32'): string | undefined {
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
    return paths.relative(root, file).split(paths.sep).join('/')
  }
  return undefined
}

/**
 * A refusal as the application reports it: the message, led by the declaration it is about where the message does not
 * name it, and the file of the application's source it comes from; see {@link sourceFileOf}.
 */
export function describeRefusal(error: Error, root: string, windows = process.platform === 'win32'): string {
  const declaration = declarationOf(error)
  const message = declaration && !error.message.startsWith(declaration) ? `${declaration}: ${error.message}` : error.message
  const file = sourceFileOf(error, root, windows)
  return file ? `${message}\n    in ${file}` : message
}

// ---------------------------------------------------------------------------
// Startup errors: those create() and a testing module's compile() find, and those decorators find at import
// ---------------------------------------------------------------------------

const STARTUP_ERRORS = Symbol.for('meocord.startupErrors')
const DECLARED = Symbol.for('meocord.declaredStartupErrors')
const ALL_DECLARED = Symbol.for('meocord.allDeclaredStartupErrors')

type Store = Record<symbol, unknown>

// The startup errors kept while checks run under collectStartupErrors; undefined outside them
let kept: Error[] | undefined

/**
 * Reports an error a startup check finds. Outside {@link collectStartupErrors} it is thrown, as a refusal; inside, it
 * is kept, and the check goes on to find the rest.
 */
export function startupError(error: Error): void {
  refuse(error)
  if (!kept) throw error
  // Two checks of one mistake, such as a class needing a translator, name it once
  if (!kept.some(other => other.message === error.message)) kept.push(error)
}

/**
 * Runs startup checks, and once they are done throws the first error they found, unchanged, with every one found on it
 * for {@link startupErrorsOf}. An error that ends the checks after one was found is left out, as one the found error
 * caused; one that ends them before any was found is thrown as it is.
 */
export function collectStartupErrors<T>(checks: () => T): T {
  const outer = kept
  const found: Error[] = []
  kept = found
  let result: T
  try {
    result = checks()
  } catch (error) {
    if (found.length === 0) throw error
    if (isRefusal(error) && !found.includes(error)) found.push(error)
    throw firstOf(found)
  } finally {
    kept = outer
  }
  if (found.length > 0) throw firstOf(found)
  return result
}

/**
 * Ends the checks under way with the errors found so far, before a step that is no check, such as binding or a warning:
 * a run with one error stops where it stopped when the first error was thrown, and the errors of one pass of the
 * checks are still reported together.
 */
export function stopOnStartupErrors(): void {
  if (kept && kept.length > 0) throw kept[0]
}

function firstOf(errors: Error[]): Error {
  const [first] = errors as [Error, ...Error[]]
  Object.defineProperty(first, STARTUP_ERRORS, { value: errors, configurable: true })
  return first
}

/** Every startup error found together with `error`, the first of them; `error` alone when it was the only one. */
export function startupErrorsOf(error: Error): readonly Error[] {
  return ((error as unknown as Store)[STARTUP_ERRORS] as Error[] | undefined) ?? [error]
}

/**
 * Logs each startup error found with `error` as the application reports a refusal, and how many there were, when there
 * was more than one; a lone error is left to whoever reports it now.
 */
export function logStartupErrors(error: Error, log: (text: string) => void, ending: string): boolean {
  const errors = startupErrorsOf(error)
  if (errors.length < 2) return false
  for (const each of errors) log(describeRefusal(each, process.cwd()))
  log(`MeoCord found ${errors.length} startup errors; ${ending}.`)
  return true
}

/** How decorators report a startup error: `'first'` throws it as the class is defined, `'all'` keeps it for create(). */
export type StartupErrorsMode = 'first' | 'all'

/** Sets how decorators report startup errors from here on, before the application's modules load. */
export function setStartupErrorsMode(mode: StartupErrorsMode): void {
  ;(globalThis as unknown as Store)[STARTUP_ERRORS_KEY] = mode
}

/** Whether decorators keep their startup errors for create(), as `startupErrors: 'all'` has them. */
export const keepsDeclaredErrors = (): boolean => (globalThis as unknown as Store)[STARTUP_ERRORS_KEY] === 'all'

/** The declaration a decorator's startup error is about, `Class.method` or `Class`. */
export function declarationOf(error: Error): string | undefined {
  return (error as unknown as { declaration?: string }).declaration
}

/**
 * A decorator that names, on each startup error it throws, the declaration it was applied to, `Class.method` or
 * `Class`, as `declaration`, and the source file it is declared in, as `file`: the same error, thrown at the same
 * moment, with its message unchanged. With `startupErrors: 'all'` the error is kept on the class instead, for create()
 * to report with the rest, and the decorator applies nothing more.
 */
export function declaring<F extends (target: any, propertyKey?: any, ...rest: any[]) => any>(decorate: F): F {
  return function (this: unknown, target: object, propertyKey?: string | symbol, ...rest: unknown[]) {
    try {
      return decorate.call(this, target, propertyKey, ...rest)
    } catch (error) {
      if (!isRefusal(error)) throw error
      keepOrThrow(error, target, propertyKey)
      return undefined
    }
  } as F
}

function keepOrThrow(error: Error, target: object, propertyKey: string | symbol | undefined): void {
  // A decorator applied through another, such as applyDecorators, names the declaration once, where it was first thrown
  if (declarationOf(error) === undefined) {
    Object.defineProperty(error, 'declaration', { value: decoratedName(target, propertyKey), configurable: true })
    Object.defineProperty(error, 'file', { get: () => sourceFileOf(error, process.cwd()), configurable: true })
  }
  if (!keepsDeclaredErrors()) throw error
  const owner = (typeof target === 'function' ? target : target.constructor) as unknown as Store
  if (!Object.prototype.hasOwnProperty.call(owner, DECLARED)) Object.defineProperty(owner, DECLARED, { value: [] })
  const declared = owner[DECLARED] as Error[]
  if (!declared.includes(error)) declared.push(error)
  const all = ((globalThis as unknown as Store)[ALL_DECLARED] ??= []) as Error[]
  if (!all.includes(error)) all.push(error)
}

/** The startup errors decorators kept on `classes` and the classes they extend, each once, in the order they were found. */
export function declaredErrorsOf(classes: Iterable<unknown>): Error[] {
  const found = new Set<Error>()
  for (const cls of classes) {
    for (let current = cls; typeof current === 'function' && current !== Function.prototype; current = Object.getPrototypeOf(current)) {
      if (Object.prototype.hasOwnProperty.call(current, DECLARED)) for (const error of (current as unknown as Store)[DECLARED] as Error[]) found.add(error)
    }
  }
  const order = allDeclaredErrors()
  return [...found].sort((a, b) => order.indexOf(a) - order.indexOf(b))
}

/** Every startup error decorators kept in this process, in the order they were found. */
export function allDeclaredErrors(): Error[] {
  return [...(((globalThis as unknown as Store)[ALL_DECLARED] as Error[] | undefined) ?? [])]
}

/** Forgets the mode and every kept error, so a spec starts afresh. */
export function forgetDeclaredErrors(): void {
  delete (globalThis as unknown as Store)[STARTUP_ERRORS_KEY]
  delete (globalThis as unknown as Store)[ALL_DECLARED]
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
