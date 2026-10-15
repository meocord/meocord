import { vi } from 'vitest'
import { type GuildBan } from 'discord.js'
import type * as FactoryModule from '@src/core/meocord-factory.js'
import type * as DecoratorModule from '@src/decorator/index.js'
import { forgetProcessState } from '@src/core/process-state.js'

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

/** Fresh modules and a forgotten shutdown per test, as a new process has. */
async function load() {
  vi.resetModules()
  forgetProcessState()
  const discord = await import('discord.js')
  const factory: typeof FactoryModule = await import('@src/core/meocord-factory.js')
  const decorators: typeof DecoratorModule = await import('@src/decorator/index.js')
  return { discord, ...factory, ...decorators }
}

// A start that fails drops the singletons it made, so a retry makes new instances: their direct calls keep the guards
describe("a guarded override's direct call after a failed start", () => {
  const exitCode = process.exitCode
  afterEach(() => {
    process.exitCode = exitCode
    process.removeAllListeners('SIGINT')
    process.removeAllListeners('SIGTERM')
    vi.restoreAllMocks()
  })

  it('runs the base guard on the instance the retry made', async () => {
    const loaded = await load()
    vi.spyOn(loaded.discord.Client.prototype, 'login').mockResolvedValue('token')
    vi.spyOn(loaded.discord.Client.prototype, 'destroy').mockResolvedValue(undefined)
    const log: string[] = []

    @loaded.Guard()
    class Deny {
      canActivate() {
        log.push('deny')
        return false
      }
    }

    @loaded.Service()
    class Base {
      @loaded.On('guildBanAdd')
      @loaded.UseGuard(Deny)
      onBan(_ban: GuildBan) {
        log.push('base ran')
      }
    }

    @loaded.Service()
    class Audit extends Base {
      override onBan(_ban: GuildBan) {
        log.push('override ran')
      }
    }

    const instances: Audit[] = []
    let attempts = 0
    @loaded.MeoCord({
      controllers: [],
      services: [Audit],
      providers: [
        {
          provide: 'CACHE',
          inject: [Audit],
          useFactory: async (audit: Audit) => {
            instances.push(audit)
            if (++attempts === 1) throw new Error('cache unreachable')
            return {}
          },
        },
      ],
      clientOptions: { intents: [] },
    })
    class App {}
    const app = loaded.MeoCordFactory.create(App)

    await expect(app.start()).rejects.toThrow('cache unreachable')
    await app.start()
    const [first, retried] = instances
    await retried.onBan({} as GuildBan)

    expect(retried).not.toBe(first)
    expect(log).toEqual(['deny'])
    await app.stop()
  })
})

