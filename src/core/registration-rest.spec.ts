import { createServer, type Server } from 'node:http'
import { type AddressInfo } from 'node:net'
import { vi } from 'vitest'
import type * as DiscordModule from 'discord.js'
import type * as AppModule from '@src/core/meocord.app.js'
import type * as FactoryModule from '@src/core/meocord-factory.js'
import type * as DecoratorModule from '@src/decorator/index.js'
import type * as ShardManagerModule from '@src/core/shard-manager.js'
import { type MeoCordConfig } from '@src/interface/index.js'
import { forgetProcessState } from '@src/core/process-state.js'
import { keepRestLocal } from '@src/spec-local-rest.js'
import { WARM_UP_TIMEOUT_MS } from '@src/spec-timeouts.js'

const { config } = vi.hoisted(() => ({ config: { current: {} as MeoCordConfig } }))

vi.mock('@src/common/index.js', async importOriginal => ({
  ...(await importOriginal<object>()),
  Logger: class {
    log = vi.fn()
    debug = vi.fn()
    info = vi.fn()
    verbose = vi.fn()
    warn = vi.fn()
    error = vi.fn()
  },
}))
vi.mock('@src/util/meocord-config-loader.util.js', () => ({ loadMeoCordConfig: () => config.current }))

const APP = '200000000000000001'

/** Fresh modules per test, as the factory and the shutdown state are process-wide. */
async function load() {
  vi.resetModules()
  forgetProcessState()
  const discord: typeof DiscordModule = await import('discord.js')
  const app: typeof AppModule = await import('@src/core/meocord.app.js')
  const factory: typeof FactoryModule = await import('@src/core/meocord-factory.js')
  const decorators: typeof DecoratorModule = await import('@src/decorator/index.js')
  const manager: typeof ShardManagerModule = await import('@src/core/shard-manager.js')
  return { discord, ...app, ...factory, ...decorators, ...manager }
}

beforeAll(async () => {
  await load()
}, WARM_UP_TIMEOUT_MS)

type Loaded = Awaited<ReturnType<typeof load>>

/** A Discord REST stand-in that answers the application and a bulk update, and records each request. */
async function startFakeRest() {
  const requests: string[] = []
  const server: Server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`)
    response.setHeader('content-type', 'application/json')
    response.end(request.method === 'GET' ? JSON.stringify({ id: APP }) : '[]')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    api: `http://127.0.0.1:${port}/api`,
    requests,
    close: () => new Promise(resolve => server.close(resolve)),
  }
}

function appClass(loaded: Loaded, rest?: { api: string }) {
  @loaded.MeoCord({ controllers: [], clientOptions: { intents: [], ...(rest && { rest }) } })
  class App {}
  return App
}

/** Runs `meocord register`'s process, resolving with its exit code. */
async function registerOnly(loaded: Loaded, rest?: { api: string }): Promise<number | undefined> {
  vi.stubEnv('MEOCORD_REGISTER_ONLY', '1')
  const exited = Promise.withResolvers<number | undefined>()
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => exited.resolve(code)) as never)
  config.current = { discordToken: 'token' } as MeoCordConfig
  void loaded.MeoCordFactory.create(appClass(loaded, rest)).start()
  return exited.promise
}

/** Registers as a process-sharding manager does, once for every shard. */
async function registerAsManager(loaded: Loaded, rest?: { api: string }): Promise<void> {
  config.current = { discordToken: 'token', sharding: { mode: 'process' } } as MeoCordConfig
  const manager = loaded.MeoCordFactory.create(appClass(loaded, rest))
  expect(manager).toBeInstanceOf(loaded.ShardManager)
  await (manager as InstanceType<Loaded['ShardManager']>).registerCommands()
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('registration with clientOptions.rest', () => {
  let fake: Awaited<ReturnType<typeof startFakeRest>>
  beforeEach(async () => {
    fake = await startFakeRest()
  })
  afterEach(() => fake.close())

  const sent = [`GET /api/v10/applications/@me`, `PUT /api/v10/applications/${APP}/commands`]

  it('sends `meocord register` where the client sends its own requests', async () => {
    const loaded = await load()
    keepRestLocal(loaded.discord.REST)

    await expect(registerOnly(loaded, { api: fake.api })).resolves.toBe(0)

    expect(fake.requests).toEqual(sent)
  })

  it("sends the shard manager's registration where the shards' clients send their requests", async () => {
    const loaded = await load()
    keepRestLocal(loaded.discord.REST)

    await registerAsManager(loaded, { api: fake.api })

    expect(fake.requests).toEqual(sent)
  })
})

describe('registration without clientOptions.rest', () => {
  /** Where each REST request would go, answered here so nothing reaches Discord. */
  const destinations = (loaded: Loaded) => {
    keepRestLocal(loaded.discord.REST)
    const seen: string[] = []
    const record = function (this: InstanceType<Loaded['discord']['REST']>, route: string) {
      seen.push(`${this.options.api}/v${this.options.version}${route}`)
      return Promise.resolve(route.endsWith('@me') ? { id: APP } : [])
    }
    vi.spyOn(loaded.discord.REST.prototype, 'get').mockImplementation(record as never)
    vi.spyOn(loaded.discord.REST.prototype, 'put').mockImplementation(record as never)
    return seen
  }
  const discord = [`https://discord.com/api/v10/applications/@me`, `https://discord.com/api/v10/applications/${APP}/commands`]

  it('sends `meocord register` to Discord', async () => {
    const loaded = await load()
    const seen = destinations(loaded)

    await expect(registerOnly(loaded)).resolves.toBe(0)

    expect(seen).toEqual(discord)
  })

  it("sends the shard manager's registration to Discord", async () => {
    const loaded = await load()
    const seen = destinations(loaded)

    await registerAsManager(loaded)

    expect(seen).toEqual(discord)
  })
  /**
   * Each request a REST client sends, as it would reach the network: URL, method, headers and body. Every request is
   * answered here, its client's makeRequest replaced before it is sent, so none leaves this process.
   */
  const captured = (loaded: Loaded) => {
    const requests: unknown[] = []
    const send = loaded.discord.REST.prototype.request
    vi.spyOn(loaded.discord.REST.prototype, 'request').mockImplementation(function (
      this: InstanceType<Loaded['discord']['REST']>,
      ...args: Parameters<InstanceType<Loaded['discord']['REST']>['request']>
    ) {
      this.options.makeRequest = async (url, init) => {
        requests.push({ url, method: init.method, headers: init.headers, body: init.body })
        return new Response(JSON.stringify(url.endsWith('@me') ? { id: APP } : []), { headers: { 'content-type': 'application/json' } }) as never
      }
      return send.apply(this, args)
    })
    return requests
  }
  /** What a REST client with no options of its own sends for a registration, the URL, headers and body included. */
  const asWithoutOptions = async (loaded: Loaded) => {
    const requests = captured(loaded)
    const rest = new loaded.discord.REST().setToken('token')
    await rest.get(loaded.discord.Routes.currentApplication())
    await rest.put(loaded.discord.Routes.applicationCommands(APP), { body: [] })
    vi.restoreAllMocks()
    return requests
  }

  it.each([
    ['`meocord register`', async (loaded: Loaded) => expect(await registerOnly(loaded)).toBe(0)],
    ["the shard manager's registration", registerAsManager],
  ])('sends %s as a REST client with no options does, headers included', async (_name, register) => {
    const expected = await asWithoutOptions(await load())
    const loaded = await load()
    const requests = captured(loaded)

    await register(loaded)

    expect(requests).toEqual(expected)
  })
})
