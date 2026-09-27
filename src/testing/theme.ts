import { type DeepReadonly, type MeoCordTheme, type RootTheme } from '@src/interface/index.js'
import { assertValidTheme } from '@src/core/theme-validation.js'
import { copyLayer, defaultTheme, mergeTheme, runWithTheme, type ResolvedTheme } from '@src/core/theme-scope.js'

/** A theme's parts, as the app's root theme takes them: required when the app has added tokens, since those have no default. */
type MockThemeArgs = Partial<RootTheme> extends RootTheme ? [overrides?: RootTheme] : [overrides: RootTheme]

// Themes createMockTheme made, which withTheme uses as they are
const mocks = new WeakSet<object>()

function mockTheme(overrides: unknown, where: string): ResolvedTheme {
  if (overrides === undefined) return defaultTheme()
  assertValidTheme(overrides, where)
  const theme = mergeTheme(defaultTheme(), copyLayer(overrides) as RootTheme)
  mocks.add(theme)
  return theme
}

/**
 * Makes a whole theme for a test: MeoCord's defaults with `overrides` merged over them, frozen.
 *
 * It is the theme as `useTheme()` reads it: pass it where code takes a theme, run code in it with {@link withTheme},
 * or compare against it. `createMockTheme()` is the theme a testing module with no theme reads.
 *
 * @remarks
 * When the app adds tokens to the theme, `overrides` gives them, as `@MeoCord({ theme })` does, since MeoCord has no
 * default for them.
 *
 * @param overrides - The roles to change, in any group, checked as `@MeoCord({ theme })` checks them.
 * @throws Error naming each token that is not valid.
 *
 * @example
 * ```ts
 * import { expect } from 'vitest'
 *
 * const refunded = () => new EmbedBuilder().setColor(useTheme().colors.danger).setTitle('Refunded')
 * const embed = withTheme(createMockTheme({ colors: { danger: '#E3606D' } }), refunded)
 * expect(embed.data.color).toBe(0xe3606d)
 * ```
 *
 * @group Testing
 * @category Mocks
 * @see {@link withTheme}
 * @see {@link https://meocord.dev/docs/latest/theming | Theming}
 */
export function createMockTheme(...[overrides]: MockThemeArgs): DeepReadonly<MeoCordTheme> {
  return mockTheme(overrides, 'createMockTheme')
}

/**
 * Runs `fn` with `theme` as the theme of the call, as a handler's call runs.
 *
 * Use it for a service or presenter tested without a testing module: `useTheme()` in `fn`, and in everything it awaits
 * or starts, reads `theme`.
 *
 * @param theme - A theme {@link createMockTheme} made, used as it is, or the roles to change, merged over the defaults
 *   as `createMockTheme` merges them.
 * @param fn - The code to run.
 * @returns What `fn` returns, a promise included.
 * @throws Error naming each token that is not valid.
 *
 * @example
 * ```ts
 * import { expect } from 'vitest'
 *
 * const saved = (what: string) => `${useTheme().emojis.success} ${what} saved`
 * expect(withTheme({ emojis: { success: '🎉' } }, () => saved('Profile'))).toBe('🎉 Profile saved')
 * ```
 *
 * @group Testing
 * @category Mocks
 * @see {@link createMockTheme}
 */
export function withTheme<T>(theme: DeepReadonly<MeoCordTheme> | RootTheme, fn: () => T): T {
  const resolved = mocks.has(theme) || theme === defaultTheme() ? (theme as ResolvedTheme) : mockTheme(theme, 'withTheme')
  return runWithTheme(resolved, fn)
}
