import { type Message } from 'discord.js'
import {
  Catch,
  Controller,
  Cooldown,
  Guard,
  Interceptor,
  MessageHandler,
  Observer,
  UseFilter,
  UseGuard,
  UseInterceptor,
  Validate,
} from '@src/decorator/index.js'
import { type ExecutionContext } from '@src/common/index.js'
import {
  type CallHandler,
  type DispatchObserver,
  type DispatchResult,
  type ExceptionFilter,
  type GuardInterface,
  type InterceptorInterface,
  type StandardSchemaV1,
} from '@src/interface/index.js'
import { type AdmittedCall, runHandler, type RunOptions } from '@src/core/handler-pipeline.js'
import { CooldownError, MemoryCooldownStore } from '@src/common/index.js'
import { createMockMessage, MeoCordTestingModule, type TestingModule } from '@src/testing/index.js'

const seen: unknown[] = []

class NotFound extends Error {}

@Guard()
class AllowUnlessDenied implements GuardInterface {
  canActivate(message: Message) {
    seen.push(['guard', message.content])
    return message.content !== 'deny'
  }
}

@Interceptor()
class Recorder implements InterceptorInterface {
  async intercept(context: ExecutionContext, next: CallHandler) {
    seen.push(['interceptor', context.getHandlerParams()])
    try {
      return await next.handle()
    } catch (error) {
      seen.push(['interceptor saw', (error as Error).message])
      throw error
    }
  }
}

@Catch(NotFound)
class NotFoundFilter implements ExceptionFilter<NotFound> {
  catch(error: NotFound) {
    seen.push(['filter', error.message])
  }
}

@Observer()
class Outcomes implements DispatchObserver {
  onSettled(_context: ExecutionContext, { outcome }: DispatchResult) {
    seen.push(['outcome', outcome])
  }
}

const amount: StandardSchemaV1<unknown, { amount: number }> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: value => ({ value: { amount: Number((value as { amount: string }).amount) } }),
  },
}

@Controller()
class Payments {
  @MessageHandler('pay {amount}')
  @UseGuard(AllowUnlessDenied)
  @UseInterceptor(Recorder)
  @UseFilter(NotFoundFilter)
  @Validate(amount)
  @Cooldown({ uses: 1, seconds: 60 })
  pay(_message: Message, params: { amount: number }) {
    seen.push(['handler', params])
  }
}

/** Runs `pay` as dispatch runs a message handler, with the parsed params and the given fetch. */
async function run(module: TestingModule, content: string, fetchArgs?: RunOptions['fetchArgs']) {
  await module.init()
  const message = createMockMessage({ content })
  Object.assign(message.author, { id: 'user-1' })
  return runHandler(Reflect.get(module, 'container'), module.get(Payments) as never, 'pay', [message, { amount: '5' }], {
    fetchArgs,
    awaitObservers: true,
  })
}

const compile = () => MeoCordTestingModule.create({ controllers: [Payments], observers: [Outcomes] }).compile()

beforeEach(() => {
  seen.length = 0
})

describe('fetchArgs', () => {
  it('runs after the guards admit the call, and every later stage and the handler see what it returns', async () => {
    const admitted: AdmittedCall[] = []

    const outcome = await run(compile(), 'pay', async ([message], call) => {
      seen.push(['fetch'])
      admitted.push(call)
      return [message, { amount: '7' }]
    })

    expect(outcome).toEqual({ ran: true })
    expect(admitted).toHaveLength(1)
    expect(seen).toEqual([
      ['guard', 'pay'],
      ['fetch'],
      ['interceptor', { amount: '7' }],
      ['handler', { amount: 7 }],
      ['outcome', 'ran'],
    ])
  })

  it('never runs for a call the guards deny', async () => {
    const fetchArgs = vi.fn(async (args: unknown[]) => args)

    const outcome = await run(compile(), 'deny', fetchArgs)

    expect(outcome).toEqual({ ran: false })
    expect(fetchArgs).not.toHaveBeenCalled()
    expect(seen).toEqual([
      ['guard', 'deny'],
      ['outcome', 'denied'],
    ])
  })

  it('fails the call with what it throws, and counts no cooldown', async () => {
    const module = compile()

    const failed = await run(module, 'pay', async () => {
      throw new NotFound('no such member')
    })
    seen.length = 0
    const next = await run(module, 'pay', async args => args)

    expect(failed).toEqual({ ran: false, error: expect.any(NotFound) })
    // The cooldown allows one use a minute: the failed fetch did not take it
    expect(next).toEqual({ ran: true })
    expect(seen).toEqual([
      ['guard', 'pay'],
      ['interceptor', { amount: '5' }],
      ['handler', { amount: 5 }],
      ['outcome', 'ran'],
    ])
  })

  it('reports a call that fails in it as an error, its filter having handled it', async () => {
    await run(compile(), 'pay', async () => {
      throw new NotFound('no such member')
    })

    expect(seen).toEqual([
      ['guard', 'pay'],
      ['filter', 'no such member'],
      ['outcome', 'error'],
    ])
  })
})

@Controller()
class Shop {
  @MessageHandler('buy {item}')
  @Cooldown({ uses: 1, seconds: 60 })
  buy() {
    seen.push(['buy'])
  }

  @MessageHandler('trade {item}')
  @Cooldown({ uses: 2, seconds: 60 })
  trade() {
    seen.push(['trade'])
  }

  @MessageHandler('gift {to}')
  @Cooldown({ uses: 1, seconds: 60, by: (_context, { to }: { to: string }) => to })
  gift() {
    seen.push(['gift'])
  }
}

/** Runs a Shop handler for one user, fetching through `fetchArgs` when given. */
async function shop(module: TestingModule, method: 'buy' | 'trade' | 'gift', params: object, fetchArgs?: RunOptions['fetchArgs']) {
  await module.init()
  const message = createMockMessage({ content: method })
  Object.assign(message.author, { id: 'user-1' })
  return runHandler(Reflect.get(module, 'container'), module.get(Shop) as never, method, [message, params], {
    fetchArgs,
    awaitObservers: true,
    fallback: async () => {},
  })
}

/** A fetch that checks the cooldowns first, as one naming members to fetch does. */
const checkingFetch: RunOptions['fetchArgs'] = async (args, admitted) => {
  await admitted.checkCooldowns()
  seen.push(['fetched'])
  return args
}

describe('admitted.checkCooldowns', () => {
  const compileShop = () => MeoCordTestingModule.create({ controllers: [Shop], observers: [Outcomes] }).compile()

  afterEach(() => vi.restoreAllMocks())

  it('refuses a call its cooldown refuses before anything is fetched, with the error counting it would give', async () => {
    const module = compileShop()

    await shop(module, 'buy', { item: 'sword' })
    seen.length = 0
    const checked = await shop(module, 'buy', { item: 'sword' }, checkingFetch)
    const counted = await shop(module, 'buy', { item: 'sword' })

    expect(checked).toEqual({ ran: false, error: expect.any(CooldownError) })
    expect(counted).toEqual({ ran: false, error: expect.any(CooldownError) })
    const [peek, consume] = [checked.error, counted.error] as CooldownError[]
    expect({ per: peek.per, message: peek.message }).toEqual({ per: consume.per, message: consume.message })
    expect(Math.abs(peek.retryAfterMs - consume.retryAfterMs)).toBeLessThan(1_000)
    // Refused before the fetch, and reported as a cooldown
    expect(seen).toEqual([
      ['outcome', 'cooldown'],
      ['outcome', 'cooldown'],
    ])
  })

  it('counts nothing: a call that checks and then runs uses one use, not two', async () => {
    const module = compileShop()

    await shop(module, 'trade', { item: 'gem' })
    const second = await shop(module, 'trade', { item: 'gem' }, checkingFetch)
    const third = await shop(module, 'trade', { item: 'gem' })

    // Two uses a minute: the checked call took the second, and the third is refused
    expect(second).toEqual({ ran: true })
    expect(third).toEqual({ ran: false, error: expect.any(CooldownError) })
  })

  it('leaves a cooldown with `by` to counting, since its key comes from params not yet validated', async () => {
    const module = compileShop()
    const peekMany = vi.spyOn(MemoryCooldownStore.prototype, 'peekMany')

    await shop(module, 'gift', { to: 'ann' })
    seen.length = 0
    const again = await shop(module, 'gift', { to: 'ann' }, checkingFetch)

    expect(peekMany).not.toHaveBeenCalled()
    // Fetched, then refused where the call is counted
    expect(again).toEqual({ ran: false, error: expect.any(CooldownError) })
    expect(seen).toEqual([['fetched'], ['outcome', 'cooldown']])
  })
})
