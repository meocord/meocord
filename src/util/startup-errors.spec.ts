import 'reflect-metadata'
import { vi } from 'vitest'
import { type ButtonInteraction, type ChatInputCommandInteraction } from 'discord.js'
import { ExecutionContext } from '@src/common/execution-context.js'
import { Logger } from '@src/common/logger.js'
import { MeoCordFactory } from '@src/core/meocord-factory.js'
import { Command, Controller, Cooldown, Defer, MeoCord, MessageHandler, Service } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { MeoCordTestingModule, reportAllStartupErrors } from '@src/testing/index.js'
import { describeRefusal, forgetDeclaredErrors, sourceFileOf, startupErrorsOf } from '@src/util/refusal.util.js'

vi.mock('@src/util/meocord-config-loader.util.js', () => ({ loadMeoCordConfig: () => ({ discordToken: 'token' }) }))
vi.mock('@src/util/platform.util.js', () => ({ assertBuiltForThisPlatform: () => {} }))

/** What `run` throws, which fails the test when it throws nothing. */
function thrownBy(run: () => unknown): Error {
  try {
    run()
  } catch (error) {
    return error as Error
  }
  throw new Error('nothing was thrown')
}

let logged: string[]
beforeEach(() => {
  logged = []
  vi.spyOn(Logger.prototype, 'error').mockImplementation((text: unknown) => void logged.push(String(text)))
})
afterEach(() => {
  vi.restoreAllMocks()
  forgetDeclaredErrors()
})

// Two commands each with two handlers: two errors create() finds itself, which it threw one run at a time
const twoMistakes = () => {
  @Controller()
  class StatsController {
    @Command('stats', CommandType.SLASH)
    async stats(_interaction: ChatInputCommandInteraction) {}

    @Command('help', CommandType.SLASH)
    async help(_interaction: ChatInputCommandInteraction) {}
  }
  @Controller()
  class AdminController {
    @Command('stats', CommandType.SLASH)
    async adminStats(_interaction: ChatInputCommandInteraction) {}

    @Command('help', CommandType.SLASH)
    async adminHelp(_interaction: ChatInputCommandInteraction) {}
  }
  return [StatsController, AdminController] as const
}

describe("create()'s own startup checks", () => {
  it('report every error they find, and throw the first unchanged', () => {
    const controllers = twoMistakes()
    @MeoCord({ controllers: [...controllers], clientOptions: { intents: [] } })
    class App {}

    const error = thrownBy(() => MeoCordFactory.create(App))

    // The first is what create() threw before it reported the rest, word for word
    expect(error.message).toBe(
      'StatsController.stats: it and AdminController.adminStats both handle the slash command "stats", so only ' +
        'StatsController.stats would ever run. Keep one handler for it, or give the other a name or subcommand path of its own.',
    )
    expect(startupErrorsOf(error).map(each => each.message.split(':')[0])).toEqual(['StatsController.stats', 'StatsController.help'])
    expect(logged).toEqual([
      ...startupErrorsOf(error).map(each => describeRefusal(each, process.cwd())),
      'MeoCord found 2 startup errors; the bot did not start.',
    ])
  })

  it('throw a lone error as they did, logging nothing outside a built application', () => {
    @Controller()
    class StatsController {
      @Command('stats', CommandType.SLASH)
      async stats(_interaction: ChatInputCommandInteraction) {}
    }
    @Controller()
    class AdminController {
      @Command('stats', CommandType.SLASH)
      async adminStats(_interaction: ChatInputCommandInteraction) {}
    }
    @MeoCord({ controllers: [StatsController, AdminController], clientOptions: { intents: [] } })
    class App {}

    const error = thrownBy(() => MeoCordFactory.create(App))

    expect(startupErrorsOf(error)).toEqual([error])
    expect(logged).toEqual([])
  })

  it('stop where they always did when there is one error, logging nothing a later step would', () => {
    const warned: string[] = []
    vi.spyOn(Logger.prototype, 'warn').mockImplementation((text: unknown) => void warned.push(String(text)))
    @Service()
    class Ctx {
      constructor(readonly context: ExecutionContext) {}
    }
    @Controller()
    class Ping {
      constructor(readonly ctx: Ctx) {}

      @Command('ping', CommandType.SLASH)
      async ping(_interaction: ChatInputCommandInteraction) {}
    }
    // With help on and no prefix, the dispatcher create() goes on to build would warn that help never answers
    @MeoCord({ controllers: [Ping], messages: { help: true }, clientOptions: { intents: [] } })
    class App {}

    const error = thrownBy(() => MeoCordFactory.create(App))

    expect(error.message.startsWith('Ctx: resolved once and shared')).toBe(true)
    expect(startupErrorsOf(error)).toEqual([error])
    expect(warned.filter(text => text.includes('help'))).toEqual([])
  })

  // Two same-named classes with a cooldown, found as the handler stages are prepared, and a pattern that cannot be read
  const nameAndPattern = () => {
    const shop = (command: string) => {
      @Controller()
      class Shop {
        @Command(command, CommandType.SLASH)
        @Cooldown({ seconds: 5 })
        async buy(_interaction: ChatInputCommandInteraction) {}
      }
      return Shop
    }
    @Controller()
    class Chat {
      @MessageHandler('baka {rest...} {x}')
      async baka() {}
    }
    return [shop('buy'), shop('sell'), Chat] as const
  }

  it('report a later pass of checks with an earlier one, where no step between them has an effect', () => {
    const controllers = nameAndPattern()
    @MeoCord({ controllers: [...controllers], clientOptions: { intents: [] } })
    class App {}

    const fromCreate = thrownBy(() => MeoCordFactory.create(App))
    const fromCompile = thrownBy(() => MeoCordTestingModule.create({ controllers: [...controllers] }).compile())

    for (const error of [fromCreate, fromCompile]) {
      expect(error.message.startsWith('Shop: two classes have this name')).toBe(true)
      expect(startupErrorsOf(error).map(each => each.message.split(':')[0])).toEqual(['Shop', "Chat.baka"])
    }
  })

  it("report every error in a testing module's compile() too", () => {
    const controllers = twoMistakes()
    const error = thrownBy(() => MeoCordTestingModule.create({ controllers: [...controllers] }).compile())

    expect(startupErrorsOf(error)).toHaveLength(2)
    expect(logged.at(-1)).toBe('MeoCord found 2 startup errors; the testing module did not compile.')
  })
})

describe("a decorator's startup error", () => {
  const badPattern = () => {
    @Controller()
    class Tickets {
      @Command('ticket-{id}', CommandType.BUTTON)
      async close(_interaction: ButtonInteraction) {}
    }
    return Tickets
  }

  it('is thrown as its class is defined, its message unchanged, naming its handler and file', () => {
    const error = thrownBy(badPattern)

    expect(error.message.startsWith('Tickets.close: Invalid pattern "ticket-{id}"')).toBe(true)
    // The file is the one the report names: in an app, the first of its own source files the stack passes through
    const { declaration, file } = error as { declaration?: string; file?: string }
    expect(declaration).toBe('Tickets.close')
    expect(file).toBe(sourceFileOf(error, process.cwd()))
    expect(describeRefusal(error, process.cwd())).toBe(`${error.message}\n    in ${file}`)
    // The two are not the error's own enumerable properties, so a test comparing it as an Error sees what it saw
    expect(Object.keys(error)).toEqual([])
  })

  it("leads the report with the handler when the message doesn't name it", () => {
    const error = thrownBy(() => {
      class Shop {
        @Cooldown({ seconds: -1 })
        buy() {}
      }
      return Shop
    })

    expect(describeRefusal(error, process.cwd()).startsWith(error.message.startsWith('Shop.buy') ? error.message : `Shop.buy: ${error.message}`)).toBe(true)
  })
})

describe('an error compared as a test compared it before', () => {
  // What it now carries is readable, but not its own enumerable keys, which toEqual and toStrictEqual compare
  it("still equals an Error of its message, create()'s with the rest found and a decorator's with its declaration", () => {
    const controllers = twoMistakes()
    @MeoCord({ controllers: [...controllers], clientOptions: { intents: [] } })
    class App {}
    const fromCreate = thrownBy(() => MeoCordFactory.create(App))
    const fromDecorator = thrownBy(() => {
      class Shop {
        @Cooldown({ seconds: -1 })
        buy() {}
      }
      return Shop
    })

    expect(startupErrorsOf(fromCreate)).toHaveLength(2)
    expect((fromDecorator as { declaration?: string }).declaration).toBe('Shop.buy')
    for (const error of [fromCreate, fromDecorator]) {
      expect(error).toEqual(new Error(error.message))
      expect(error).toStrictEqual(new Error(error.message))
    }
  })
})

describe("reportAllStartupErrors(), as startupErrors: 'all' does for a built bot", () => {
  // Three mistakes in two controllers, defined once collecting is on, as a setup file has it before tests import them
  const threeMistakes = () => {
    @Controller()
    class Tickets {
      @Command('ticket-{id}', CommandType.BUTTON)
      async close(_interaction: ButtonInteraction) {}
    }
    @Controller()
    class Shop {
      @Command('buy', CommandType.SLASH)
      @Cooldown({ seconds: -1 })
      async buy(_interaction: ChatInputCommandInteraction) {}

      @Command('sell', CommandType.SLASH)
      async sell(_interaction: ChatInputCommandInteraction) {}
    }
    Defer()(Shop, undefined as never, undefined as never)
    return [Tickets, Shop] as const
  }

  it('keeps each where it is declared, and the testing module reports all three, throwing the first', () => {
    reportAllStartupErrors()
    const controllers = threeMistakes()

    const error = thrownBy(() => MeoCordTestingModule.create({ controllers: [...controllers] }).compile())

    const errors = startupErrorsOf(error)
    expect(errors.map(each => (each as { declaration?: string }).declaration)).toEqual(['Tickets.close', 'Shop.buy', 'Shop'])
    expect(error).toBe(errors[0])
    expect(logged).toEqual([
      ...errors.map(each => describeRefusal(each, process.cwd())),
      'MeoCord found 3 startup errors; the testing module did not compile.',
    ])
  })

  it('reports them at create(), with the errors its own checks find', () => {
    reportAllStartupErrors()
    const controllers = threeMistakes()
    @MeoCord({ controllers: [...controllers, ...twoMistakes()], clientOptions: { intents: [] } })
    class App {}

    const error = thrownBy(() => MeoCordFactory.create(App))

    expect(startupErrorsOf(error)).toHaveLength(5)
    expect(logged.at(-1)).toBe('MeoCord found 5 startup errors; the bot did not start.')
  })

  it('leaves the classes a testing module does not run out of its report', () => {
    reportAllStartupErrors()
    threeMistakes()
    @Controller()
    class Fine {
      @Command('fine', CommandType.SLASH)
      async fine(_interaction: ChatInputCommandInteraction) {}
    }

    expect(() => MeoCordTestingModule.create({ controllers: [Fine] }).compile()).not.toThrow()
  })
})
