import { describe, expectTypeOf, it } from 'vitest'
import { type DeepReadonly, type MeoCordTheme, type ThemeOverride, type ThemeResolver, type ThemeResolvers } from '@src/interface/index.js'
import { type ThemeCache } from '@src/common/index.js'
import { createMockTheme, MeoCordTestingModule, type TestingModule, type TestingModuleBuilder, withTheme } from '@src/testing/index.js'

/** Runs under `vitest --typecheck`. */

describe('createMockTheme', () => {
  it('returns a whole, readonly theme, and takes part of one', () => {
    expectTypeOf(createMockTheme()).toEqualTypeOf<DeepReadonly<MeoCordTheme>>()
    expectTypeOf(createMockTheme({ colors: { primary: '#7680F4' } })).toEqualTypeOf<DeepReadonly<MeoCordTheme>>()
    // @ts-expect-error a role no group has
    createMockTheme({ colors: { primry: '#7680F4' } })
  })
})

describe('withTheme', () => {
  it('returns what the function returns, and takes a mock theme or part of one', () => {
    expectTypeOf(withTheme(createMockTheme(), () => 1)).toEqualTypeOf<number>()
    expectTypeOf(withTheme({ emojis: { loading: '⌛' } }, async () => 'x')).toEqualTypeOf<Promise<string>>()
    // @ts-expect-error a role no group has
    withTheme({ emojis: { spinner: '⌛' } }, () => undefined)
  })
})

describe('the builder and the module', () => {
  it('chain the theme overrides, and expose the module\'s cache', () => {
    const builder = MeoCordTestingModule.create({ controllers: [] })
    expectTypeOf(builder.overrideTheme({ colors: { primary: '#7680F4' } })).toEqualTypeOf<TestingModuleBuilder>()
    expectTypeOf(builder.overrideThemeFor({ guild: async () => undefined })).toEqualTypeOf<TestingModuleBuilder>()
    expectTypeOf(builder.overrideThemeFor).parameter(0).toEqualTypeOf<ThemeResolvers | (new (...args: any[]) => ThemeResolver) | undefined>()
    expectTypeOf(builder.overrideTheme).parameter(0).toEqualTypeOf<ThemeOverride>()
    expectTypeOf<TestingModule['themeCache']>().toEqualTypeOf<ThemeCache>()
    // @ts-expect-error a role no group has
    builder.overrideTheme({ colors: { primry: '#7680F4' } })
  })
})
