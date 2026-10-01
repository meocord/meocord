import { vi } from 'vitest'
import { Logger } from '@src/common/logger.js'
import { forgetDeprecationWarnings } from '@src/common/deprecation.js'
import { Command, Controller, MessageHandler } from '@src/decorator/index.js'
import { getCommandMap, getMessageHandlers } from '@src/decorator/controller.decorator.js'
import { CommandType } from '@src/enum/index.js'

const warnings = () => vi.mocked(Logger.prototype.warn).mock.calls.map(([line]) => String(line))

beforeEach(() => {
  forgetDeprecationWarnings()
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

@Controller()
class BasePager {
  @Command('page/{n:int}', CommandType.BUTTON)
  page() {}

  @MessageHandler('hi')
  hi() {}
}

describe('a handler a subclass re-declares on another route', () => {
  it('keeps answering the inherited route, as in 4.0, and says 5.0 drops it, naming both', () => {
    @Controller()
    class ShopPager extends BasePager {
      @Command('shop/page/{n:int}', CommandType.BUTTON)
      page() {}

      @MessageHandler('hello')
      hi() {}
    }

    expect(Object.keys(getCommandMap(ShopPager.prototype))).toEqual(['page/{n:int}', 'shop/page/{n:int}'])
    expect(getMessageHandlers(ShopPager.prototype).map(handler => handler.pattern)).toEqual(['hi', 'hello'])
    expect(warnings()).toEqual([
      'An inherited route that a re-declared handler keeps (ShopPager.page answers "page/{n:int}" as well as ' +
        '"shop/page/{n:int}") is deprecated; in the next major version (5.0) it is dropped. Use a decorator for each ' +
        'route ShopPager.page should answer instead.',
      'An inherited route that a re-declared handler keeps (ShopPager.hi answers "hi" as well as "hello") is ' +
        'deprecated; in the next major version (5.0) it is dropped. Use a decorator for each route ShopPager.hi ' +
        'should answer instead.',
    ])
  })

  it('says nothing when the subclass declares every route itself, or none, or repeats the inherited one', () => {
    @Controller()
    class Both extends BasePager {
      @Command('page/{n:int}', CommandType.BUTTON)
      @Command('shop/page/{n:int}', CommandType.BUTTON)
      page() {}
    }
    @Controller()
    class Same extends BasePager {
      @MessageHandler('hi')
      hi() {}
    }
    @Controller()
    class Untouched extends BasePager {}
    void [Both, Same, Untouched]

    expect(warnings()).toEqual([])
  })
})
