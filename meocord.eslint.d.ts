import type { Linter } from 'eslint'

/**
 * Lints TypeScript as a new MeoCord app does: type-aware rules, Prettier, and import cycles that break injection.
 *
 * Spread it into a rule set of your own to add or change rules, and keep the default export's other entries.
 *
 * @example
 * ```ts
 * import meocordESLint, { typescriptConfig } from 'meocord/eslint'
 *
 * export default [
 *   ...meocordESLint,
 *   { ...typescriptConfig, rules: { ...typescriptConfig.rules, '@typescript-eslint/no-deprecated': 'warn' } },
 * ]
 * ```
 *
 * @group Configuration
 * @category ESLint
 */
export declare const typescriptConfig: Linter.Config

/**
 * The ESLint configuration a new MeoCord app's `eslint.config.ts` exports, extended by the app's own rules.
 *
 * Export it from `eslint.config.ts`, spread before your own entries so they override it. To change its
 * TypeScript rules, spread {@link typescriptConfig} into an entry of your own.
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
declare const config: Linter.Config[]

export default config
