import { ButtonInteraction, ChatInputCommandInteraction, type Message, MessageFlagsBitField } from 'discord.js'
import { vi } from 'vitest'
import packageJson from '../../package.json' with { type: 'json' }
import * as errors from '@src/common/errors.js'
import { Command, Controller, MeoCord } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { CATALOGS, LOCALE_CHAIN } from '@src/common/translator.js'
import { registerClientTranslator } from '@src/common/meocord-text.js'
import { defaultPresenter, setPresenter } from '@src/common/response/presenter.js'
import { DEFAULT_THEME } from '@src/core/theme-defaults.js'
import { mergeTheme, runWithTheme } from '@src/core/theme-scope.js'
import { createMockFn, createMockInteraction, createMockMessage, getResponse, MeoCordTestingModule, withTheme } from '@src/testing/index.js'
import { forgetMockFn, useMockFn } from '@src/testing/mock-fn.js'
import { forgetStrictMocks, useStrictMocks } from '@src/testing/strict-mocks.js'
import { nextSnowflake } from '@src/testing/snowflake.js'
import { sharedKey } from '@src/util/shared-state.util.js'
import { respond, responseOf } from '@src/common/response/response-state.js'
import { callOrder, stampCall } from '@src/common/response/call-order.js'
import { createTranslator, Theme, translateError, useTheme } from '@src/common/index.js'
import { resetThemeStatics } from '@src/common/theme.js'
import { forgetDeprecationWarnings, warnOnce } from '@src/common/deprecation.js'
import { forgetHiddenValues, hideInLogs, type Logger, REDACTED } from '@src/common/logger.js'
import { LOG_LEVEL_ENV, logThreshold, resetLogLevel, takeRejectedLogLevel } from '@src/common/log-level.js'

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
    testing: await import('@src/testing/index.js'),
    response: await import('@src/common/response/response-state.js'),
    callOrder: await import('@src/common/response/call-order.js'),
    common: await import('@src/common/index.js'),
    decorator: await import('@src/decorator/index.js'),
    deprecation: await import('@src/common/deprecation.js'),
    logger: await import('@src/common/logger.js'),
    logLevel: await import('@src/common/log-level.js'),
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
      // One counter: the other build's next id follows this build's last
      const ours = BigInt(nextSnowflake())
      expect(BigInt(other.snowflake.nextSnowflake())).toBe(ours + 1n)
    } finally {
      forgetStrictMocks()
      forgetMockFn()
    }
    expect(vi.isMockFunction(createMockFn())).toBe(true)
  })

  it("reads a mock's answers, and an interaction's answer state, from either build", async () => {
    const interaction = other.testing.createMockInteraction(ChatInputCommandInteraction, { commandName: 'buy' })
    const theirs = other.response.respond(interaction)
    await theirs.send('one')

    expect(respond(interaction)).toBe(theirs)
    expect(getResponse(interaction).calls.map(call => call.method)).toEqual(['reply'])
  })

  it("reads the answers a mock of the other build got directly, without respond()", async () => {
    const interaction = other.testing.createMockInteraction(ChatInputCommandInteraction, { commandName: 'buy' })

    await interaction.reply('one')

    expect(getResponse(interaction).calls.map(call => call.method)).toEqual(['reply'])
  })

  it('orders the calls either build stamps as one sequence', () => {
    const [first, second, third] = [{}, {}, {}]
    stampCall(first)
    other.callOrder.stampCall(second)
    stampCall(third)

    expect([callOrder(first), callOrder(second), other.callOrder.callOrder(third)]).toEqual([callOrder(first), callOrder(first) + 1, callOrder(first) + 2])
  })

  it('puts a message two buttons locked, one through each build, back as it was once both release', async () => {
    const original = [{ type: 1, components: ['a', 'b'].map(custom_id => ({ type: 2, style: 1, custom_id, label: custom_id })) }]
    let current: unknown[] = original
    // The message as its last edit left it, as Discord shows it to the next click
    const message = Object.assign(createMockMessage(), { flags: new MessageFlagsBitField(0), embeds: [] }) as unknown as Message
    Object.defineProperty(message, 'components', { get: () => current.map(row => ({ toJSON: () => row })), configurable: true })
    const clickOn = (make: typeof createMockInteraction, customId: string) => {
      const interaction = make(ButtonInteraction, { customId, message })
      interaction.editReply.mockImplementation(async payload => {
        current = ((payload as { components?: unknown[] }).components ?? current) as unknown[]
        return message as never
      })
      interaction.fetchReply.mockRejectedValue(new Error('not readable'))
      return interaction
    }
    const ours = clickOn(createMockInteraction, 'a')
    const theirs = clickOn(other.testing.createMockInteraction, 'b')
    await respond(ours).acknowledge()
    await other.response.respond(theirs).acknowledge()
    await respond(ours).lock({ disable: 'clicked' })
    await other.response.respond(theirs).lock({ disable: 'clicked' })

    await responseOf(ours).release()
    await other.response.responseOf(theirs).release()

    const disabled = (current as { components: { disabled?: boolean }[] }[])[0].components.map(button => button.disabled ?? false)
    expect(disabled).toEqual([false, false])
  })

  it('follows a delete() in one build with a send() in the other as a follow-up, not an edit of the deleted reply', async () => {
    const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName: 'buy' })
    await respond(interaction).send('one')
    await other.response.respond(interaction).delete()

    await respond(interaction).send('two')

    expect(getResponse(interaction).calls.map(call => (call.error ? `${call.method}!` : call.method))).toEqual(['reply', 'deleteReply', 'followUp'])
  })

  it("reads the started app's theme outside a call from either build, until it closes", async () => {
    @MeoCord({ controllers: [], clientOptions: { intents: [] }, theme: { colors: { primary: '#0000B1' } } })
    class Bot {}
    const module = await MeoCordTestingModule.create({ app: Bot }).compile().init({ ready: true })

    const ready = other.common.useTheme().colors.primary
    await module.close()

    expect([ready, other.common.useTheme().colors.primary]).toEqual(['#0000B1', DEFAULT_THEME.colors.primary])
  })

  it("colours an answer outside a call from the other build with the app's theme, as in a collector's callback", async () => {
    let collect: ((click: ButtonInteraction) => Promise<unknown>) | undefined
    @Controller()
    class Picker {
      @Command('pick', CommandType.BUTTON)
      pick() {
        collect = click => other.response.respond(click).send({ embeds: [{ description: 'picked' }] })
      }
    }
    @MeoCord({ controllers: [Picker], clientOptions: { intents: [] }, theme: { colors: { primary: '#0000B2' } } })
    class Bot {}
    const module = MeoCordTestingModule.create({ app: Bot, controllers: [Picker] }).compile()
    const pressed = createMockInteraction(ButtonInteraction, { customId: 'pick' })
    await module.dispatch(pressed)

    const click = createMockInteraction(ButtonInteraction, { customId: 'picked', client: pressed.client })
    await collect!(click)

    expect(click.update.mock.calls[0]?.[0]).toMatchObject({ embeds: [{ color: 0x0000b2 }] })
  })

  it("runs a handler in the theme of a @UseTheme from the other build", async () => {
    let primary: unknown
    @other.decorator.UseTheme({ colors: { primary: '#0000B3' } })
    @Controller()
    class Shop {
      @Command('buy', CommandType.BUTTON)
      buy() {
        primary = useTheme().colors.primary
      }
    }
    const module = MeoCordTestingModule.create({ controllers: [Shop] }).compile()

    await module.invoke(Shop, 'buy', createMockInteraction(ButtonInteraction, { customId: 'buy' }))

    expect(primary).toBe('#0000B3')
  })

  it('keeps what the deprecated Theme statics set through either build, beneath every theme', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      other.common.Theme.primaryColor = '#0000B4'
      Theme.successColor = '#0000B5'

      expect([useTheme().colors.primary, other.common.useTheme().colors.success]).toEqual(['#0000B4', '#0000B5'])
    } finally {
      resetThemeStatics()
    }
  })

  it("runs a mock theme the other build's createMockTheme made as it is", () => {
    const theme = other.testing.createMockTheme({ colors: { primary: '#0000B6' } })

    expect(withTheme(theme, () => useTheme())).toBe(theme)
  })

  it("translates the issues of a usage error the other build made", () => {
    const t = createTranslator({ default: 'en-US', locales: { 'en-US': {}, id: { meocord: { usage: { heading: 'Cara pakai: {usage}', serverOnly: 'Hanya di server.' } } } } })
    const error = new other.errors.MessageUsageError('!ban <who>', [other.text.usageIssue({ key: 'meocord.usage.serverOnly' })])

    expect(translateError(error, t, 'id')).toBe('Cara pakai: !ban <who>\nHanya di server.')
  })

  it('prints a warn-once text both builds ask for once', () => {
    const logger = { warn: vi.fn() } as unknown as Logger
    try {
      warnOnce(logger, 'Shared.text is deprecated.')
      other.deprecation.warnOnce(logger, 'Shared.text is deprecated.')

      expect(logger.warn).toHaveBeenCalledTimes(1)
    } finally {
      forgetDeprecationWarnings()
    }
  })

  it('resolves the log level once for both builds, and hands out an unknown MEOCORD_LOG_LEVEL once', () => {
    vi.stubEnv(LOG_LEVEL_ENV, 'loud')
    resetLogLevel()
    try {
      const ours = logThreshold()
      vi.stubEnv(LOG_LEVEL_ENV, 'error')

      expect(other.logLevel.logThreshold()).toBe(ours)
      expect([other.logLevel.takeRejectedLogLevel(), takeRejectedLogLevel()]).toEqual(['loud', undefined])
    } finally {
      vi.unstubAllEnvs()
      resetLogLevel()
    }
  })

  it("keeps a value either build hides out of the other's lines", () => {
    const value = 'MTA0.a-value-the-size-of-a-credential.shared-state-spec'
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.stubEnv(LOG_LEVEL_ENV, 'log')
    resetLogLevel()
    try {
      hideInLogs(value)
      new other.logger.Logger().log(`token ${value}`)

      expect(String(log.mock.calls[0])).toContain(`token ${REDACTED}`)
      expect(String(log.mock.calls[0])).not.toContain(value)
    } finally {
      log.mockRestore()
      vi.unstubAllEnvs()
      resetLogLevel()
      forgetHiddenValues()
    }
  })

  it('keeps its keys to this version, apart from any other installed one', () => {
    expect(sharedKey('themeScope')).toBe(Symbol.for(`meocord@${packageJson.version}:themeScope`))
    expect(sharedKey('themeScope')).not.toBe(Symbol.for('meocord@0.0.0:themeScope'))
  })
})
