import { type Message, type MessageReaction } from 'discord.js'
import { vi } from 'vitest'
import { ExecutionContext } from '@src/common/index.js'
import { Logger } from '@src/common/logger.js'
import { MeoCordFactory } from '@src/core/meocord-factory.js'
import { Autocomplete, Command, Controller, Guard, MeoCord, MessageHandler, On, ReactionHandler, Service, UseGuard } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { type MeoCordConfig } from '@src/interface/index.js'
import { MeoCordTestingModule } from '@src/testing/index.js'

const { config } = vi.hoisted(() => ({ config: { current: { discordToken: 'token' } as MeoCordConfig } }))
vi.mock('@src/util/meocord-config-loader.util.js', () => ({ loadMeoCordConfig: () => config.current }))
vi.mock('@src/util/platform.util.js', () => ({ assertBuiltForThisPlatform: () => {} }))

let warned: string[]
beforeEach(() => {
  warned = []
  vi.spyOn(Logger.prototype, 'warn').mockImplementation((...args: unknown[]) => void warned.push(args.map(String).join(' ')))
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  config.current = { discordToken: 'token' }
})

/** The warning about handlers off the controllers, or `undefined` when there was none. */
const offControllers = () => warned.find(line => /never runs?: MeoCord dispatches only to/.test(line))

/** A service with one handler of each kind dispatch reaches only on a controller, and an event handler, which runs. */
const statsService = () => {
  @Service()
  class Stats {
    @MessageHandler('stats')
    stats(_message: Message) {}
    @ReactionHandler('👍')
    like(_reaction: MessageReaction) {}
    @Command('stats/refresh', CommandType.BUTTON)
    refresh() {}
    @Autocomplete('stats', 'period')
    period() {}
    @On('guildMemberAdd')
    greet() {}
  }
  return Stats
}

const STATS_WARNING = [
  '4 handlers in classes that are not controllers never run: MeoCord dispatches only to @MeoCord({ controllers }).',
  "  Stats.stats: @MessageHandler('stats')",
  "  Stats.like: @ReactionHandler('👍')",
  "  Stats.refresh: @Command('stats/refresh')",
  "  Stats.period: @Autocomplete('stats', 'period')",
  'Move them to a controller. The next major version (5.0) refuses to start with these.',
].join('\n')

const create = (options: { controllers?: (new (...args: any[]) => unknown)[]; services?: (new (...args: any[]) => unknown)[] }) => {
  @MeoCord({ controllers: options.controllers ?? [], services: options.services, clientOptions: { intents: [] } })
  class App {}
  MeoCordFactory.create(App)
}

describe('handlers on a class that is not a controller', () => {
  it('are named in one warning at create(), each with its decorator', () => {
    create({ services: [statsService()] })

    expect(offControllers()).toBe(STATS_WARNING)
  })

  it('are named on a class no option lists, which a controller injects', () => {
    @Service()
    class Tally {
      @MessageHandler('tally')
      tally(_message: Message) {}
    }
    @Controller()
    class Scores {
      constructor(readonly tally: Tally) {}
    }

    create({ controllers: [Scores] })

    expect(offControllers()).toBe(
      '1 handler in a class that is not a controller never runs: MeoCord dispatches only to @MeoCord({ controllers }).\n' +
        "  Tally.tally: @MessageHandler('tally')\n" +
        'Move them to a controller. The next major version (5.0) refuses to start with these.',
    )
  })

  it("leave a controller's handlers and a service's event handlers alone", () => {
    @Service()
    class Welcome {
      @On('guildMemberAdd')
      greet() {}
    }
    @Controller()
    class Chat {
      @MessageHandler('ping')
      ping(_message: Message) {}
    }

    create({ controllers: [Chat], services: [Welcome] })

    expect(offControllers()).toBeUndefined()
  })

  it.each([
    ['as a bot', () => {}, { discordToken: 'token' }, true],
    ['under meocord register', () => vi.stubEnv('MEOCORD_REGISTER_ONLY', '1'), { discordToken: 'token' }, true],
    ['as the shard manager', () => {}, { discordToken: 'token', sharding: { mode: 'process' } }, true],
    // Its manager has given the warning
    ['as a spawned shard', () => vi.stubEnv('SHARDING_MANAGER', 'true'), { discordToken: 'token', sharding: { mode: 'process' } }, false],
  ] as const)('are named once for the whole bot when it runs %s', (_how, setUp, current, warns) => {
    setUp()
    config.current = current as MeoCordConfig

    create({ services: [statsService()] })

    expect(offControllers() !== undefined).toBe(warns)
  })

  /** An app with a `@MessageHandler` on a class only a guard injects, made once or for each call, or on a `useClass`. */
  const appWith = (kind: 'stage-only' | 'per-call' | 'useClass') => {
    @Service()
    class Ledger {
      @MessageHandler('ledger')
      ledger(_message: Message) {}
    }
    @Service()
    class Audit {
      constructor(readonly context: ExecutionContext) {}
      @MessageHandler('audit')
      audit(_message: Message) {}
    }
    class Store {}
    @Guard()
    class Gate {
      constructor(readonly by: Ledger) {}
      canActivate() {
        return true
      }
    }
    @Guard()
    class PerCallGate {
      constructor(readonly by: Audit) {}
      canActivate() {
        return true
      }
    }
    @Controller()
    class Guarded {
      @Command('ping', CommandType.SLASH)
      @UseGuard(Gate)
      ping() {}
    }
    @Controller()
    class GuardedPerCall {
      @Command('ping', CommandType.SLASH)
      @UseGuard(PerCallGate)
      ping() {}
    }
    @Controller()
    class Plain {
      @Command('ping', CommandType.SLASH)
      ping() {}
    }
    const controllers = { 'stage-only': Guarded, 'per-call': GuardedPerCall, useClass: Plain }
    @MeoCord({
      controllers: [controllers[kind]],
      providers: kind === 'useClass' ? [{ provide: Store, useClass: Ledger }] : [],
      clientOptions: { intents: [] },
    })
    class App {}
    return { App, named: kind === 'per-call' ? "  Audit.audit: @MessageHandler('audit')" : "  Ledger.ledger: @MessageHandler('ledger')" }
  }

  it.each([
    ['a service only a guard injects', 'stage-only'],
    ['a class made for each call, as it injects ExecutionContext', 'per-call'],
    ["a provider's useClass under another token", 'useClass'],
  ] as const)('are named on %s, by the bot and the testing module alike', (_on, kind) => {
    const { App, named } = appWith(kind)

    MeoCordFactory.create(App)
    const bot = offControllers()
    warned = []
    MeoCordTestingModule.fromApp(App).compile()

    expect(bot).toContain(named)
    expect(offControllers()).toBe(bot)
  })

  it('are named in the testing module too', () => {
    @MeoCord({ controllers: [], services: [statsService()], clientOptions: { intents: [] } })
    class App {}

    MeoCordTestingModule.fromApp(App).compile()

    expect(offControllers()).toBe(STATS_WARNING)
  })
})
