import { vi } from 'vitest'
import { ChatInputCommandInteraction, Client } from 'discord.js'

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
vi.mock('@src/util/meocord-config-loader.util.js', () => ({ loadMeoCordConfig: () => ({ discordToken: 'token' }) }))
vi.mock('@src/util/platform.util.js', () => ({ assertBuiltForThisPlatform: () => {} }))

import { Command, Controller, Guard, MeoCord, Service, UseGuard } from '@src/decorator/index.js'
import { MeoCordFactory } from '@src/core/meocord-factory.js'
import { createToken } from '@src/common/token.js'
import { CommandType } from '@src/enum/index.js'
import { createChatInputOptions, createMockInteraction, MeoCordTestingModule } from '@src/testing/index.js'

const order: string[] = []

/** A service only a guard injects, which no root of the app lists. */
@Service()
class GuardDep {
  constructor() {
    order.push('GuardDep constructed')
  }
  onReady() {
    order.push('GuardDep.onReady')
  }
  onShutdown() {
    order.push('GuardDep.onShutdown')
  }
}

@Guard()
class NeedsDep {
  constructor(readonly dep: GuardDep) {}
  canActivate() {
    order.push('guard ran')
    return true
  }
}

@Controller()
class Guarded {
  @Command('x', CommandType.SLASH)
  @UseGuard(NeedsDep)
  async x() {}
}

@Service()
class Shared {
  onReady() {
    order.push('Shared.onReady')
  }
  onShutdown() {
    order.push('Shared.onShutdown')
  }
}

const ALIAS = createToken<Shared>('ALIAS')
const VALUE_A = createToken<object>('VALUE_A')
const VALUE_B = createToken<object>('VALUE_B')
const value = {
  onReady: () => void order.push('value.onReady'),
  onShutdown: () => void order.push('value.onShutdown'),
}
const aliases = [
  { provide: ALIAS, useFactory: (shared: Shared) => shared, inject: [Shared] },
  { provide: VALUE_A, useValue: value },
  { provide: VALUE_B, useValue: value },
]

/** Starts a bot logged in without a network, runs its ready hooks, and returns it with its client. */
async function startBot(options: { controllers: any[]; services?: any[]; providers?: any[] }) {
  const clients: Client[] = []
  vi.spyOn(Client.prototype, 'login').mockImplementation(function (this: Client) {
    clients.push(this)
    return Promise.resolve('token')
  })
  vi.spyOn(Client.prototype, 'destroy').mockResolvedValue(undefined)
  @MeoCord({ ...options, clientOptions: { intents: [] } })
  class App {}
  const app = MeoCordFactory.create(App)
  await app.start()
  const client = clients[0]
  for (const listener of client.listeners('clientReady')) await (listener as (c: Client) => Promise<void>)(client)
  return { app, client }
}

const slash = () => createMockInteraction(ChatInputCommandInteraction, { commandName: 'x', options: createChatInputOptions({}) })

describe('lifecycle hooks of every service the app makes', () => {
  beforeEach(() => void (order.length = 0))
  afterEach(() => {
    vi.restoreAllMocks()
    process.removeAllListeners('SIGINT')
    process.removeAllListeners('SIGTERM')
  })

  it('runs them for a service only a guard injects, in the bot', async () => {
    const { app, client } = await startBot({ controllers: [Guarded] })
    const [dispatch] = client.listeners('interactionCreate') as ((interaction: unknown) => Promise<void>)[]
    await dispatch(slash())
    await app.stop()

    expect(order).toEqual(['GuardDep constructed', 'GuardDep.onReady', 'guard ran', 'GuardDep.onShutdown'])
  })

  it('runs them for a service only a guard injects, in the testing module', async () => {
    const module = await MeoCordTestingModule.create({ controllers: [Guarded] }).compile().init({ ready: true })
    await module.invoke(Guarded, 'x', slash())
    await module.close()

    expect(order).toEqual(['GuardDep constructed', 'GuardDep.onReady', 'guard ran', 'GuardDep.onShutdown'])
  })

  it("doesn't make what a replaced guard would inject, in the testing module", async () => {
    const module = await MeoCordTestingModule.create({ controllers: [Guarded] })
      .overrideGuard(NeedsDep)
      .useValue({ canActivate: () => true })
      .compile()
      .init({ ready: true })
    await module.close()

    expect(order).toEqual([])
  })

  it('runs them once for an instance two tokens reach, in the bot', async () => {
    const { app } = await startBot({ controllers: [], services: [Shared], providers: aliases })
    await app.stop()

    expect(order).toEqual(['Shared.onReady', 'value.onReady', 'value.onShutdown', 'Shared.onShutdown'])
  })

  it('runs them once for an instance two tokens reach, in the testing module', async () => {
    const module = await MeoCordTestingModule.create({ providers: aliases }).compile().init({ ready: true })
    await module.close()

    expect(order).toEqual(['Shared.onReady', 'value.onReady', 'value.onShutdown', 'Shared.onShutdown'])
  })
})
