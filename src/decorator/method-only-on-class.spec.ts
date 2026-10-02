import { ChatInputCommandInteraction } from 'discord.js'
import { z } from 'zod'
import { applyDecorators, createMetadata } from '@src/common/index.js'
import {
  Autocomplete,
  Catch,
  Command,
  Controller,
  Cooldown,
  Defer,
  Guard,
  Inject,
  Interceptor,
  MessageHandler,
  On,
  Once,
  Pipe,
  ReactionHandler,
  UseFilter,
  UseGuard,
  UseInterceptor,
  UsePipe,
  UseTheme,
  Validate,
} from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { type CallHandler, type ExceptionFilter, type GuardInterface, type InterceptorInterface, type PipeInterface } from '@src/interface/index.js'
import { inspectHandler } from '@src/testing/index.js'
import { isRefusal } from '@src/util/refusal.util.js'

@Pipe()
class Trim implements PipeInterface {
  transform(value: unknown) {
    return String(value).trim()
  }
}

/** What applying a decorator to `class Shop {}` throws, directly or through `applyDecorators`. */
function refusalOnShop(decorator: unknown, via: 'directly' | 'through applyDecorators'): Error {
  const applied = via === 'directly' ? (decorator as ClassDecorator) : applyDecorators(decorator as ClassDecorator)
  class Shop {}
  try {
    applied(Shop)
  } catch (error) {
    return error as Error
  }
  throw new Error('the decorator applied without throwing')
}

describe('a decorator that goes only on a method, applied to a class', () => {
  const methodOnly: [string, () => unknown][] = [
    ['@Command', () => Command('buy', CommandType.SLASH)],
    ['@Autocomplete', () => Autocomplete('buy')],
    ['@MessageHandler', () => MessageHandler('buy')],
    ['@ReactionHandler', () => ReactionHandler('⭐')],
    ['@On', () => On('guildCreate')],
    ['@Once', () => Once('guildCreate')],
    ['@Validate', () => Validate(z.object({ item: z.string() }))],
    ['@UsePipe', () => UsePipe('item', Trim)],
    ['@Defer', () => Defer()],
  ]
  const cases = methodOnly.flatMap(([name, make]) =>
    (['directly', 'through applyDecorators'] as const).map(via => [name, via, make] as const),
  )

  it.each(cases)('refuses %s applied %s, naming the class', (name, via, make) => {
    const error = refusalOnShop(make(), via)

    expect(error.message).toBe(`Shop: ${name} goes on a method, not on a class.`)
    expect(isRefusal(error)).toBe(true)
  })

  it('refuses @Inject applied to a class, which goes on a constructor parameter or a property', () => {
    const error = refusalOnShop(Inject('token'), 'through applyDecorators')

    expect(error.message).toBe('Shop: @Inject goes on a constructor parameter or a property, not on a class.')
    expect(isRefusal(error)).toBe(true)
  })
})

describe('a decorator that goes on a class or a method, applied to a controller through applyDecorators', () => {
  @Guard()
  class Audit implements GuardInterface {
    canActivate() {
      return true
    }
  }
  @Interceptor()
  class Timing implements InterceptorInterface {
    intercept(_context: unknown, next: CallHandler) {
      return next.handle()
    }
  }
  @Catch(Error)
  class Fallback implements ExceptionFilter<Error> {
    catch() {}
  }

  it('applies to every handler of the controller', () => {
    const Tag = createMetadata<string>('tag')
    const Staff = () =>
      applyDecorators(UseGuard(Audit), UseInterceptor(Timing), UseFilter(Fallback), Cooldown({ seconds: 5 }), UseTheme({ colors: { primary: '#0000A1' } }), Tag('staff'))

    @Controller()
    @Staff()
    class Shop {
      @Command('buy', CommandType.SLASH)
      async buy(_interaction: ChatInputCommandInteraction) {}
    }
    const inspected = inspectHandler(Shop, 'buy')

    expect(inspected.guards).toEqual([Audit])
    expect(inspected.interceptors).toEqual([Timing])
    expect(inspected.filters).toEqual([Fallback])
    expect(inspected.cooldowns.map(cooldown => cooldown.seconds)).toEqual([5])
    expect(inspected.get(Tag)).toBe('staff')
  })
})
