import { ChatInputCommandInteraction } from 'discord.js'
import { z } from 'zod'
import { vi } from 'vitest'
import { Logger } from '@src/common/logger.js'
import { forgetDeprecationWarnings } from '@src/common/deprecation.js'
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

  it('refuses @Inject on a method parameter, naming the method', () => {
    let error: unknown
    try {
      class Shop {
        run(@Inject('token') _value: string) {}
      }
      void Shop
    } catch (thrown) {
      error = thrown
    }

    expect((error as Error).message).toBe('Shop.run: @Inject goes on a constructor parameter or a property, not a method parameter.')
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

// A static member's metadata lands on the class, where nothing reads it
describe('a method decorator on a static method', () => {
  afterEach(() => {
    forgetDeprecationWarnings()
    vi.restoreAllMocks()
  })

  it('warns that the handler never runs, naming the class and the method', () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {})

    @Controller()
    class St {
      @Command('sping', CommandType.SLASH)
      static ping(_interaction: ChatInputCommandInteraction) {}

      @On('guildMemberAdd')
      static joined() {}

      @Command('fine', CommandType.SLASH)
      fine(_interaction: ChatInputCommandInteraction) {}
    }
    void St

    expect(warn.mock.calls.map(([message]) => message)).toEqual([
      'St.ping: @Command goes on an instance method, not a static one; it never runs. The next major version (5.0) refuses it.',
      'St.joined: @On goes on an instance method, not a static one; it never runs. The next major version (5.0) refuses it.',
    ])
  })

  // Its types refuse a static property, so it is applied as JavaScript applies it there
  it('warns that @Inject on a static property is never injected', () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {})
    class St {}

    ;(Inject('dependency') as (target: object, propertyKey: string) => void)(St, 'dependency')

    expect(warn.mock.calls.map(([message]) => message)).toEqual([
      'St.dependency: @Inject goes on an instance member, not a static one, where nothing reads it. The next major version (5.0) refuses it.',
    ])
  })

  it('names the class, not Function, in a refusal', () => {
    let refusal: unknown
    try {
      class St {
        @UseTheme({ colors: { primary: 'nope' as never } })
        static m() {}
      }
      void St
    } catch (error) {
      refusal = error
    }

    expect(String((refusal as Error).message).startsWith('St.m: @UseTheme')).toBe(true)
  })
})
