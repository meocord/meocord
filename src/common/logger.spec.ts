import { vi, type MockInstance } from 'vitest'

vi.mock('@src/util/meocord-config-loader.util.js', () => ({
  loadMeoCordConfig: vi.fn().mockReturnValue({ appName: 'TestApp', discordToken: 'token' }),
}))

import { stripVTControlCharacters } from 'node:util'
import { ChatInputCommandInteraction, Client, GatewayIntentBits } from 'discord.js'
import { Logger } from '@src/common/logger.js'
import { resetLogLevel } from '@src/common/log-level.js'
import { loadMeoCordConfig } from '@src/util/meocord-config-loader.util.js'
import { BUNDLE_ENTRY_KEY } from '@src/util/bundle-entry.util.js'
import { type MeoCordConfig } from '@src/interface/index.js'
import { createMockInteraction, createMockMessage } from '@src/testing/mock-interaction.js'

describe('Logger', () => {
  let logSpy: MockInstance<typeof console.log>
  let warnSpy: MockInstance<typeof console.warn>
  let errorSpy: MockInstance<typeof console.error>
  let debugSpy: MockInstance<typeof console.debug>

  beforeEach(() => {
    // Every level shows, so each method's own console call is what these check
    vi.stubEnv('MEOCORD_LOG_LEVEL', 'debug')
    resetLogLevel()
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
  })

  it('calls console.log for log()', () => {
    new Logger('Ctx').log('message')
    expect(logSpy).toHaveBeenCalledTimes(1)
  })

  it('calls console.log for info()', () => {
    new Logger().info('message')
    expect(logSpy).toHaveBeenCalledTimes(1)
  })

  it('calls console.warn for warn()', () => {
    new Logger().warn('message')
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })

  it('calls console.error for error()', () => {
    new Logger().error('message')
    expect(errorSpy).toHaveBeenCalledTimes(1)
  })

  it('calls console.debug for debug()', () => {
    new Logger().debug('message')
    expect(debugSpy).toHaveBeenCalledTimes(1)
  })

  it('calls console.log for verbose()', () => {
    new Logger().verbose('message')
    expect(logSpy).toHaveBeenCalledTimes(1)
  })

  it('does not log when called with no arguments', () => {
    new Logger().log()
    expect(logSpy).not.toHaveBeenCalled()
  })

  it('handles object arguments without throwing', () => {
    expect(() => new Logger().log({ key: 'value' })).not.toThrow()
    expect(logSpy).toHaveBeenCalledTimes(1)
  })

  it('handles multiple arguments', () => {
    new Logger().log('a', 'b', 'c')
    expect(logSpy).toHaveBeenCalledTimes(1)
  })

  it('works without a context', () => {
    expect(() => new Logger().log('no context')).not.toThrow()
  })
})

describe('what Logger prints of an object', () => {
  const HIDDEN = 'a-non-enumerable-value-only-for-this-spec'
  const printed = (spies: MockInstance[]) =>
    spies.flatMap(spy => spy.mock.calls.flat()).map(part => stripVTControlCharacters(String(part))).join('\n')

  beforeEach(() => {
    vi.stubEnv('MEOCORD_LOG_LEVEL', 'debug')
    resetLogLevel()
  })

  it('never prints what discord.js keeps non-enumerable, at any level', () => {
    const spies = (['log', 'warn', 'error', 'debug'] as const).map(method =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    )
    // A ready client, as the one a handler's interaction holds
    const client = new Client<true>({ intents: [GatewayIntentBits.Guilds] })
    client.token = HIDDEN
    // What a handler logs holds the client, as every interaction, message and guild does
    const held = [
      client,
      { client },
      createMockInteraction(ChatInputCommandInteraction, { client }),
      createMockMessage({ content: 'hi', client }),
    ]
    const logger = new Logger('Probe')
    for (const level of ['log', 'info', 'warn', 'error', 'debug', 'verbose'] as const)
      for (const value of held) logger[level]('Seen:', value)

    expect(spies.reduce((count, spy) => count + spy.mock.calls.length, 0)).toBe(24)
    expect(printed(spies)).not.toContain(HIDDEN)
  })

  it("prints an error in full: its stack, its own properties, its cause and an AggregateError's errors", () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const cause = Object.assign(new Error('the store refused'), { code: 'ECONNREFUSED' })
    new Logger().error('Failed:', new Error('Could not save', { cause }))
    new Logger().error(new AggregateError([new Error('first failure'), new Error('second failure')], 'Both failed'))

    const out = printed([errorSpy])
    expect(out).toContain('Error: Could not save')
    expect(out).toMatch(/\n\s+at /)
    expect(out).toContain('the store refused')
    expect(out).toContain('ECONNREFUSED')
    expect(out).toContain('first failure')
    expect(out).toContain('second failure')
  })

  it('prints data four levels below the object it is given', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    new Logger().log({ guild: { settings: { roles: { staff: { id: 'level five' } } } } })
    new Logger().log({ one: { two: { three: { four: { five: { six: 'level six' } } } } } })

    const out = printed([logSpy])
    expect(out).toContain('level five')
    expect(out).not.toContain('level six')
  })
})

describe('Logger levels', () => {
  const printed = () =>
    [console.debug, console.log, console.warn, console.error].flatMap(method =>
      vi.mocked(method).mock.calls.map(call => stripVTControlCharacters(call.map(String).join(' '))),
    )
  const logEveryLevel = () => {
    const logger = new Logger()
    logger.debug('d')
    logger.log('l')
    logger.info('i')
    logger.verbose('v')
    logger.warn('w')
    logger.error('e')
  }
  const levelsShown = () =>
    printed()
      .map(line => /\[(DEBUG|LOG|WARN|ERROR)\]/.exec(line)?.[1])
      .join(',')

  beforeEach(() => {
    for (const method of ['debug', 'log', 'warn', 'error'] as const) vi.spyOn(console, method).mockImplementation(() => {})
    vi.mocked(loadMeoCordConfig).mockClear().mockReturnValue({ discordToken: 'token' })
    vi.stubEnv('MEOCORD_LOG_LEVEL', undefined)
    // As the pre-entry of a built bot records it: the config's logLevel applies only there
    Reflect.set(globalThis, BUNDLE_ENTRY_KEY, '/app/dist/main.js')
    resetLogLevel()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    Reflect.deleteProperty(globalThis, BUNDLE_ENTRY_KEY)
    resetLogLevel()
  })

  // Loading dist/meocord.config.mjs runs its dotenv import: a test or the CLI would get .env mid-run
  it('reads nothing from dist outside a built application, so no appName and no config side effects', () => {
    Reflect.deleteProperty(globalThis, BUNDLE_ENTRY_KEY)
    vi.mocked(loadMeoCordConfig).mockReturnValue({ discordToken: 'token', appName: 'Meo' })

    logEveryLevel()

    expect(loadMeoCordConfig).not.toHaveBeenCalled()
    expect(printed()).not.toContainEqual(expect.stringContaining('[Meo]'))
    expect(levelsShown()).toBe('LOG,LOG,LOG,WARN,ERROR')
  })

  it('names the app in a built application', () => {
    vi.mocked(loadMeoCordConfig).mockReturnValue({ discordToken: 'token', appName: 'Meo' })

    new Logger().log('hello')

    expect(printed()).toEqual([expect.stringMatching(/^\[Meo\] .*\[LOG\] hello$/)])
  })

  it('leaves logLevel to the built bot: the CLI and tests go by MEOCORD_LOG_LEVEL and the default', () => {
    Reflect.deleteProperty(globalThis, BUNDLE_ENTRY_KEY)
    vi.mocked(loadMeoCordConfig).mockReturnValue({ discordToken: 'token', logLevel: 'silent' } as MeoCordConfig)

    logEveryLevel()
    expect(levelsShown()).toBe('LOG,LOG,LOG,WARN,ERROR')

    resetLogLevel()
    vi.stubEnv('MEOCORD_LOG_LEVEL', 'error')
    for (const method of ['debug', 'log', 'warn', 'error'] as const) vi.mocked(console[method]).mockClear()
    logEveryLevel()
    expect(levelsShown()).toBe('ERROR')
  })

  it('shows debug in development, as under meocord start --dev', () => {
    vi.stubEnv('NODE_ENV', 'development')

    logEveryLevel()

    expect(levelsShown()).toBe('DEBUG,LOG,LOG,LOG,WARN,ERROR')
  })

  it('hides debug anywhere else', () => {
    for (const env of ['production', 'test', undefined]) {
      vi.stubEnv('NODE_ENV', env)
      resetLogLevel()
      for (const method of ['debug', 'log', 'warn', 'error'] as const) vi.mocked(console[method]).mockClear()

      logEveryLevel()

      expect(levelsShown()).toBe('LOG,LOG,LOG,WARN,ERROR')
    }
  })

  it.each([
    ['debug', 'DEBUG,LOG,LOG,LOG,WARN,ERROR'],
    ['log', 'LOG,LOG,LOG,WARN,ERROR'],
    ['warn', 'WARN,ERROR'],
    ['error', 'ERROR'],
    ['silent', ''],
  ] as const)('shows what logLevel %s allows', (level, shown) => {
    vi.mocked(loadMeoCordConfig).mockReturnValue({ discordToken: 'token', logLevel: level } as MeoCordConfig)

    logEveryLevel()

    expect(levelsShown()).toBe(shown)
  })

  it('takes MEOCORD_LOG_LEVEL over the config and the environment', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('MEOCORD_LOG_LEVEL', 'error')
    vi.mocked(loadMeoCordConfig).mockReturnValue({ discordToken: 'token', logLevel: 'debug' } as MeoCordConfig)

    logEveryLevel()

    expect(levelsShown()).toBe('ERROR')
  })

  it('warns once about an unknown MEOCORD_LOG_LEVEL, naming the levels, and falls back to the config', () => {
    vi.stubEnv('MEOCORD_LOG_LEVEL', 'verbose')
    vi.mocked(loadMeoCordConfig).mockReturnValue({ discordToken: 'token', logLevel: 'warn' } as MeoCordConfig)

    logEveryLevel()
    logEveryLevel()

    const warnings = printed().filter(line => line.includes('MEOCORD_LOG_LEVEL'))
    expect(warnings).toEqual([expect.stringContaining('MEOCORD_LOG_LEVEL is "verbose", which is not a log level: use debug, log, warn, error or silent.')])
    // Grouped by console method: the warning and two warns, then two errors
    expect(levelsShown()).toBe('WARN,WARN,WARN,ERROR,ERROR')
  })

  it.each(['error', 'silent'] as const)('warns about an unknown MEOCORD_LOG_LEVEL under logLevel %s, which hides warnings', level => {
    vi.stubEnv('MEOCORD_LOG_LEVEL', 'verbose')
    vi.mocked(loadMeoCordConfig).mockReturnValue({ discordToken: 'token', logLevel: level } as MeoCordConfig)

    logEveryLevel()
    logEveryLevel()

    expect(printed().filter(line => line.includes('MEOCORD_LOG_LEVEL'))).toEqual([
      expect.stringContaining('MEOCORD_LOG_LEVEL is "verbose", which is not a log level: use debug, log, warn, error or silent.'),
    ])
    expect(printed().filter(line => !line.includes('MEOCORD_LOG_LEVEL'))).toHaveLength(level === 'error' ? 2 : 0)
  })

  it.each(['DEBUG', 'Debug'])('reads MEOCORD_LOG_LEVEL=%s as debug', value => {
    vi.stubEnv('MEOCORD_LOG_LEVEL', value)

    logEveryLevel()

    expect(levelsShown()).toBe('DEBUG,LOG,LOG,LOG,WARN,ERROR')
  })

  it('reads MEOCORD_LOG_LEVEL after loading the config, which may load it from .env', () => {
    vi.mocked(loadMeoCordConfig).mockImplementation(() => {
      process.env.MEOCORD_LOG_LEVEL = 'error'
      return { discordToken: 'token' }
    })

    logEveryLevel()

    expect(levelsShown()).toBe('ERROR')
  })

  // Resolved once, so a busy bot does not read process.env on every call
  it('keeps the level it resolved first until reset', () => {
    new Logger().debug('before')
    vi.stubEnv('MEOCORD_LOG_LEVEL', 'debug')
    new Logger().debug('still hidden')
    resetLogLevel()
    new Logger().debug('shown')

    expect(printed()).toEqual([expect.stringContaining('shown')])
  })

  it('formats nothing it does not show', () => {
    const inspected = { [Symbol.for('nodejs.util.inspect.custom')]: vi.fn(() => 'x') }

    new Logger().debug(inspected)

    expect(inspected[Symbol.for('nodejs.util.inspect.custom')]).not.toHaveBeenCalled()
    expect(loadMeoCordConfig).toHaveBeenCalledTimes(1)
  })
})

