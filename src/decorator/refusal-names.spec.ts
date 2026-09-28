import { applyDecorators, SetMetadata } from '@src/common/index.js'
import { Command, Controller, Cooldown, Validate } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { isRefusal } from '@src/util/refusal.util.js'

/** Applies a method decorator to `Shop.buy`, as `@decorator` above it does. */
const onBuy = (decorator: MethodDecorator) => () => {
  class Shop {
    buy() {}
  }
  decorator(Shop.prototype, 'buy', Object.getOwnPropertyDescriptor(Shop.prototype, 'buy')!)
}

/** What a refused decorator throws, applied to `Shop.buy`. */
function refusalOf(decorator: MethodDecorator): Error {
  try {
    onBuy(decorator)()
  } catch (error) {
    return error as Error
  }
  throw new Error('the decorator applied without throwing')
}

describe('what a refused decorator names', () => {
  it.each([
    ['@Cooldown', () => Cooldown({ seconds: 0 }), 'Shop.buy: @Cooldown needs a positive number of seconds, not 0.'],
    ['@Validate', () => Validate({} as never), 'Shop.buy: @Validate takes a Standard Schema'],
    ['SetMetadata', () => SetMetadata('guards', []), 'Shop.buy: SetMetadata cannot use the key "guards"'],
  ])('%s names the handler it is on', (_name, decorator, message) => {
    const error = refusalOf(decorator() as MethodDecorator)

    expect(error.message).toContain(message)
    expect(isRefusal(error)).toBe(true)
  })

  it('names the class for a controller', () => {
    expect(() => {
      @Cooldown({ seconds: 0 })
      @Controller()
      class Shop {}
      return Shop
    }).toThrow('Shop: @Cooldown needs a positive number of seconds, not 0.')
  })

  it('names the handler of a customId pattern it cannot read', () => {
    const error = refusalOf(Command('item-{id}', CommandType.BUTTON) as MethodDecorator)

    expect(error.message).toContain('Shop.buy: Invalid pattern "item-{id}"')
    expect(isRefusal(error)).toBe(true)
  })

  it('refuses a composite that includes a refused decorator where it is applied, naming the handler', () => {
    // Built at module scope, as a composite decorator is; nothing is refused until it applies
    const Limited = applyDecorators(Cooldown({ seconds: 0 }))

    expect(onBuy(Limited)).toThrow('Shop.buy: @Cooldown needs a positive number of seconds, not 0.')
  })
})
