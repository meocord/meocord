import { vi } from 'vitest'
import { Client } from 'discord.js'

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

import { MeoCord, Service } from '@src/decorator/index.js'
import { MeoCordFactory } from '@src/core/meocord-factory.js'
import { CooldownStore, MemoryCooldownStore } from '@src/common/cooldown-store.js'
import { createTranslator, Translator } from '@src/common/translator.js'
import { MeoCordTestingModule } from '@src/testing/index.js'
import { type Provider } from '@src/interface/index.js'

const translator = createTranslator({ default: 'en-US', locales: { 'en-US': {} } })
const provided: Provider = { provide: Translator, useValue: translator }

/** Each translator the classes below were made with. */
const received: { by: string; t: Translator }[] = []

@Service()
class Greeter {
  constructor(readonly t: Translator) {
    received.push({ by: 'Greeter', t })
  }
}

@Service()
class Store extends MemoryCooldownStore {
  constructor(readonly t: Translator) {
    super()
    received.push({ by: 'Store', t })
  }
}

/** A class a useClass provider makes, which injects the class that injects the translator. */
@Service()
class Host {
  constructor(readonly greeter: Greeter) {}
}

const byFactory: Provider = { provide: 'GREETER', useFactory: (greeter: Greeter) => greeter, inject: [Greeter] }
const byClass: Provider = { provide: 'GREETER', useClass: Host }

/** Starts a bot logged in without a network and runs its ready hooks. */
async function startBot(options: { providers: Provider[]; cooldownStore?: new (...args: any[]) => CooldownStore }) {
  const clients: Client[] = []
  vi.spyOn(Client.prototype, 'login').mockImplementation(function (this: Client) {
    clients.push(this)
    return Promise.resolve('token')
  })
  vi.spyOn(Client.prototype, 'destroy').mockResolvedValue(undefined)
  @MeoCord({ controllers: [], ...options, clientOptions: { intents: [] } })
  class App {}
  const app = MeoCordFactory.create(App)
  await app.start()
  for (const listener of clients[0].listeners('clientReady')) await (listener as (c: Client) => Promise<void>)(clients[0])
  await app.stop()
}

describe('a Translator given through @MeoCord({ providers }) without i18n', () => {
  beforeEach(() => void (received.length = 0))
  afterEach(() => {
    vi.restoreAllMocks()
    process.removeAllListeners('SIGINT')
    process.removeAllListeners('SIGTERM')
  })

  describe.each([
    ['a factory whose inject reaches', byFactory],
    ['a useClass provider whose class reaches', byClass],
  ] as const)('listed after %s a class that injects it', (_, first) => {
    it('reaches the class, in the bot', async () => {
      await startBot({ providers: [first, provided] })

      expect(received).toEqual([{ by: 'Greeter', t: translator }])
    })

    it('reaches the class, in the testing module', () => {
      MeoCordTestingModule.create({ providers: [first, provided] }).compile().get('GREETER')

      expect(received).toEqual([{ by: 'Greeter', t: translator }])
    })
  })

  it('reaches a cooldown store that injects it, in the bot', async () => {
    await startBot({ providers: [provided], cooldownStore: Store })

    expect(received).toEqual([{ by: 'Store', t: translator }])
  })

  it('reaches a cooldown store that injects it, in the testing module', () => {
    @MeoCord({ controllers: [], cooldownStore: Store, providers: [provided], clientOptions: { intents: [] } })
    class StoreApp {}

    MeoCordTestingModule.fromApp(StoreApp).compile().get(CooldownStore)

    expect(received).toEqual([{ by: 'Store', t: translator }])
  })
})

describe('a class that injects Translator, with neither i18n nor a provider for it', () => {
  const refusal = 'Greeter: it injects Translator, but @MeoCord has no i18n. Pass @MeoCord({ i18n: t }), where t comes from createTranslator.'

  it.each([
    ['a factory', byFactory],
    ['a useClass provider', byClass],
  ] as const)('is refused, reached through %s', (_, provider) => {
    @MeoCord({ controllers: [], providers: [provider], clientOptions: { intents: [] } })
    class App {}

    expect(() => MeoCordFactory.create(App)).toThrow(refusal)
    expect(() => MeoCordTestingModule.create({ providers: [provider] }).compile()).toThrow(refusal)
  })

  it('is refused as the cooldown store', () => {
    @MeoCord({ controllers: [], cooldownStore: Store, clientOptions: { intents: [] } })
    class StoreApp {}

    expect(() => MeoCordFactory.create(StoreApp)).toThrow(refusal.replace('Greeter', 'Store'))
    expect(() => MeoCordTestingModule.fromApp(StoreApp).compile()).toThrow(refusal.replace('Greeter', 'Store'))
  })
})
