import { ButtonInteraction } from 'discord.js'
import { route } from '@src/common/route.js'
import { Command, Controller, MeoCord } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { createMockInteraction, findRouteConflicts, MeoCordTestingModule, resolveRoute } from '@src/testing/index.js'
import { buildComponentRoutes } from '@src/core/component-routes.js'

const received: unknown[] = []
const counter = route('counter/{count:int}')

@Controller()
class Panel {
  @Command(counter, CommandType.BUTTON)
  async count(_interaction: ButtonInteraction, { count }: { count: number }) {
    received.push(['count', count])
  }

  @Command('counter/reset', CommandType.BUTTON)
  async reset() {
    received.push(['reset'])
  }

  @Command('toggle/{on:bool}', CommandType.BUTTON)
  async toggle(_interaction: ButtonInteraction, { on }: { on: boolean }) {
    received.push(['toggle', on])
  }

  @Command('sort/{order:asc|desc}/{page:number}', CommandType.BUTTON)
  async sort(_interaction: ButtonInteraction, { order, page }: { order: 'asc' | 'desc'; page: number }) {
    received.push(['sort', order, page])
  }
}

@MeoCord({ controllers: [Panel], clientOptions: { intents: [] } })
class App {}

const press = (customId: string) => createMockInteraction(ButtonInteraction, { customId })

beforeEach(() => {
  received.length = 0
})

describe('typed customId params', () => {
  const module = MeoCordTestingModule.create({ app: App, controllers: [Panel] }).compile()

  it('gives the handler each typed segment as its value, and reaches no handler for a segment that is not one', async () => {
    for (const id of ['counter/5', 'counter/-2', 'toggle/true', 'toggle/off', 'sort/desc/2.5', 'counter/reset']) await module.dispatch(press(id))
    expect(received).toEqual([['count', 5], ['count', -2], ['toggle', true], ['toggle', false], ['sort', 'desc', 2.5], ['reset']])

    received.length = 0
    for (const id of ['counter/five', 'toggle/maybe', 'sort/up/1', 'sort/asc/x']) {
      const { handlers } = await module.dispatch(press(id)).catch(() => ({ handlers: [] }))
      expect(handlers).toEqual([])
    }
    expect(received).toEqual([])
  })

  it('reads a customId alike in resolveRoute and invoke', async () => {
    expect(resolveRoute(App, { type: CommandType.BUTTON, customId: 'counter/7' })).toMatchObject({
      method: 'count',
      params: { count: '7' },
      values: { count: 7 },
    })
    expect(resolveRoute(App, { type: CommandType.BUTTON, customId: 'counter/seven' })).toBeUndefined()
    // A route without a typed param has no values
    expect(resolveRoute(App, { type: CommandType.BUTTON, customId: 'counter/reset' })).not.toHaveProperty('values')

    await module.invoke(Panel, 'count', press(counter.build({ count: 3 })))
    expect(received).toEqual([['count', 3]])
    await expect(module.invoke(Panel, 'count', press('counter/three'))).rejects.toThrow("does not match Panel.count's route")
  })

  it('builds a typed segment from its value, and refuses one it could not read back', () => {
    expect(counter.build({ count: 12 })).toBe('counter/12')
    expect(route('toggle/{on:bool}').build({ on: false })).toBe('toggle/false')
    expect(() => counter.build({ count: 1.5 })).toThrow(`route('counter/{count:int}').build() got 1.5 for {count:int}, which is not a value of its type.`)
    expect(() => route('scale/{by:number}').build({ by: Number.NaN })).toThrow('got NaN for {by:number}')
    expect(() => route('pick/{w:yes|no}').build({ w: 'maybe' as never })).toThrow('got "maybe" for {w:yes|no}')
  })

  it('refuses a type a customId cannot hold where the pattern is declared', () => {
    const declare = (pattern: string) => () => {
      @Controller()
      class Bad {
        @Command(pattern, CommandType.BUTTON)
        handle() {}
      }
      return Bad
    }
    expect(declare('ban/{target:member}')).toThrow('{target:member} is a type only a message command reads.')
    expect(declare('wait/{for:duration}')).toThrow('{for:duration} names no type a customId can hold.')
    expect(declare('paint/{shade:colour}')).toThrow('{shade:colour} names no type a customId can hold.')
    expect(declare('paint/{shade:}')).toThrow('{shade:} names no type a customId can hold.')
    expect(declare('pick/{w:|}')).toThrow('{w:|} lists an empty word to choose from')
    expect(declare('pick/{w:a|}')).toThrow('{w:a|} lists an empty word to choose from')
  })
})

describe('typed customId params beside other routes of one shape', () => {
  it('keeps routes whose typed segments take different values, and runs the typed one first, in either order', async () => {
    const ran: unknown[] = []
    @Controller()
    class Typed {
      @Command('item/{n:int}', CommandType.BUTTON) async item(_i: ButtonInteraction, { n }: { n: number }) { ran.push(['int', n]) }
      @Command('sort/{o:asc|desc}', CommandType.BUTTON) async sort(_i: ButtonInteraction, { o }: { o: string }) { ran.push(['order', o]) }
      @Command('page/{n:int}', CommandType.BUTTON) async page(_i: ButtonInteraction, { n }: { n: number }) { ran.push(['page', n]) }
      @Command('t/{id}/{n:int}', CommandType.BUTTON) async t(_i: ButtonInteraction, { n }: { n: number }) { ran.push(['t', n]) }
    }
    @Controller()
    class Loose {
      @Command('item/{f:bool}', CommandType.BUTTON) async flag(_i: ButtonInteraction, { f }: { f: boolean }) { ran.push(['bool', f]) }
      @Command('sort/{p:int}', CommandType.BUTTON) async by(_i: ButtonInteraction, { p }: { p: number }) { ran.push(['by', p]) }
      @Command('page/{name}', CommandType.BUTTON) async named(_i: ButtonInteraction, { name }: { name: string }) { ran.push(['named', name]) }
      @Command('t/{id}/{name}', CommandType.BUTTON) async tn(_i: ButtonInteraction, { name }: { name: string }) { ran.push(['tn', name]) }
    }
    for (const controllers of [[Typed, Loose], [Loose, Typed]]) {
      expect(() => buildComponentRoutes(controllers)).not.toThrow()
      ran.length = 0
      const module = MeoCordTestingModule.create({ controllers }).compile()
      for (const id of ['item/3', 'item/true', 'sort/asc', 'sort/2', 'page/5', 'page/last', 't/a/9', 't/a/z']) await module.dispatch(press(id))
      expect(ran).toEqual([['int', 3], ['bool', true], ['order', 'asc'], ['by', 2], ['page', 5], ['named', 'last'], ['t', 9], ['tn', 'z']])
    }
  })

  it('keeps a typed spelling beside a text spelling of one handler, so its typed segments still arrive as values', async () => {
    const got: unknown[] = []
    @Controller()
    class Card {
      @Command('card/{id:int}', CommandType.BUTTON)
      @Command('card/{id}', CommandType.BUTTON)
      async open(_i: ButtonInteraction, { id }: { id: number | string }) {
        got.push(id)
      }
    }
    const module = MeoCordTestingModule.create({ controllers: [Card] }).compile()
    await module.dispatch(press('card/5'))
    await module.dispatch(press('card/abc'))
    expect(got).toEqual([5, 'abc'])
  })

  it('reports none of the pairs a literal or a narrower type ranks apart', () => {
    @Controller()
    class Paths {
      @Command('p/last/x', CommandType.BUTTON) last() {}
      @Command('p/{n:int}/x', CommandType.BUTTON) numbered() {}
      @Command('q/{f:bool}', CommandType.BUTTON) flag() {}
      @Command('q/{n:number}', CommandType.BUTTON) amount() {}
      @Command('r/{w:on|off}', CommandType.BUTTON) toggle() {}
      @Command('r/{f:bool}', CommandType.BUTTON) bool() {}
    }
    @MeoCord({ controllers: [Paths], clientOptions: { intents: [] } })
    class PathsApp {}
    // 'on' and 'off' read as booleans, so r/on matches both, and the words, narrower than bool, take it
    expect(findRouteConflicts(PathsApp)).toEqual([])
  })
})

describe('typed customId params of one shape', () => {
  it('keeps words beside bool, with a shared value going to the words; the same words in another order are refused', async () => {
    const ran: unknown[] = []
    @Controller()
    class Toggle {
      @Command('r/{f:bool}', CommandType.BUTTON) async bool(_i: ButtonInteraction, { f }: { f: boolean }) { ran.push(['bool', f]) }
      @Command('r/{w:on|off}', CommandType.BUTTON) async words(_i: ButtonInteraction, { w }: { w: string }) { ran.push(['words', w]) }
    }
    @MeoCord({ controllers: [Toggle], clientOptions: { intents: [] } })
    class ToggleApp {}
    expect(findRouteConflicts(ToggleApp)).toEqual([])
    const module = MeoCordTestingModule.create({ controllers: [Toggle] }).compile()
    for (const id of ['r/on', 'r/yes']) await module.dispatch(press(id))
    expect(ran).toEqual([['words', 'on'], ['bool', true]])

    @Controller()
    class Twice {
      @Command('s/{w:on|off}', CommandType.BUTTON) first() {}
      @Command('s/{v:off|on}', CommandType.BUTTON) second() {}
    }
    expect(() => buildComponentRoutes([Twice])).toThrow(/Twice\.first: "s\/\{w:on\|off\}" and "s\/\{v:off\|on\}" in Twice\.second match the same/)
  })

  it('runs the narrower type first, whatever order they are declared in', async () => {
    const ran: unknown[] = []
    @Controller()
    class Wide {
      @Command('n/{x:number}', CommandType.BUTTON) async wide(_i: ButtonInteraction, { x }: { x: number }) { ran.push(['number', x]) }
    }
    @Controller()
    class Narrow {
      @Command('n/{x:int}', CommandType.BUTTON) async narrow(_i: ButtonInteraction, { x }: { x: number }) { ran.push(['int', x]) }
    }
    for (const controllers of [[Wide, Narrow], [Narrow, Wide]]) {
      ran.length = 0
      const module = MeoCordTestingModule.create({ controllers }).compile()
      for (const id of ['n/5', 'n/2.5']) await module.dispatch(press(id))
      expect(ran).toEqual([['int', 5], ['number', 2.5]])
    }
  })
})

// A snowflake made from 2015-01-28 on, by Discord's epoch math, has 17 to 20 digits; 16 or fewer read as an int
describe('snowflake and uuid params', () => {
  const ran: unknown[] = []
  const snowflake = '1234567890123456789'
  const uuid = '0F8FAD5B-D9CB-469F-A165-70867728950E'
  const handler = (kind: string) => {
    @Controller()
    class Routed {
      @Command(`id/{value:${kind}}`, CommandType.BUTTON)
      async handle(_i: ButtonInteraction, { value }: { value: unknown }) {
        ran.push([kind, value])
      }
    }
    return Routed
  }
  const kinds = ['snowflake', 'uuid', 'int', 'number', 'bool', 'string']

  beforeEach(() => {
    ran.length = 0
  })

  it.each([
    ['1234567890123456', 'int', 1234567890123456],
    ['12345678901234567', 'snowflake', '12345678901234567'],
    [snowflake, 'snowflake', snowflake],
    ['18446744073709551615', 'snowflake', '18446744073709551615'],
    ['18446744073709551616', 'number', 18446744073709552000],
    ['123456789012345678901', 'number', 123456789012345680000],
    ['-12345678901234567', 'number', -12345678901234567],
    [uuid, 'uuid', uuid],
    [uuid.toLowerCase(), 'uuid', uuid.toLowerCase()],
    ['0f8fad5bd9cb469fa16570867728950e', 'string', '0f8fad5bd9cb469fa16570867728950e'],
    ['{0f8fad5b-d9cb-469f-a165-70867728950e}', 'string', '{0f8fad5b-d9cb-469f-a165-70867728950e}'],
    ['true', 'bool', true],
  ])('gives %s to the %s handler, whatever the listing', async (segment, kind, value) => {
    for (const listed of [kinds, [...kinds].reverse()]) {
      ran.length = 0
      const module = MeoCordTestingModule.create({ controllers: listed.map(handler) }).compile()
      await module.dispatch(press(`id/${segment}`))
      expect(ran).toEqual([[kind, value]])
    }
  })

  it('ranks apart from every other type, so no pair of them collides', () => {
    @MeoCord({ controllers: kinds.map(handler), clientOptions: { intents: [] } })
    class Kinds {}
    expect(findRouteConflicts(Kinds)).toEqual([])
  })

  it('builds a segment from its text, and refuses text that is not one', () => {
    const member = route('member/{id:snowflake}/{session:uuid}')
    expect(member.build({ id: snowflake, session: uuid })).toBe(`member/${snowflake}/${uuid}`)
    expect(() => member.build({ id: '1234567890123456', session: uuid })).toThrow('got "1234567890123456" for {id:snowflake}')
    expect(() => member.build({ id: snowflake, session: 'not-a-uuid' })).toThrow('got "not-a-uuid" for {session:uuid}')
  })
})

it('reports two tied patterns that share a snowflake and a word, with an id both match', () => {
  @Controller()
  class Tied {
    @Command('t/{a:snowflake}/{b:on|off}', CommandType.BUTTON) first() {}
    @Command('t/{c:snowflake}/{d:off|no}', CommandType.BUTTON) second() {}
  }
  expect(buildComponentRoutes([Tied]).length).toBe(2)
  @MeoCord({ controllers: [Tied], clientOptions: { intents: [] } })
  class TiedApp {}
  expect(findRouteConflicts(TiedApp)).toEqual([{ type: CommandType.BUTTON, patterns: ['t/{a:snowflake}/{b:on|off}', 't/{c:snowflake}/{d:off|no}'] }])
})
