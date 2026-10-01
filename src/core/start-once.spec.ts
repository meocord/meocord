import { vi } from 'vitest'
import { ChatInputCommandInteraction, Client } from 'discord.js'

const { logged } = vi.hoisted(() => ({ logged: { error: [] as unknown[][], warn: [] as unknown[][] } }))

vi.mock('@src/common/index.js', async importOriginal => ({
  ...(await importOriginal<object>()),
  Logger: class {
    log = vi.fn()
    debug = vi.fn()
    info = vi.fn()
    verbose = vi.fn()
    warn = (...args: unknown[]) => logged.warn.push(args)
    error = (...args: unknown[]) => logged.error.push(args)
  },
}))
vi.mock('@src/util/meocord-config-loader.util.js', () => ({ loadMeoCordConfig: () => ({ discordToken: 'token' }) }))
vi.mock('@src/util/platform.util.js', () => ({ assertBuiltForThisPlatform: () => {} }))

import { Command, Controller, MeoCord, Service } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { type Container } from 'inversify'
import { appPresenterOf } from '@src/core/handler-pipeline.js'
import { MeoCordFactory } from '@src/core/meocord-factory.js'
import { MeoCordApp } from '@src/core/meocord.app.js'
import { type MeoCordApplication } from '@src/interface/index.js'
import { createMockInteraction } from '@src/testing/index.js'

const realLogin = Client.prototype.login

const EVENTS = ['clientReady', 'interactionCreate', 'messageCreate', 'messageReactionAdd', 'messageReactionRemove'] as const

/** Logs in on the given attempts only, failing the others as an unreachable Discord does; returns the clients and the count. */
function loginSucceedsOn(...attempts: number[]) {
  const seen = { clients: [] as Client[], logins: 0 }
  vi.spyOn(Client.prototype, 'login').mockImplementation(function (this: Client) {
    seen.clients.push(this)
    seen.logins++
    return attempts.includes(seen.logins) ? Promise.resolve('token') : Promise.reject(new Error('getaddrinfo ENOTFOUND discord.com'))
  })
  vi.spyOn(Client.prototype, 'destroy').mockResolvedValue(undefined)
  return seen
}

const listenerCounts = (client: Client) => EVENTS.map(event => client.listenerCount(event))

async function interact(client: Client, commandName: string) {
  const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName })
  for (const listener of client.listeners('interactionCreate')) await (listener as (i: unknown) => Promise<void>)(interaction)
  return interaction
}

const ran: string[] = []

@Controller()
class Ping {
  @Command('ping', CommandType.SLASH)
  ping() {
    ran.push('ping')
  }

  @Command('fail', CommandType.SLASH)
  fail() {
    throw new Error('boom')
  }
}

@Service()
class Scheduler {
  onReady() {
    ran.push('onReady')
  }
}

class Presenter {
  loading() {
    return { content: 'loading' }
  }
  error() {
    return { content: 'presented error' }
  }
}

@MeoCord({ controllers: [Ping], services: [Scheduler], presenter: Presenter, clientOptions: { intents: [] } } as never)
class App {}

describe('start()', () => {
  const exitCode = process.exitCode
  let app: MeoCordApplication

  beforeEach(() => {
    ran.length = 0
    logged.error.length = 0
    logged.warn.length = 0
    // Logged once a process, so each case starts as a fresh process would
    ;(MeoCordApp as unknown as { warnedRetry: boolean }).warnedRetry = false
  })
  afterEach(() => {
    process.exitCode = exitCode
    vi.restoreAllMocks()
    process.removeAllListeners('SIGINT')
    process.removeAllListeners('SIGTERM')
  })

  it('attaches its listeners once when a retry logs in, so each call and onReady run once', async () => {
    const seen = loginSucceedsOn(2)
    app = MeoCordFactory.create(App)

    await app.start().catch(() => undefined)
    await app.start()
    const [client] = seen.clients

    expect(listenerCounts(client)).toEqual([1, 1, 1, 1, 1])
    await interact(client, 'ping')
    for (const listener of client.listeners('clientReady')) await (listener as (c: unknown) => Promise<void>)(client)
    expect(ran).toEqual(['ping', 'onReady'])
  })

  it("resolves the app's presenter once across a retry, as the built-in help reads it", async () => {
    loginSucceedsOn(2)
    app = MeoCordFactory.create(App)

    await app.start().catch(() => undefined)
    await app.start()

    expect(appPresenterOf((app as unknown as { container: Container }).container)).toBeInstanceOf(Presenter)
  })

  it('makes concurrent calls share one start: one login, one set of listeners, both settle', async () => {
    const seen = loginSucceedsOn(1)
    app = MeoCordFactory.create(App)

    const results = await Promise.allSettled([app.start(), app.start()])

    expect(results.map(result => result.status)).toEqual(['fulfilled', 'fulfilled'])
    expect(seen.logins).toBe(1)
    expect(listenerCounts(seen.clients[0])).toEqual([1, 1, 1, 1, 1])
  })

  it('does nothing when called again once the bot is online', async () => {
    const seen = loginSucceedsOn(1, 2)
    app = MeoCordFactory.create(App)

    await app.start()
    await app.start()

    expect(seen.logins).toBe(1)
    expect(listenerCounts(seen.clients[0])).toEqual([1, 1, 1, 1, 1])
  })

  it('clears the exit code a failed login set to 0 when a retry logs in, which every runtime keeps', async () => {
    loginSucceedsOn(2)
    process.exitCode = undefined
    app = MeoCordFactory.create(App)

    await app.start().catch(() => undefined)
    expect(process.exitCode).toBe(1)
    await app.start()

    expect(process.exitCode).toBe(0)
  })

  it('leaves a client discord.js destroyed on the failed login usable after the retry, and says the retry is deprecated, once', async () => {
    vi.spyOn(Client.prototype, 'destroy')
    const connect = vi.fn().mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND discord.com')).mockResolvedValue(undefined)
    const clients: Client[] = []
    vi.spyOn(Client.prototype, 'login').mockImplementation(function (this: Client, token?: string) {
      clients.push(this)
      vi.spyOn(this.ws as unknown as { connect: () => Promise<void> }, 'connect').mockImplementation(connect)
      return realLogin.call(this, token)
    })
    app = MeoCordFactory.create(App)

    await app.start().catch(() => undefined)
    await app.start()
    await app.start()

    const [client] = clients
    expect((client.ws as unknown as { destroyed: boolean }).destroyed).toBe(false)
    expect(connect).toHaveBeenCalledTimes(2)
    const deprecations = logged.warn.filter(args => String(args[0]).includes('Retrying start() after a failed login is deprecated'))
    expect(deprecations).toHaveLength(1)
  })

  it('says nothing about a retry when the first start logs in', async () => {
    loginSucceedsOn(1)
    app = MeoCordFactory.create(App)

    await app.start()

    expect(logged.warn.flat().map(String).join('\n')).not.toMatch(/deprecated/)
  })
})
