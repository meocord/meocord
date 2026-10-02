import type { Linter } from 'eslint'

/**
 * The ESLint configuration a new MeoCord app's `eslint.config.ts` exports, extended by the app's own rules.
 *
 * `require('meocord/eslint')` is the array itself, with the TypeScript entry on it as `typescriptConfig`, so an
 * app spreads it before its own entries and overrides it there.
 *
 * @example
 * ```ts
 * import meocordESLint from 'meocord/eslint'
 *
 * // Generated code is not linted
 * export default [...meocordESLint, { ignores: ['src/generated/**'] }]
 * ```
 *
 * @group Configuration
 * @category ESLint
 */
declare const config: Linter.Config[] & {
  /** Lints TypeScript as a new MeoCord app does: type-aware rules, Prettier, and import cycles that break injection. */
  typescriptConfig: Linter.Config
}

export = config
