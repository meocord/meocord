import { ButtonInteraction, type Message } from 'discord.js'
import { MessageUsageError } from '@src/common/errors.js'
import { route } from '@src/common/route.js'
import { Command, Controller, MeoCord, MessageHandler } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { type MessageParamType } from '@src/interface/index.js'
import { buildMessageRoutes, type MessageRoute } from '@src/core/message-routes.js'
import { fitsParamType, resolveMessageParams } from '@src/core/message-params.js'
import { createMockInteraction, createMockMessage, MeoCordTestingModule } from '@src/testing/index.js'

// Names every object inherits, which no param type and no table of words knows
const INHERITED = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']

function routeOf(pattern: string, types?: Record<string, MessageParamType>): MessageRoute {
  @Controller()
  class Only {
    @MessageHandler(pattern)
    handle() {}
  }
  return buildMessageRoutes([Only], { types })[0]
}

const refusal = (promise: Promise<unknown>) =>
  promise.then(
    value => ({ value }),
    (error: unknown) => (error instanceof MessageUsageError ? 'usage error' : error),
  )

describe('words the scalar types read', () => {
  it('reads an inherited name as no boolean', async () => {
    const route = routeOf('set {on:bool} {after:duration}')
    const message = createMockMessage({ content: 'x' })

    for (const word of INHERITED) {
      expect(await refusal(resolveMessageParams(route, { on: word, after: '1m' }, message, '!', undefined)), word).toBe('usage error')
      expect(fitsParamType('bool', word, false), word).toBe(false)
    }
    expect(await resolveMessageParams(route, { on: 'yes', after: '1m' }, message, '!', undefined)).toEqual({ on: true, after: 60_000 })
  })

  it('reads an inherited name as no value of a boolean flag', async () => {
    const got: unknown[] = []
    @Controller()
    class Purge {
      @MessageHandler('purge {count:int} {--bots}')
      purge(_message: Message, { bots }: { bots: boolean }) {
        got.push(bots)
      }
    }
    @MeoCord({ controllers: [Purge], clientOptions: { intents: [] }, messages: { prefix: '!' } })
    class App {}
    const module = MeoCordTestingModule.fromApp(App).compile()

    for (const word of INHERITED) await module.dispatch(createMockMessage({ content: `!purge 3 --bots=${word}` }))
    await module.dispatch(createMockMessage({ content: '!purge 3 --bots=off' }))

    expect(got).toEqual([false])
  })

  it('reads an inherited name as no boolean customId segment', async () => {
    const got: unknown[] = []
    @Controller()
    class Toggle {
      @Command('toggle/{on:bool}', CommandType.BUTTON)
      toggle(_interaction: ButtonInteraction, { on }: { on: boolean }) {
        got.push(on)
      }
    }
    const module = MeoCordTestingModule.create({ controllers: [Toggle] }).compile()

    for (const word of INHERITED) await module.dispatch(createMockInteraction(ButtonInteraction, { customId: `toggle/${word}` })).catch(() => undefined)
    await module.dispatch(createMockInteraction(ButtonInteraction, { customId: 'toggle/on' }))

    expect(got).toEqual([true])
  })

  // A segment type is kept by the param's own name, so one named like an inherited key keeps its type too
  it('keeps the type of a customId param named __proto__', async () => {
    const got: unknown[] = []
    @Controller()
    class Proto {
      @Command('c/{__proto__:int}', CommandType.BUTTON)
      press(_interaction: ButtonInteraction, params: object) {
        got.push(Object.getOwnPropertyDescriptor(params, '__proto__')?.value)
      }
    }
    const module = MeoCordTestingModule.create({ controllers: [Proto] }).compile()

    await module.dispatch(createMockInteraction(ButtonInteraction, { customId: 'c/x' })).catch(() => undefined)
    await module.dispatch(createMockInteraction(ButtonInteraction, { customId: 'c/5' }))

    expect(got).toEqual([5])
  })
})

describe('param type names', () => {
  const color: MessageParamType<number> = { label: 'colour', parse: word => (word === 'red' ? 0xff0000 : undefined) }

  it('names no type with an inherited name, with or without app types', () => {
    for (const name of INHERITED) {
      expect(() => routeOf(`paint {x:${name}}`), name).toThrow(/names no type/)
      expect(() => routeOf(`paint {x:${name}}`, { color }), name).toThrow(/names no type/)
    }
    expect(routeOf('paint {x:color}', { color }).pattern).toBe('paint {x:color}')
  })

  it('refuses an inherited name as a customId segment type', () => {
    for (const name of INHERITED) {
      expect(() => {
        @Controller()
        class Segments {
          @Command(`c/{x:${name}}`, CommandType.BUTTON)
          press() {}
        }
        return Segments
      }, name).toThrow(/Invalid pattern/)
    }
  })
})

describe('route() params with an inherited name', () => {
  it('builds a customId from the value given, and needs one when none is', () => {
    expect(route('a/{constructor}').build({ constructor: 'x' } as never)).toBe('a/x')
    expect(route('t/{toString:bool}').build({ toString: true } as never)).toBe('t/true')
    expect(() => route('a/{constructor}').build({} as never)).toThrow(/needs a value for \{constructor\}/)
  })
})
