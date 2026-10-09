import { setStartupErrorsMode } from '@src/util/refusal.util.js'

/**
 * Has decorators keep the startup errors they find, as a bot built with `startupErrors: 'all'` does, so a testing
 * module reports every one at once.
 *
 * Call it once in the test runner's setup file, before any test imports a controller: a decorator runs when its class
 * is defined, as its file is imported. A decorator given what it cannot use then throws nothing as the file loads, and
 * `MeoCordTestingModule.create(...).compile()` logs every startup error of the classes it runs, each with its handler
 * and file, then throws the first. Without it, a decorator throws its error as its class is defined.
 *
 * @example
 * ```ts
 * // vitest.setup.ts
 * reportAllStartupErrors()
 * ```
 *
 * @group Testing
 * @category Module
 * @see {@link MeoCordTestingModule}
 * @see {@link https://meocord.dev/docs/4.2/configuration | Configuration}
 */
export function reportAllStartupErrors(): void {
  setStartupErrorsMode('all')
}
