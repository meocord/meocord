import 'reflect-metadata'
import { Command, Controller, Guard, MeoCord, MessageHandler, UseGuard } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { findRouteConflicts, resolveRoute } from '@src/testing/index.js'

@Controller()
class BroadController {
  @Command('gi-profile/{uuid}/{uid}', CommandType.BUTTON)
  async broad(_i: unknown, _params: Record<string, string>) {}
}

@Controller()
class SpecificController {
  @Command('gi-profile/summary/{ownerId}/{uid}', CommandType.BUTTON)
  async specific(_i: unknown, _params: Record<string, string>) {}

  @Command('gi-profile/summary/{ownerId}/{uid}', CommandType.SELECT_MENU)
  async specificMenu(_i: unknown, _params: Record<string, string>) {}

  @Command('ping', CommandType.SLASH)
  async ping(_i: unknown, _params: Record<string, string>) {}
}

// Registered broad first: the more specific pattern has to win across controllers anyway.
@MeoCord({ controllers: [BroadController, SpecificController], clientOptions: { intents: [] } })
class App {}

describe('resolveRoute', () => {
  it('resolves to the most specific pattern across every registered controller', () => {
    expect(resolveRoute(App, { type: CommandType.BUTTON, customId: 'gi-profile/summary/111/800000001' })).toEqual({
      controller: SpecificController,
      method: 'specific',
      handler: SpecificController.prototype.specific,
      params: { ownerId: '111', uid: '800000001' },
    })
  })

  it('falls back to a broader pattern for an id only it can take', () => {
    expect(resolveRoute(App, { type: CommandType.BUTTON, customId: 'gi-profile/abc-def/800000001' })).toEqual({
      controller: BroadController,
      method: 'broad',
      handler: BroadController.prototype.broad,
      params: { uuid: 'abc-def', uid: '800000001' },
    })
  })

  // A button and a select menu may share a pattern; the component type picks the handler.
  it('resolves by component type as well as by pattern', () => {
    const route = resolveRoute(App, { type: CommandType.SELECT_MENU, customId: 'gi-profile/summary/111/8' })

    expect(route?.method).toBe('specificMenu')
  })

  // @UseGuard replaces the method on the prototype; `handler` is that same function.
  it('returns the handler as it sits on the prototype, guards included', () => {
    @Guard()
    class AllowGuard {
      canActivate() {
        return true
      }
    }

    @Controller()
    class GuardedController {
      @Command('guarded/{id}', CommandType.BUTTON)
      @UseGuard(AllowGuard)
      async guarded(_i: unknown, _params: Record<string, string>) {}
    }

    @MeoCord({ controllers: [GuardedController], clientOptions: { intents: [] } })
    class GuardedApp {}

    const route = resolveRoute(GuardedApp, { type: CommandType.BUTTON, customId: 'guarded/1' })

    expect(route?.handler).toBe(GuardedController.prototype.guarded)
  })

  it('returns undefined when no route handles the id', () => {
    expect(resolveRoute(App, { type: CommandType.BUTTON, customId: 'hsr-characters-element/111/8' })).toBeUndefined()
    expect(resolveRoute(App, { type: CommandType.MODAL_SUBMIT, customId: 'gi-profile/summary/111/8' })).toBeUndefined()
  })

  it('rejects command types routed by name', () => {
    expect(() => resolveRoute(App, { type: CommandType.SLASH as never, customId: 'ping' })).toThrow('routed by name')
  })

  it('rejects a class not decorated with @MeoCord', () => {
    expect(() => resolveRoute(BroadController, { type: CommandType.BUTTON, customId: 'x' })).toThrow('@MeoCord()')
  })
})

describe('findRouteConflicts', () => {
  it('returns nothing when every id reaches one pattern', () => {
    expect(findRouteConflicts(App)).toEqual([])
  })

  it('reports patterns of one component type that can match the same id', () => {
    @Controller()
    class Overlapping {
      @Command('a/{x}/c', CommandType.BUTTON)
      async left(_i: unknown, _params: Record<string, string>) {}

      @Command('a/b/{y}', CommandType.BUTTON)
      async right(_i: unknown, _params: Record<string, string>) {}

      // Same shape, another type: never in competition with the buttons.
      @Command('a/b/{z}', CommandType.MODAL_SUBMIT)
      async modal(_i: unknown, _params: Record<string, string>) {}
    }

    @MeoCord({ controllers: [Overlapping], clientOptions: { intents: [] } })
    class OverlappingApp {}

    expect(findRouteConflicts(OverlappingApp)).toEqual([{ type: CommandType.BUTTON, patterns: ['a/{x}/c', 'a/b/{y}'] }])
  })

  it('throws, as the bot does at startup, for two handlers with the same pattern', () => {
    @Controller()
    class Twice {
      @Command('ban/{id}', CommandType.BUTTON)
      async ban(_i: unknown, _params: Record<string, string>) {}

      @Command('ban/{userId}', CommandType.BUTTON)
      async alsoBan(_i: unknown, _params: Record<string, string>) {}
    }

    @MeoCord({ controllers: [Twice], clientOptions: { intents: [] } })
    class TwiceApp {}

    const same = /"ban\/\{id\}" in Twice\.ban and "ban\/\{userId\}" in Twice\.alsoBan match the same button customIds/
    expect(() => findRouteConflicts(TwiceApp)).toThrow(same)
    expect(() => resolveRoute(TwiceApp, { type: CommandType.BUTTON, customId: 'ban/1' })).toThrow(same)
  })
})

describe('resolveRoute for messages', () => {
  @Controller()
  class DiceController {
    @MessageHandler('roll {sides} {note...?}')
    async roll(_message: unknown, _params: Record<string, string>) {}

    @MessageHandler('roll 20')
    async rollTwenty() {}

    @MessageHandler('hello', { prefix: false })
    async hello() {}

    @MessageHandler()
    async everything() {}
  }

  @MeoCord({ controllers: [DiceController], clientOptions: { intents: [] }, messages: { prefix: '!', mention: true } })
  class DiceApp {}

  it('resolves message content to the handler dispatch runs, with its params', () => {
    expect(resolveRoute(DiceApp, { content: '!roll 6 for luck' })).toEqual({
      controller: DiceController,
      method: 'roll',
      handler: DiceController.prototype.roll,
      params: { sides: '6', note: 'for luck' },
    })
    expect(resolveRoute(DiceApp, { content: '!ROLL 20' })?.method).toBe('rollTwenty')
    expect(resolveRoute(DiceApp, { content: 'hello' })?.method).toBe('hello')
  })

  it('never resolves to a listener, and resolves nothing the prefix rules out', () => {
    expect(resolveRoute(DiceApp, { content: 'roll 6' })).toBeUndefined()
    expect(resolveRoute(DiceApp, { content: '!unknown' })).toBeUndefined()
  })

  it('accepts a mention of the bot when given its id', () => {
    expect(resolveRoute(DiceApp, { content: '<@111> roll 6', botId: '111' })?.method).toBe('roll')
    expect(resolveRoute(DiceApp, { content: '<@111> roll 6' })).toBeUndefined()
  })

  it('takes the prefix a message has when the app reads prefixes from a function', () => {
    @MeoCord({ controllers: [DiceController], clientOptions: { intents: [] }, messages: { prefix: () => '?' } })
    class PerGuildApp {}

    expect(resolveRoute(PerGuildApp, { content: '?roll 6', prefix: '?' })?.method).toBe('roll')
    expect(() => resolveRoute(PerGuildApp, { content: '?roll 6' })).toThrow(
      /reads its prefixes from a function; pass the prefix this message has/,
    )
  })
})
