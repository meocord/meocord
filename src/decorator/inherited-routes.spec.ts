import { vi } from 'vitest'
import { Logger } from '@src/common/logger.js'
import { SlashCommandBuilder } from 'discord.js'
import { Autocomplete, Command, CommandBuilder, Controller, MessageHandler, ReactionHandler } from '@src/decorator/index.js'
import { getAutocompleteHandlers, getCommandMap, getMessageHandlers, getReactionHandlers } from '@src/decorator/controller.decorator.js'
import { CommandType } from '@src/enum/index.js'
import { inspectHandler, MeoCordTestingModule } from '@src/testing/index.js'

const warnings = () =>
  vi
    .mocked(Logger.prototype.warn)
    .mock.calls.map(([line]) => String(line))
    .filter(line => line.includes('re-declared') || / never runs?:/.test(line))

/** Starts a testing module with the controllers, as the bot starts, which runs the startup checks. */
const start = (...controllers: (new (...args: any[]) => unknown)[]) => MeoCordTestingModule.create({ controllers }).compile()

beforeEach(() => {
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

@CommandBuilder(CommandType.SLASH)
class PingBuilder {
  build(name: string) {
    return new SlashCommandBuilder().setName(name).setDescription('Ping')
  }
}

@CommandBuilder(CommandType.SLASH)
class LoudPingBuilder {
  build(name: string) {
    return new SlashCommandBuilder().setName(name).setDescription('PING')
  }
}

@Controller()
class Base {
  @Command('page/{n:int}', CommandType.BUTTON)
  page() {}

  @Command('ping', PingBuilder)
  ping() {}

  @MessageHandler('roll', { description: 'Rolls a die' })
  roll() {}

  @ReactionHandler('👍')
  vote() {}

  @Autocomplete('stats', 'user')
  complete() {}
}

describe('a handler a subclass re-declares on the route it inherits', () => {
  // Routing keeps the first entry for a route, so an inherited one left in place would keep the base's options
  it("takes the subclass's options, in the inherited route's place, and leaves the base's own", () => {
    @Controller()
    class Leaf extends Base {
      @Command('ping', LoudPingBuilder)
      ping() {}

      @MessageHandler('roll', { description: 'Rolls two dice' })
      roll() {}

      @ReactionHandler('👍', { bots: true })
      vote() {}

      @Autocomplete('stats', 'user')
      complete() {}
    }

    expect(getCommandMap(Leaf.prototype).ping.map(meta => meta.builderClass)).toEqual([LoudPingBuilder])
    expect(getMessageHandlers(Leaf.prototype).map(handler => [handler.pattern, handler.options.description])).toEqual([['roll', 'Rolls two dice']])
    expect(getReactionHandlers(Leaf.prototype).map(handler => [handler.emoji, handler.settings.bots])).toEqual([['👍', true]])
    expect(getAutocompleteHandlers(Leaf.prototype)).toHaveLength(1)
    expect(getMessageHandlers(Base.prototype).map(handler => handler.options.description)).toEqual(['Rolls a die'])
    // Each route is declared once, so nothing is a duplicate and nothing is kept from the base
    start(Leaf)
    expect(warnings()).toEqual([])
  })
})

describe('a handler a subclass re-declares on another route', () => {
  it('keeps answering the inherited route, and is named as the bot starts, for every kind of handler', () => {
    @Controller()
    class ShopLeaf extends Base {
      @Command('shop/page/{n:int}', CommandType.BUTTON)
      @Command('store/page/{n:int}', CommandType.BUTTON)
      page() {}

      @MessageHandler('dice')
      roll() {}

      @ReactionHandler('⭐')
      vote() {}

      @Autocomplete('stats', 'member')
      complete() {}
    }

    expect(Object.keys(getCommandMap(ShopLeaf.prototype))).toEqual(['page/{n:int}', 'ping', 'store/page/{n:int}', 'shop/page/{n:int}'])
    expect(getMessageHandlers(ShopLeaf.prototype).map(handler => handler.pattern)).toEqual(['roll', 'dice'])
    expect(warnings()).toEqual([])

    start(ShopLeaf)

    expect(warnings()).toEqual([
      '4 re-declared handlers still answer routes they inherit:\n' +
        '  ShopLeaf.page answers button "page/{n:int}", which it inherits, as well as its own button "store/page/{n:int}" and button "shop/page/{n:int}".\n' +
        '  ShopLeaf.roll answers message "roll", which it inherits, as well as its own message "dice".\n' +
        '  ShopLeaf.vote answers reaction "👍", which it inherits, as well as its own reaction "⭐".\n' +
        '  ShopLeaf.complete answers autocomplete of "user" in "stats", which it inherits, as well as its own autocomplete of "member" in "stats".\n' +
        "In the next major version (5.0), a handler's own routes replace the ones it inherits. To keep an inherited route, declare it on the subclass's method as well; to drop it now, give the subclass @Controller({ inheritedRoutes: 'replace' }).",
    ])
  })

  // The routes come down through every class between, so a class with no decorators of its own changes nothing
  it('is named through a class between that declares nothing, and the subclass still takes its own options', () => {
    class Mid extends Base {
      roll() {}
    }
    @Controller()
    class Leaf extends Mid {
      @Command('shop/page/{n:int}', CommandType.BUTTON)
      page() {}

      @MessageHandler('roll', { description: 'Rolls two dice' })
      roll() {}
    }

    start(Leaf)

    expect(getMessageHandlers(Leaf.prototype).map(handler => handler.options.description)).toEqual(['Rolls two dice'])
    expect(warnings()).toEqual([
      '1 re-declared handler still answers routes it inherits:\n' +
        '  Leaf.page answers button "page/{n:int}", which it inherits, as well as its own button "shop/page/{n:int}".\n' +
        "In the next major version (5.0), a handler's own routes replace the ones it inherits. To keep an inherited route, declare it on the subclass's method as well; to drop it now, give the subclass @Controller({ inheritedRoutes: 'replace' }).",
    ])
  })

  it('says nothing when the subclass declares every route itself, or none', () => {
    @Controller()
    class Both extends Base {
      @Command('page/{n:int}', CommandType.BUTTON)
      @Command('shop/page/{n:int}', CommandType.BUTTON)
      page() {}
    }
    @Controller()
    class Untouched extends Base {}

    // Apart, since each answers the base's routes
    start(Both)
    start(Untouched)

    expect(warnings()).toEqual([])
  })

  // The same words under another kind is another route, which the subclass still answers as it inherits it
  it('tells a route of another kind from one with the same name', () => {
    @Controller()
    class Sub extends Base {
      @MessageHandler('ping')
      ping() {}
    }

    start(Sub)

    expect(warnings()).toEqual([
      '1 re-declared handler still answers routes it inherits:\n' +
        '  Sub.ping answers slash "ping", which it inherits, as well as its own message "ping".\n' +
        "In the next major version (5.0), a handler's own routes replace the ones it inherits. To keep an inherited route, declare it on the subclass's method as well; to drop it now, give the subclass @Controller({ inheritedRoutes: 'replace' }).",
    ])
  })
})

describe("@Controller({ inheritedRoutes: 'replace' })", () => {
  it('answers only the routes a re-decorated handler declares, for every kind of handler, with nothing to warn of', () => {
    @Controller({ inheritedRoutes: 'replace' })
    class ShopLeaf extends Base {
      @Command('shop/page/{n:int}', CommandType.BUTTON)
      page() {}

      @MessageHandler('dice')
      roll() {}

      @ReactionHandler('⭐')
      vote() {}

      @Autocomplete('stats', 'member')
      complete() {}
    }

    start(ShopLeaf)

    expect(Object.keys(getCommandMap(ShopLeaf.prototype))).toEqual(['ping', 'shop/page/{n:int}'])
    expect(getMessageHandlers(ShopLeaf.prototype).map(handler => handler.pattern)).toEqual(['dice'])
    expect(getReactionHandlers(ShopLeaf.prototype).map(handler => handler.emoji)).toEqual(['⭐'])
    expect(getAutocompleteHandlers(ShopLeaf.prototype).map(handler => handler.optionName)).toEqual(['member'])
    expect(warnings()).toEqual([])
    // The base keeps every route it declares
    expect(Object.keys(getCommandMap(Base.prototype))).toEqual(['page/{n:int}', 'ping'])
  })

  it('drops an inherited route of another kind too, and keeps one the subclass re-declares with its own options', () => {
    @Controller({ inheritedRoutes: 'replace' })
    class Sub extends Base {
      @MessageHandler('ping')
      ping() {}

      @Command('page/{n:int}', CommandType.BUTTON)
      @Command('shop/page/{n:int}', CommandType.BUTTON)
      page() {}
    }

    expect(Object.keys(getCommandMap(Sub.prototype))).toEqual(['page/{n:int}', 'shop/page/{n:int}'])
    expect(getMessageHandlers(Sub.prototype).map(handler => handler.pattern)).toEqual(['roll', 'ping'])
  })

  // Only routes the listed controller still answers are named: a class between that keeps its base's is not
  it('names no route a class between keeps, once the listed subclass replaces it', () => {
    @Controller()
    class Top {
      @Command('a', PingBuilder)
      m() {}
    }
    @Controller()
    class Mid extends Top {
      @Command('b', PingBuilder)
      override m() {}
    }
    @Controller({ inheritedRoutes: 'replace' })
    class Leaf extends Mid {
      @Command('c', PingBuilder)
      override m() {}
    }

    start(Leaf)
    expect(Object.keys(getCommandMap(Leaf.prototype))).toEqual(['c'])
    expect(warnings()).toEqual([])

    start(Mid)
    expect(warnings()).toEqual([
      '1 re-declared handler still answers routes it inherits:\n' +
        '  Mid.m answers slash "a", which it inherits, as well as its own slash "b".\n' +
        "In the next major version (5.0), a handler's own routes replace the ones it inherits. To keep an inherited route, declare it on the subclass's method as well; to drop it now, give the subclass @Controller({ inheritedRoutes: 'replace' }).",
    ])
  })

  it('keeps every route of a method it overrides without decorating, and the nearest class that declares one decides', () => {
    @Controller({ inheritedRoutes: 'replace' })
    class Mid extends Base {
      @Command('shop/page/{n:int}', CommandType.BUTTON)
      page() {}

      override roll() {}
    }
    @Controller()
    class Leaf extends Mid {
      override page() {}
    }

    expect(getMessageHandlers(Mid.prototype).map(handler => handler.pattern)).toEqual(['roll'])
    expect(Object.keys(getCommandMap(Leaf.prototype))).toEqual(['ping', 'shop/page/{n:int}'])
  })
})

describe('inspectHandler', () => {
  it('names the routes a handler answers by inheritance', () => {
    @Controller()
    class Sub extends Base {
      @Command('shop/page/{n:int}', CommandType.BUTTON)
      page() {}
    }

    expect(inspectHandler(Sub, 'page').inheritedRoutes).toEqual(['button "page/{n:int}"'])
    expect(inspectHandler(Sub, 'ping').inheritedRoutes).toEqual(['slash "ping"'])
    expect(inspectHandler(Base, 'ping').inheritedRoutes).toEqual([])
  })
})
