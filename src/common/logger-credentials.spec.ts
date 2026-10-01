import { type MockInstance, vi } from 'vitest'

vi.mock('@src/util/meocord-config-loader.util.js', () => ({ loadMeoCordConfig: vi.fn() }))

import { stripVTControlCharacters } from 'node:util'
import { WebSocketManager } from '@discordjs/ws'
import { Client, GatewayIntentBits } from 'discord.js'
import { Container } from 'inversify'
import { Logger } from '@src/common/logger.js'
import { resetLogLevel } from '@src/common/log-level.js'
import { MeoCordApp } from '@src/core/meocord.app.js'
import { ShardManager } from '@src/core/shard-manager.js'
import { BUNDLE_ENTRY_KEY } from '@src/util/bundle-entry.util.js'
import { loadMeoCordConfig } from '@src/util/meocord-config-loader.util.js'

// Values the size of a bot's credential, one per way MeoCord comes to hold it, since what is registered stays for the run
const FROM_CONFIG = 'MTAx.from-the-built-bots-config.only-for-this-spec'
const FROM_APP = 'MTAy.given-to-the-app-it-runs.only-for-this-spec'
const FROM_MANAGER = 'MTAz.held-by-the-shard-manager.only-for-this-spec'

const LEVELS = ['log', 'info', 'warn', 'error', 'debug', 'verbose'] as const

let spies: MockInstance[]
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
  spies = (['log', 'warn', 'error', 'debug'] as const).map(method => vi.spyOn(console, method).mockImplementation(() => {}))
  vi.stubEnv('MEOCORD_LOG_LEVEL', 'debug')
  resetLogLevel()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  Reflect.deleteProperty(globalThis, BUNDLE_ENTRY_KEY)
  resetLogLevel()
})

describe("Logger and the bot's credential", () => {
  it("never prints the built bot's configured value, at any level, whatever carries it", () => {
    Reflect.set(globalThis, BUNDLE_ENTRY_KEY, '/app/dist/main.js')
    vi.mocked(loadMeoCordConfig).mockReturnValue({ discordToken: FROM_CONFIG })

    logEverything(FROM_CONFIG)

    expect(spies.reduce((count, spy) => count + spy.mock.calls.length, 0)).toBe(LEVELS.length * 5)
    expect(printed()).not.toContain(FROM_CONFIG)
    expect(printed()).toContain('[redacted]')
  })

  it('never prints the value the app is given, from the moment the app exists', () => {
    new MeoCordApp([], new Container(), new Client({ intents: [] }), FROM_APP)

    logEverything(FROM_APP)

    expect(printed()).not.toContain(FROM_APP)
  })

  it('never prints the value the shard manager holds for its shards', () => {
    new ShardManager({ controllerClasses: [], token: FROM_MANAGER, config: { discordToken: FROM_MANAGER } })

    logEverything(FROM_MANAGER)

    expect(printed()).not.toContain(FROM_MANAGER)
  })
})
