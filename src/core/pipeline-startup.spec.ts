import { inject } from 'inversify'
import { AutocompleteInteraction, ChatInputCommandInteraction, type Message, type MessageReaction } from 'discord.js'
import { vi } from 'vitest'
import {
  Autocomplete,
  Catch,
  Command,
  Controller,
  Cooldown,
  Defer,
  Interceptor,
  MessageHandler,
  On,
  Pipe,
  ReactionHandler,
  UseFilter,
  UseInterceptor,
  UsePipe,
  Validate,
} from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { type CallHandler, type ExceptionFilter, type InterceptorInterface, type PipeInterface, type StandardSchemaV1 } from '@src/interface/index.js'
import { ExecutionContext, Logger } from '@src/common/index.js'
import { appStages, runHandler } from '@src/core/handler-pipeline.js'
import { createMockInteraction, MeoCordTestingModule } from '@src/testing/index.js'

// What the pipeline checks when a module or an app starts, before any call arrives.

@Interceptor()
class NeedsContext implements InterceptorInterface {
  // Typed loosely, so only the @inject token names ExecutionContext
  constructor(@inject(ExecutionContext) readonly context: object) {}
  intercept(_context: ExecutionContext, next: CallHandler) {
    return next.handle()
  }
}

const compile = (...controllers: (new (...args: any[]) => unknown)[]) => () =>
  MeoCordTestingModule.create({ controllers }).compile()

const refusedInterceptor = 'NeedsContext: resolved once and shared, so it cannot inject ExecutionContext'

describe('stages checked at startup', () => {
  it.each([
    [
      'message',
      () => {
        @Controller()
        class Handlers {
          @MessageHandler('hi')
          @UseInterceptor(NeedsContext)
          async hi(_message: Message) {}
        }
        return Handlers
      },
    ],
    [
      'reaction',
      () => {
        @Controller()
        class Handlers {
          @ReactionHandler('👍')
          @UseInterceptor(NeedsContext)
          async like(_reaction: MessageReaction) {}
        }
        return Handlers
      },
    ],
    [
      'autocomplete',
      () => {
        @Controller()
        class Handlers {
          @Command('search', CommandType.SLASH)
          async search(_interaction: ChatInputCommandInteraction) {}

          @Autocomplete('search')
          @UseInterceptor(NeedsContext)
          async suggest(_interaction: AutocompleteInteraction) {}
        }
        return Handlers
      },
    ],
    [
      'event',
      () => {
        @Controller()
        class Handlers {
          @On('guildCreate')
          @UseInterceptor(NeedsContext)
          async joined() {}
        }
        return Handlers
      },
    ],
  ])('include an interceptor on a %s handler', (_kind, declare) => {
    expect(compile(declare())).toThrow(refusedInterceptor)
  })

  it('include a pipe, which is shared like an interceptor', () => {
    @Pipe()
    class ContextPipe implements PipeInterface {
      constructor(@inject(ExecutionContext) readonly context: object) {}
      transform(value: unknown) {
        return value
      }
    }

    @Controller()
    class Piped {
      @Command('piped', CommandType.SLASH)
      @UsePipe('id', ContextPipe)
      async piped(_interaction: ChatInputCommandInteraction, _params: { id: unknown }) {}
    }

    expect(compile(Piped)).toThrow('ContextPipe: resolved once and shared, so it cannot inject ExecutionContext')
  })
})

describe('input stages on handlers without interaction input', () => {
  it('refuse @UsePipe alone on a message handler without a pattern', () => {
    @Pipe()
    class Trim implements PipeInterface<string, string> {
      transform(value: string) {
        return value.trim()
      }
    }
    @Controller()
    class Messages {
      @MessageHandler()
      async ping(_message: Message) {}
    }
    // Applied by hand: a listener's one-argument signature already rejects @UsePipe at compile time.
    UsePipe('text', Trim)(Messages.prototype, 'ping', Object.getOwnPropertyDescriptor(Messages.prototype, 'ping') as never)

    expect(compile(Messages)).toThrow(
      'Messages.ping is a message handler without a pattern; @Validate and @UsePipe apply only to interaction and patterned message handlers',
    )
  })

  it('name an event handler as one when refusing @Validate or @Cooldown on it', () => {
    const anything: StandardSchemaV1 = { '~standard': { version: 1, vendor: 'test', validate: value => ({ value }) } }

    @Controller()
    class Validated {
      @On('guildCreate')
      async joined(..._args: unknown[]) {}
    }
    Validate(anything)(Validated.prototype, 'joined', Object.getOwnPropertyDescriptor(Validated.prototype, 'joined') as never)

    @Controller()
    class Limited {
      @On('guildCreate')
      @Cooldown({ seconds: 5 })
      async joined() {}
    }

    expect(compile(Validated)).toThrow(
      'Validated.joined is an event handler; @Validate and @UsePipe apply only to interaction and patterned message handlers',
    )
    expect(compile(Limited)).toThrow('Limited.joined is an event handler; @Cooldown applies only to interaction and message handlers.')
  })

  it('name an autocomplete handler as one too', () => {
    const anything: StandardSchemaV1 = { '~standard': { version: 1, vendor: 'test', validate: value => ({ value }) } }

    @Controller()
    class Validated {
      @Command('find', CommandType.SLASH)
      async find(_interaction: ChatInputCommandInteraction) {}

      @Autocomplete('find')
      async suggest(..._args: unknown[]) {}
    }
    Validate(anything)(Validated.prototype, 'suggest', Object.getOwnPropertyDescriptor(Validated.prototype, 'suggest') as never)

    @Controller()
    class Limited {
      @Command('find', CommandType.SLASH)
      async find(_interaction: ChatInputCommandInteraction) {}

      @Autocomplete('find')
      @Cooldown({ seconds: 5 })
      async suggest(_interaction: AutocompleteInteraction) {}
    }

    expect(compile(Validated)).toThrow('Validated.suggest is an autocomplete handler; @Validate and @UsePipe apply only')
    expect(compile(Limited)).toThrow('Limited.suggest is an autocomplete handler; @Cooldown applies only')
  })

  it('refuse @Defer written below @MessageHandler, which runs before the handler is known', () => {
    @Controller()
    class Deferred {
      @MessageHandler('hi')
      @Defer()
      async hi(_message: Message) {}
    }

    expect(compile(Deferred)).toThrow('Deferred.hi: @Defer is for interaction handlers, and this is a message handler')
  })
})

describe('classes keyed by name', () => {
  const sameNamed = (withCooldown: 'message' | 'second handler') => {
    if (withCooldown === 'message') {
      @Controller()
      class Shop {
        @MessageHandler('buy')
        @Cooldown({ seconds: 5 })
        async buy(_message: Message) {}
      }
      return Shop
    }
    @Controller()
    class Shop {
      @Command('look', CommandType.SLASH)
      async look(_interaction: ChatInputCommandInteraction) {}

      @Command('buy', CommandType.SLASH)
      @Cooldown({ seconds: 5 })
      async buy(_interaction: ChatInputCommandInteraction) {}
    }
    return Shop
  }
  // A handler, but no cooldown: this Shop keeps nothing under its name.
  const plain = () => {
    @Controller()
    class Shop {
      @Command('browse', CommandType.SLASH)
      async browse(_interaction: ChatInputCommandInteraction) {}
    }
    return Shop
  }

  it("count a message handler's cooldown, and a cooldown on any one of several handlers", () => {
    expect(compile(sameNamed('message'), plain())).toThrow('Two classes are named Shop')
    expect(compile(plain(), sameNamed('second handler'))).toThrow('Two classes are named Shop')
  })
})

describe('a filter that throws under dispatch', () => {
  it('is logged by name, and the fallback answers the original error', async () => {
    @Catch()
    class Broken implements ExceptionFilter {
      catch(): void {
        throw new Error('filter bug')
      }
    }

    @Controller()
    class Failing {
      @Command('fail', CommandType.SLASH)
      @UseFilter({ provide: Broken, params: { reason: 'given as an entry' } })
      async fail(_interaction: ChatInputCommandInteraction) {
        throw new Error('handler bug')
      }
    }

    const module = MeoCordTestingModule.create({ controllers: [Failing] }).compile()
    const container = Reflect.get(module, 'container')
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {})
    const fallback = vi.fn(async () => {})

    try {
      const outcome = await runHandler(container, module.get(Failing) as never, 'fail', [createMockInteraction(ChatInputCommandInteraction), {}], { fallback })

      expect((outcome.error as Error).message).toBe('handler bug')
      expect(fallback).toHaveBeenCalledWith(expect.objectContaining({ message: 'handler bug' }), expect.anything())
      expect(logged).toHaveBeenCalledWith('Filter Broken threw while handling an error:', expect.objectContaining({ message: 'filter bug' }))
    } finally {
      logged.mockRestore()
    }
  })
})

describe('a filter class that throws under dispatch', () => {
  it('is logged by its name', async () => {
    @Catch()
    class Fragile implements ExceptionFilter {
      catch(): void {
        throw new Error('filter bug')
      }
    }

    @Controller()
    class Failing {
      @Command('fail', CommandType.SLASH)
      @UseFilter(Fragile)
      async fail(_interaction: ChatInputCommandInteraction) {
        throw new Error('handler bug')
      }
    }

    const module = MeoCordTestingModule.create({ controllers: [Failing] }).compile()
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {})
    try {
      await runHandler(Reflect.get(module, 'container'), module.get(Failing) as never, 'fail', [createMockInteraction(ChatInputCommandInteraction), {}], {
        fallback: async () => {},
      })

      expect(logged).toHaveBeenCalledWith('Filter Fragile threw while handling an error:', expect.objectContaining({ message: 'filter bug' }))
    } finally {
      logged.mockRestore()
    }
  })
})

describe('appStages', () => {
  it('names an anonymous app class as "The app" when it lacks @MeoCord', () => {
    expect(() => appStages(Object.defineProperty(class {}, 'name', { value: '' }))).toThrow('The app is not decorated with @MeoCord().')
  })
})
