import 'reflect-metadata'
import { ChatInputCommandInteraction } from 'discord.js'
import { Command, Controller, Inject, MeoCord, Service } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { type PresentedError, type ResponseContext, type ResponsePresenter, type ResponseView } from '@src/interface/index.js'
import { appPresenterOf } from '@src/core/handler-pipeline.js'
import { createMockInteraction, getResponse, MeoCordTestingModule } from '@src/testing/index.js'

const log: string[] = []
beforeEach(() => void (log.length = 0))

const POOL = 'POOL'

@Service()
class Strings {
  onReady() {
    log.push('Strings ready')
  }
  onShutdown() {
    log.push('Strings closed')
  }
}

@Service()
class AppPresenter implements ResponsePresenter {
  constructor(readonly strings: Strings) {
    log.push('AppPresenter made')
  }
  loading(_: ResponseContext): ResponseView {
    return { text: 'Working' }
  }
  error(_: ResponseContext, { message }: PresentedError): ResponseView {
    return { text: `app: ${message}` }
  }
}

@Controller()
class Ping {
  @Command('ping', CommandType.SLASH)
  ping() {
    throw new Error('down')
  }
}

@MeoCord({ controllers: [Ping], presenter: AppPresenter, clientOptions: { intents: [] } })
class App {}

describe("a testing module's app presenter", () => {
  it('is made by init(), not compile(), as the bot makes it after the providers', async () => {
    const module = MeoCordTestingModule.create({ app: App, controllers: [Ping] }).compile()
    log.push('compiled')
    await module.init()

    expect(log).toEqual(['compiled', 'AppPresenter made'])
    await module.close()
  })

  it('is made on first read by module.get() before init(), and is the one init() answers with', async () => {
    const module = MeoCordTestingModule.create({ app: App, controllers: [Ping] }).compile()
    const read = module.get(AppPresenter)
    await module.init()

    expect(read).toBeInstanceOf(AppPresenter)
    expect(appPresenterOf(module['container'])).toBe(read)
    expect(log).toEqual(['AppPresenter made'])
    await module.close()
  })

  it("shuts down what it injects on close(), as everything the module made is", async () => {
    const module = await MeoCordTestingModule.create({ app: App, controllers: [Ping] }).compile().init({ ready: true })
    await module.close()

    expect(log).toEqual(['AppPresenter made', 'Strings ready', 'Strings closed'])
  })

  it("can inject a value a provider's async factory makes, and answers a dispatch", async () => {
    @Service()
    class PooledPresenter implements ResponsePresenter {
      constructor(@Inject(POOL) private readonly pool: { name: string }) {}
      loading(_: ResponseContext): ResponseView {
        return { text: 'Working' }
      }
      error(_: ResponseContext, { message }: PresentedError): ResponseView {
        return { text: `${this.pool.name}: ${message}` }
      }
    }
    @MeoCord({
      controllers: [Ping],
      presenter: PooledPresenter,
      providers: [{ provide: POOL, useFactory: async () => ({ name: 'pool' }) }],
      clientOptions: { intents: [] },
    })
    class PooledApp {}
    const module = await MeoCordTestingModule.fromApp(PooledApp).compile().init()
    const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName: 'ping' })

    await module.dispatch(interaction).catch(() => undefined)

    // The embed is a builder, so it is read as it is sent
    const sent = JSON.parse(JSON.stringify(getResponse(interaction).calls[0]?.payload)) as { embeds: { description: string }[] }
    expect(sent.embeds[0].description).toMatch(/^pool: /)
    await module.close()
  })
})
