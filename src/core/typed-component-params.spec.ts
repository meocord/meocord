import { ButtonInteraction } from 'discord.js'
import { route } from '@src/common/route.js'
import { Command, Controller, MeoCord } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { createMockInteraction, MeoCordTestingModule, resolveRoute } from '@src/testing/index.js'

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
    expect(resolveRoute(App, { type: CommandType.BUTTON, customId: 'counter/7' })).toMatchObject({ method: 'count', params: { count: 7 } })
    expect(resolveRoute(App, { type: CommandType.BUTTON, customId: 'counter/seven' })).toBeUndefined()

    await module.invoke(Panel, 'count', press(counter.build({ count: 3 })))
    expect(received).toEqual([['count', 3]])
    await expect(module.invoke(Panel, 'count', press('counter/three'))).rejects.toThrow("does not match Panel.count's route")
  })

  it('builds a typed segment from its value, and refuses one it could not read back', () => {
    expect(counter.build({ count: 12 })).toBe('counter/12')
    expect(route('toggle/{on:bool}').build({ on: false })).toBe('toggle/false')
    expect(() => counter.build({ count: 1.5 })).toThrow(`route('counter/{count:int}').build() got 1.5 for {count:int}, which is not a value of its type.`)
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
  })
})
