import { ChatInputCommandInteraction } from 'discord.js'
import {
  Catch,
  Command,
  Controller,
  Guard,
  Interceptor,
  MeoCord,
  Pipe,
  UseFilter,
  UseGuard,
  UseInterceptor,
  UsePipe,
  Validate,
} from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import {
  type CallHandler,
  type ExceptionFilter,
  type GuardInterface,
  type InterceptorInterface,
  type PipeInterface,
  type StandardSchemaV1,
} from '@src/interface/index.js'
import { type ExecutionContext } from '@src/common/index.js'
import { createMockInteraction, MeoCordTestingModule } from '@src/testing/index.js'

// Every stage takes a class, or { provide: Class, params? }; anything else is refused where it is written.

const log: string[] = []
beforeEach(() => (log.length = 0))

@Guard()
class Allow implements GuardInterface {
  canActivate() {
    log.push('guard')
    return true
  }
}

@Interceptor()
class Around implements InterceptorInterface {
  intercept(context: ExecutionContext, next: CallHandler) {
    log.push(`interceptor ${JSON.stringify(context.getParams() ?? null)}`)
    return next.handle()
  }
}

@Pipe()
class Upper implements PipeInterface<string, string> {
  transform(value: string) {
    return value.toUpperCase()
  }
}

@Catch()
class Quiet implements ExceptionFilter {
  catch() {
    log.push('filter')
  }
}

const anything: StandardSchemaV1<unknown, { text: string }> = {
  '~standard': { version: 1, vendor: 'test', validate: value => ({ value: value as { text: string } }) },
}

describe('{ provide } without params', () => {
  it('works like the class alone, for every stage', async () => {
    @Controller()
    class Plain {
      @Command('plain', CommandType.SLASH)
      @UseGuard({ provide: Allow })
      @UseInterceptor({ provide: Around })
      @UseFilter({ provide: Quiet })
      @UsePipe('text', { provide: Upper })
      async plain(_interaction: ChatInputCommandInteraction, { text }: { text: string }) {
        log.push(`handler ${text}`)
        throw new Error('handled by the filter')
      }
    }

    const { ran } = await MeoCordTestingModule.create({ controllers: [Plain] })
      .compile()
      .invoke(Plain, 'plain', createMockInteraction(ChatInputCommandInteraction), { text: 'hi' })

    expect(ran).toBe(true)
    expect(log).toEqual(['guard', 'interceptor null', 'handler HI', 'filter'])
  })
})

describe('a malformed entry', () => {
  // Applied by hand where the types already refuse the entry at compile time.
  const onMethod = (decorator: (target: object, key: string, descriptor: PropertyDescriptor) => void) => () => {
    class Handlers {
      async handle(..._args: unknown[]) {}
    }
    decorator(Handlers.prototype, 'handle', Object.getOwnPropertyDescriptor(Handlers.prototype, 'handle')!)
  }

  it.each([
    ['null', null, 'null is not a class'],
    ['a string', 'Allow', 'string is not a class'],
    ['{ provide } naming no class', { provide: 'Allow' }, '{ provide } does not name a class'],
    ['params that are not an object', { provide: Allow, params: 5 }, 'the params of Allow are not an object'],
    ['params that are an array', { provide: Allow, params: [1] }, 'the params of Allow are not an object'],
  ])('is refused by @UseGuard when it is %s', (_label, entry, reason) => {
    expect(onMethod(UseGuard(entry as never))).toThrow(
      `Handlers.handle: @UseGuard: ${reason}. Give a guard class, or { provide: GuardClass, params? } with params an object.`,
    )
  })

  it('is refused by a class-level @UseGuard, naming the class', () => {
    expect(() => UseGuard(null as never)(class Staff {})).toThrow('Staff: @UseGuard: null is not a class.')
  })

  it('is refused by @UseInterceptor, @UseFilter, @UsePipe and @Validate', () => {
    expect(onMethod(UseInterceptor(null as never) as never)).toThrow(
      'Handlers.handle: @UseInterceptor: null is not a class. Give an interceptor class, or { provide: InterceptorClass, params? }',
    )
    expect(onMethod(UseFilter({ provide: Quiet, params: 'x' } as never) as never)).toThrow(
      'Handlers.handle: @UseFilter: the params of Quiet are not an object. Give a filter class',
    )
    expect(onMethod(UsePipe('text', undefined as never) as never)).toThrow('Handlers.handle: @UsePipe: undefined is not a class. Give a pipe class')
    expect(onMethod(Validate(anything, { pipes: { text: [Upper, { provide: 42 }] } } as never) as never)).toThrow(
      'Handlers.handle: @Validate: { provide } does not name a class. Give a pipe class',
    )
  })

  it('is refused by @MeoCord for each list, naming the list', () => {
    const app = (options: object) => () => MeoCord({ controllers: [], clientOptions: { intents: [] }, ...options } as never)(class Bot {})

    expect(app({ guards: [null] })).toThrow('Bot: @MeoCord({ guards }): null is not a class. Give a guard class')
    expect(app({ interceptors: [{ provide: Around, params: null }] })).toThrow(
      'Bot: @MeoCord({ interceptors }): the params of Around are not an object',
    )
    expect(app({ filters: [{}] })).toThrow('Bot: @MeoCord({ filters }): { provide } does not name a class')
  })
})
