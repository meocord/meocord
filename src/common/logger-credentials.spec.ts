import { type MockInstance, vi } from 'vitest'
import { stripVTControlCharacters } from 'node:util'
import { ChatInputCommandInteraction, Client, GatewayIntentBits } from 'discord.js'
import { Container } from 'inversify'

const { mockLoadConfig } = vi.hoisted(() => ({ mockLoadConfig: vi.fn() }))
vi.mock('@src/util/meocord-config-loader.util.js', () => ({ loadMeoCordConfig: mockLoadConfig }))

import { Logger } from '@src/common/logger.js'
import { MeoCordApp } from '@src/core/meocord.app.js'
import { createMockInteraction, createMockMessage } from '@src/testing/mock-interaction.js'

// Each spec has a value of its own, as a value once registered stays hidden for the process
const HELD = 'MTA0.a-value-a-client-holds.only-for-this-spec'
const GIVEN_TO_APP = 'MTA1.a-value-given-to-the-app.only-for-this-spec'
const CONFIGURED = 'MTA2.a-value-the-config-sets.only-for-this-spec'

const spies: MockInstance[] = []
const printed = () =>
  spies
    .flatMap(spy => spy.mock.calls.flat())
    .map(part => stripVTControlCharacters(String(part)))
    .join('\n')

beforeEach(() => {
  mockLoadConfig.mockReturnValue(undefined)
  spies.length = 0
  for (const method of ['log', 'warn', 'error', 'debug'] as const)
    spies.push(vi.spyOn(console, method).mockImplementation(() => {}))
})

afterEach(() => {
  for (const spy of spies) spy.mockRestore()
})

describe("Logger and the bot's credentials", () => {
  it('never prints a value a client holds, logged at any level through what a handler holds', () => {
    const client = new Client<true>({ intents: [GatewayIntentBits.Guilds] })
    client.token = HELD
    const held = [
      client,
      { client },
      createMockInteraction(ChatInputCommandInteraction, { client }),
      Object.assign(createMockMessage(), { content: 'hi', client }),
    ]
    const logger = new Logger('Probe')
    for (const level of ['log', 'info', 'warn', 'error', 'debug', 'verbose'] as const)
      for (const value of held) logger[level]('Seen:', value)

    expect(spies.reduce((count, spy) => count + spy.mock.calls.length, 0)).toBe(24)
    expect(printed()).not.toContain(HELD)
  })

  it('redacts the value the app is given, from the moment it is constructed', () => {
    const signals = { SIGINT: process.listeners('SIGINT'), SIGTERM: process.listeners('SIGTERM') }
    const client = new Client({ intents: [GatewayIntentBits.Guilds] })
    try {
      new MeoCordApp([], new Container(), client, GIVEN_TO_APP)

      new Logger().error(`Login failed for ${GIVEN_TO_APP}`, new Error(`rejected ${GIVEN_TO_APP}`), { GIVEN_TO_APP })
    } finally {
      for (const signal of ['SIGINT', 'SIGTERM'] as const)
        for (const listener of process.listeners(signal))
          if (!signals[signal].includes(listener)) process.off(signal, listener)
    }

    expect(printed()).not.toContain(GIVEN_TO_APP)
    expect(printed().match(/\[redacted\]/g)?.length).toBeGreaterThanOrEqual(3)
  })

  it("redacts the config's value in a line logged before any app exists", () => {
    mockLoadConfig.mockReturnValue({ appName: 'TestApp', discordToken: CONFIGURED })

    new Logger().log(`Starting with ${CONFIGURED}`)

    expect(printed()).not.toContain(CONFIGURED)
    expect(printed()).toContain('Starting with [redacted]')
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
