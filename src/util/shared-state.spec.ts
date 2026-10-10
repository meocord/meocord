import { ChatInputCommandInteraction } from 'discord.js'
import { vi } from 'vitest'
import packageJson from '../../package.json' with { type: 'json' }
import * as errors from '@src/common/errors.js'
import { Command, Controller } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { CATALOGS, LOCALE_CHAIN } from '@src/common/translator.js'
import { registerClientTranslator } from '@src/common/meocord-text.js'
import { defaultPresenter, setPresenter } from '@src/common/response/presenter.js'
import { DEFAULT_THEME } from '@src/core/theme-defaults.js'
import { mergeTheme, runWithTheme } from '@src/core/theme-scope.js'
import { createMockFn, createMockInteraction, getResponse, MeoCordTestingModule } from '@src/testing/index.js'
import { forgetMockFn, useMockFn } from '@src/testing/mock-fn.js'
import { forgetStrictMocks, useStrictMocks } from '@src/testing/strict-mocks.js'
import { nextSnowflake } from '@src/testing/snowflake.js'
import { sharedKey } from '@src/util/shared-state.util.js'

// The other build of this version, as a CommonJS file beside ES module ones loads it: the same source, made again
async function otherBuild() {
  vi.resetModules()
  return {
    errors: await import('@src/common/errors.js'),
    translator: await import('@src/common/translator.js'),
    text: await import('@src/common/meocord-text.js'),
    presenter: await import('@src/common/response/presenter.js'),
    theme: await import('@src/core/theme-scope.js'),
    mockFn: await import('@src/testing/mock-fn.js'),
    strict: await import('@src/testing/strict-mocks.js'),
    snowflake: await import('@src/testing/snowflake.js'),
  }
}

const ERRORS = ['GuardDeniedError', 'UserError', 'CommandNotFoundError', 'ValidationError', 'MessageUsageError', 'CooldownError', 'CooldownStoreError'] as const

describe('state the two builds of one meocord version share', () => {
  let other: Awaited<ReturnType<typeof otherBuild>>
  beforeAll(async () => {
    other = await otherBuild()
  })

  it('is two copies of each module, as two builds are', () => {
    expect(other.errors.UserError).not.toBe(errors.UserError)
  })

  it.each(ERRORS)('makes an error of either build an instance of the other build’s %s', name => {
    const Theirs = other.errors[name] as unknown as new (...args: any[]) => Error
    const Ours = errors[name] as unknown as new (...args: any[]) => Error
    const instance = Object.create(Theirs.prototype) as Error

    expect(instance instanceof Ours).toBe(true)
    expect(Object.create(Ours.prototype) instanceof Theirs).toBe(true)
    // Each class its own brand: another error of the other build is not this one
    const another = name === 'UserError' ? other.errors.GuardDeniedError : other.errors.UserError
    expect(Object.create(another.prototype) instanceof Ours).toBe(false)
  })

  it('keeps an app’s subclass of UserError matching only its own instances', () => {
    class NotEnoughCoinsError extends errors.UserError {}

    expect(new other.errors.UserError('x') instanceof NotEnoughCoinsError).toBe(false)
    expect(new NotEnoughCoinsError('x') instanceof other.errors.UserError).toBe(true)
    expect(new NotEnoughCoinsError('x') instanceof errors.GuardDeniedError).toBe(false)
  })

  it('answers a UserError from the other build as the user’s outcome', async () => {
    @Controller()
    class Shop {
      @Command('buy', CommandType.SLASH)
      buy() {
        throw new other.errors.UserError('You need 5 more coins.')
      }
    }
    const module = MeoCordTestingModule.create({ controllers: [Shop] }).compile()
    const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName: 'buy' })

    await module.dispatch(interaction)

    expect(JSON.stringify(getResponse(interaction).calls.at(-1)?.payload)).toContain('You need 5 more coins.')
  })

  it("reads a translator's catalogs, a client's translator and its presenter from either build", () => {
    const client = {}
    const translator = {} as never
    const presenter = { ...defaultPresenter }
    registerClientTranslator(client, translator)
    setPresenter(client, presenter)

    expect(other.translator.CATALOGS).toBe(CATALOGS)
    expect(other.translator.LOCALE_CHAIN).toBe(LOCALE_CHAIN)
    expect(other.text.translatorOfClient(client)).toBe(translator)
    expect(other.presenter.presenterFor(client)).toBe(presenter)
  })

  it("reads a call's theme from either build", () => {
    const theme = mergeTheme(DEFAULT_THEME as never, { colors: { primary: '#123456' } })

    expect(runWithTheme(theme, () => other.theme.useTheme().colors.primary)).toBe('#123456')
  })

  it('applies mock settings made in either build, and gives every mock an id of its own', () => {
    // The mocks made so far, by the cases above, forgotten: both settings go before any mock
    forgetStrictMocks()
    forgetMockFn()
    try {
      useStrictMocks()
      useMockFn(vi.fn)

      expect(other.strict.strictMocks()).toBe(true)
      expect(other.mockFn.usesRunnerMockFn()).toBe(true)
      expect(vi.isMockFunction(other.mockFn.createMockFn())).toBe(true)
      expect(new Set([nextSnowflake(), other.snowflake.nextSnowflake(), nextSnowflake()]).size).toBe(3)
    } finally {
      forgetStrictMocks()
      forgetMockFn()
    }
    expect(vi.isMockFunction(createMockFn())).toBe(true)
  })

  it('keeps its keys to this version, apart from any other installed one', () => {
    expect(sharedKey('themeScope')).toBe(Symbol.for(`meocord@${packageJson.version}:themeScope`))
    expect(sharedKey('themeScope')).not.toBe(Symbol.for('meocord@0.0.0:themeScope'))
  })
})
