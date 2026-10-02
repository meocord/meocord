import { ButtonInteraction } from 'discord.js'
import { Catch, Command, Controller, Cooldown, Interceptor, Pipe, UseFilter, UseInterceptor, UsePipe } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { type CallHandler, type ExceptionFilter, type InterceptorInterface, type PipeInterface } from '@src/interface/index.js'
import { CooldownError, type ExecutionContext } from '@src/common/index.js'
import { createMockInteraction, MeoCordTestingModule } from '@src/testing/index.js'

// One instance of each stage serves every call, so two calls in flight at once must each see their own params.

const log: string[] = []

/** A promise the test settles by hand, to hold a handler mid-call. */
function gate() {
  let open!: () => void
  const opened = new Promise<void>(resolve => (open = resolve))
  return { opened, open }
}
const gates: Record<string, ReturnType<typeof gate>> = {}

const tagOf = (context: ExecutionContext) => (context.getParams() as { tag: string }).tag

@Interceptor()
class Tagger implements InterceptorInterface {
  async intercept(context: ExecutionContext, next: CallHandler) {
    log.push(`${tagOf(context)} before`)
    const result = await next.handle()
    log.push(`${tagOf(context)} after`)
    return result
  }
}

@Pipe()
class Prefix implements PipeInterface<string, string> {
  transform(value: string, context: ExecutionContext): string {
    return `${tagOf(context)}-${value}`
  }
}

@Catch()
class Reporter implements ExceptionFilter {
  catch(error: unknown, context: ExecutionContext) {
    log.push(`${tagOf(context)} caught ${(error as Error).message}`)
  }
}

@Controller()
class SharedController {
  @Command('a/{id}', CommandType.BUTTON)
  @UseInterceptor({ provide: Tagger, params: { tag: 'a' } })
  @UseFilter({ provide: Reporter, params: { tag: 'a' } })
  @UsePipe('id', { provide: Prefix, params: { tag: 'a' } })
  async a(_interaction: ButtonInteraction, { id }: { id: string }) {
    await gates.a.opened
    log.push(`a ran with ${id}`)
    throw new Error('a failed')
  }

  @Command('b/{id}', CommandType.BUTTON)
  @UseInterceptor({ provide: Tagger, params: { tag: 'b' } })
  @UseFilter({ provide: Reporter, params: { tag: 'b' } })
  @UsePipe('id', { provide: Prefix, params: { tag: 'b' } })
  async b(_interaction: ButtonInteraction, { id }: { id: string }) {
    await gates.b.opened
    log.push(`b ran with ${id}`)
    throw new Error('b failed')
  }
}

describe('stages shared across calls', () => {
  beforeEach(() => {
    log.length = 0
    gates.a = gate()
    gates.b = gate()
  })

  it('give each of two overlapping calls its own params, in the interceptor, the pipe and the filter', async () => {
    const module = MeoCordTestingModule.create({ controllers: [SharedController] }).compile()
    const button = (customId: string) => createMockInteraction(ButtonInteraction, { customId })

    // a starts first and finishes last, so b runs entirely inside a's call.
    const first = module.invoke(SharedController, 'a', button('a/1'))
    await new Promise(resolve => setImmediate(resolve))
    const second = module.invoke(SharedController, 'b', button('b/2'))
    await new Promise(resolve => setImmediate(resolve))
    gates.b.open()
    await second
    gates.a.open()
    await first

    expect(log).toEqual([
      'a before',
      'b before',
      'b ran with b-2',
      'b caught b failed',
      'a ran with a-1',
      'a caught a failed',
    ])
  })

  it('let only one of two overlapping calls take the last use of a cooldown', async () => {
    @Controller()
    class DailyController {
      @Command('daily', CommandType.BUTTON)
      @Cooldown({ seconds: 60, bypass: async () => false })
      async daily(_interaction: ButtonInteraction) {}
    }
    const module = MeoCordTestingModule.create({ controllers: [DailyController] }).compile()
    const click = () => createMockInteraction(ButtonInteraction, { customId: 'daily', user: { id: 'same-user' } as never })

    const outcomes = await Promise.allSettled([module.invoke(DailyController, 'daily', click()), module.invoke(DailyController, 'daily', click())])

    expect(outcomes.filter(outcome => outcome.status === 'fulfilled' && outcome.value.ran)).toHaveLength(1)
    expect(outcomes.filter(outcome => outcome.status === 'rejected' && outcome.reason instanceof CooldownError)).toHaveLength(1)
  })
})
