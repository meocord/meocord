import { type MockInstance, vi } from 'vitest'
import { stripVTControlCharacters } from 'node:util'
import { WebSocketManager } from '@discordjs/ws'
import { ChatInputCommandInteraction, Client, GatewayIntentBits } from 'discord.js'
import { Container } from 'inversify'

const { mockLoadConfig } = vi.hoisted(() => ({ mockLoadConfig: vi.fn() }))
vi.mock('@src/util/meocord-config-loader.util.js', () => ({ loadMeoCordConfig: mockLoadConfig }))

import { Logger } from '@src/common/logger.js'
import { MeoCordApp } from '@src/core/meocord.app.js'
import { createMockInteraction, createMockMessage } from '@src/testing/mock-interaction.js'

// Values the size of a bot's credential, one per spec, since what is registered stays for the run
const FROM_CONFIG = 'MTAx.from-the-bots-config.only-for-this-spec'
const FROM_APP = 'MTAy.given-to-the-app-it-runs.only-for-this-spec'
const NEVER_REGISTERED = 'MTAz.held-by-a-client-only.only-for-this-spec'

const LEVELS = ['log', 'info', 'warn', 'error', 'debug', 'verbose'] as const

const spies: MockInstance[] = []
const printed = () =>
  spies
    .flatMap(spy => spy.mock.calls.flat())
    .map(part => stripVTControlCharacters(String(part)))
    .join('\n')

/** A client as it stands once login() has begun. */
function loggedInClient(value: string): Client<true> {
  const client = new Client<true>({ intents: [GatewayIntentBits.Guilds] })
  client.token = value
  // Its gateway manager, the @discordjs/ws class discord.js builds on connect, built here without connecting
  Reflect.set(
    client.ws,
    '_ws',
    new WebSocketManager({ intents: GatewayIntentBits.Guilds, rest: client.rest, token: value, shardIds: null, shardCount: null }),
  )
  return client
}

class StatsService {
  constructor(readonly client: Client) {}
}

/** Everything a bot logs that can carry the value: structures holding the client, text, and an error and its stack. */
function logEverything(value: string): void {
  const client = loggedInClient(value)
  const logger = new Logger('Probe')
  for (const level of LEVELS) {
    logger[level]('Client:', client)
    logger[level]('Gateway:', client.ws)
    logger[level]('Service:', new StatsService(client))
    logger[level](`Logging in with ${value}`)
    logger[level]('Failed:', new Error(`Discord refused ${value}`))
  }
}

beforeEach(() => {
  mockLoadConfig.mockReturnValue(undefined)
  spies.length = 0
  for (const method of ['log', 'warn', 'error', 'debug'] as const)
    spies.push(vi.spyOn(console, method).mockImplementation(() => {}))
})

afterEach(() => {
  for (const spy of spies) spy.mockRestore()
})

describe("Logger and the bot's credential", () => {
  it('never prints the configured value, at any level, whatever carries it', () => {
    mockLoadConfig.mockReturnValue({ appName: 'TestApp', discordToken: FROM_CONFIG })

    logEverything(FROM_CONFIG)

    expect(spies.reduce((count, spy) => count + spy.mock.calls.length, 0)).toBe(LEVELS.length * 5)
    expect(printed()).not.toContain(FROM_CONFIG)
    expect(printed()).toContain('[redacted]')
  })

  it('never prints the value the app is given, from the moment the app exists', () => {
    const signals = { SIGINT: process.listeners('SIGINT'), SIGTERM: process.listeners('SIGTERM') }
    try {
      new MeoCordApp([], new Container(), new Client({ intents: [] }), FROM_APP)

      logEverything(FROM_APP)
    } finally {
      for (const signal of ['SIGINT', 'SIGTERM'] as const)
        for (const listener of process.listeners(signal))
          if (!signals[signal].includes(listener)) process.off(signal, listener)
    }

    expect(printed()).not.toContain(FROM_APP)
    expect(printed()).toContain('[redacted]')
  })

  // Nothing registers this value: only the inspection keeps it out. A logged-in client's gateway manager holds it
  // enumerable, which is why the cases above register theirs.
  it('never prints the value discord.js keeps non-enumerable on a client, through anything a handler holds', () => {
    const client = new Client<true>({ intents: [GatewayIntentBits.Guilds] })
    client.token = NEVER_REGISTERED
    const held = [
      client,
      { client },
      createMockInteraction(ChatInputCommandInteraction, { client }),
      Object.assign(createMockMessage(), { content: 'hi', client }),
    ]
    const logger = new Logger('Probe')
    for (const level of LEVELS) for (const value of held) logger[level]('Seen:', value)

    expect(spies.reduce((count, spy) => count + spy.mock.calls.length, 0)).toBe(LEVELS.length * held.length)
    expect(printed()).not.toContain(NEVER_REGISTERED)
  })
})

describe('what Logger prints of an object', () => {
  it("prints an error in full: its stack, its own properties, its cause and an AggregateError's errors", () => {
    const cause = Object.assign(new Error('the store refused'), { code: 'ECONNREFUSED' })
    new Logger().error('Failed:', new Error('Could not save', { cause }))
    new Logger().error(new AggregateError([new Error('first failure'), new Error('second failure')], 'Both failed'))

    const out = printed()
    expect(out).toContain('Error: Could not save')
    expect(out).toMatch(/\n\s+at /)
    expect(out).toContain('the store refused')
    expect(out).toContain('ECONNREFUSED')
    expect(out).toContain('first failure')
    expect(out).toContain('second failure')
  })

  it('prints data four levels below the object it is given', () => {
    new Logger().log({ guild: { settings: { roles: { staff: { id: 'level five' } } } } })
    new Logger().log({ one: { two: { three: { four: { five: { six: 'level six' } } } } } })

    expect(printed()).toContain('level five')
    expect(printed()).not.toContain('level six')
  })
})
