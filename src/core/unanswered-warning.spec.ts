import { vi } from 'vitest'
import { type Client } from 'discord.js'
import type * as FactoryModule from '@src/core/meocord-factory.js'
import type * as DecoratorModule from '@src/decorator/index.js'
import type * as CommonModule from '@src/common/index.js'
import type * as TestingModule from '@src/testing/index.js'
import type * as EnumModule from '@src/enum/index.js'

const { warned } = vi.hoisted(() => ({ warned: [] as string[] }))

// Logger is constructed with `new`, so the implementation has to be a class.
vi.mock('@src/common/logger.js', async importOriginal => ({
  ...(await importOriginal<object>()),
  Logger: class {
    log = vi.fn()
    debug = vi.fn()
    info = vi.fn()
    verbose = vi.fn()
    error = vi.fn()
    warn = (message: string) => warned.push(message)
  },
}))
vi.mock('@src/util/meocord-config-loader.util.js', () => ({ loadMeoCordConfig: () => ({ discordToken: 'test-token' }) }))
vi.mock('@src/util/platform.util.js', () => ({ assertBuiltForThisPlatform: () => {} }))

/** Fresh modules per test, as a new process would have. */
async function load() {
  vi.resetModules()
  const discord = await import('discord.js')
  const factory: typeof FactoryModule = await import('@src/core/meocord-factory.js')
  const decorators: typeof DecoratorModule = await import('@src/decorator/index.js')
  const common: typeof CommonModule = await import('@src/common/index.js')
  const testing: typeof TestingModule = await import('@src/testing/index.js')
  const enums: typeof EnumModule = await import('@src/enum/index.js')
  return { discord, ...factory, ...decorators, ...common, ...testing, ...enums }
}
type Loaded = Awaited<ReturnType<typeof load>>

/** A bot with handlers that answer, forget to, defer without following up, are denied, or fail. */
async function startApp(loaded: Loaded, warnUnanswered?: boolean) {
  const clients: Client[] = []
  vi.spyOn(loaded.discord.Client.prototype, 'login').mockImplementation(function (this: Client) {
    clients.push(this)
    return Promise.resolve('token')
  })
  vi.spyOn(loaded.discord.Client.prototype, 'destroy').mockResolvedValue(undefined)

  @loaded.Guard()
  class Deny {
    canActivate() {
      return false
    }
  }

  @loaded.Controller()
  class Shop {
    @loaded.Command('answers', loaded.CommandType.SLASH)
    async answers(interaction: any) {
      await loaded.respond(interaction).send('ok')
    }

    @loaded.Command('forgets', loaded.CommandType.SLASH)
    async forgets() {}

    @loaded.Command('defers', loaded.CommandType.SLASH)
    @loaded.Defer()
    async defers() {}

    @loaded.Command('denied', loaded.CommandType.SLASH)
    @loaded.UseGuard(Deny)
    async denied() {}

    @loaded.Command('fails', loaded.CommandType.SLASH)
    async fails() {
      throw new Error('boom')
    }
  }

  @loaded.MeoCord({ controllers: [Shop], clientOptions: { intents: [] }, ...(warnUnanswered === undefined ? {} : { warnUnanswered }) })
  class App {}

  const app = loaded.MeoCordFactory.create(App)
  await app.start()
  const [dispatch] = clients[0].listeners('interactionCreate') as ((interaction: unknown) => Promise<void>)[]
  return (commandName: string) =>
    dispatch(loaded.createMockInteraction(loaded.discord.ChatInputCommandInteraction, { commandName }))
}

const unanswered = () => warned.filter(message => message.includes('Shop.'))

describe('the warning for an interaction left unanswered', () => {
  const env = process.env.NODE_ENV
  beforeEach(() => {
    warned.length = 0
  })
  afterEach(() => {
    vi.restoreAllMocks()
    process.env.NODE_ENV = env
    process.exitCode = undefined
  })

  it('names, once, a handler that left its interaction unanswered or deferred, in development', async () => {
    process.env.NODE_ENV = 'development'
    const run = await startApp(await load())

    for (const command of ['forgets', 'forgets', 'defers', 'answers', 'denied', 'fails']) await run(command)

    expect(unanswered()).toEqual([
      expect.stringMatching(/^Shop\.forgets finished without answering its interaction/),
      expect.stringMatching(/^Shop\.defers deferred its interaction and never followed up/),
    ])
  })

  it('stays silent in production', async () => {
    process.env.NODE_ENV = 'production'
    const run = await startApp(await load())

    await run('forgets')
    await run('defers')

    expect(unanswered()).toEqual([])
  })

  it('follows @MeoCord({ warnUnanswered }) either way', async () => {
    process.env.NODE_ENV = 'development'
    const quiet = await startApp(await load(), false)
    await quiet('forgets')
    expect(unanswered()).toEqual([])

    vi.restoreAllMocks()
    process.env.NODE_ENV = 'production'
    const loud = await startApp(await load(), true)
    await loud('forgets')
    expect(unanswered()).toHaveLength(1)
  })

  it('refuses a warnUnanswered that is not true or false, where the app is declared', async () => {
    const loaded = await load()
    expect(() => {
      @loaded.MeoCord({ controllers: [], clientOptions: { intents: [] }, warnUnanswered: 'yes' as never })
      class App {}
      void App
    }).toThrow('App: @MeoCord({ warnUnanswered }) takes true or false.')
  })
})
