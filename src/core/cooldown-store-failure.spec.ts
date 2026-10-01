import { ChatInputCommandInteraction, User } from 'discord.js'
import { vi } from 'vitest'
import {
  type CooldownBatchVerdict,
  type CooldownEntry,
  type CooldownLimit,
  CooldownStore,
  CooldownStoreError,
  type CooldownVerdict,
  type ExecutionContext,
  Logger,
  MemoryCooldownStore,
} from '@src/common/index.js'
import { Command, Controller, Cooldown, MeoCord, Observer } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { type DispatchObserver, type DispatchResult } from '@src/interface/index.js'
import { createMockInteraction, MeoCordTestingModule } from '@src/testing/index.js'

const outcomes: DispatchResult[] = []

@Observer()
class Outcomes implements DispatchObserver {
  onSettled(_context: ExecutionContext, result: DispatchResult) {
    outcomes.push(result)
  }
}

@Controller()
class DailyController {
  runs = 0

  @Command('daily', CommandType.SLASH)
  @Cooldown({ seconds: 3 })
  @Cooldown({ seconds: 60, uses: 5 })
  daily(_interaction: ChatInputCommandInteraction) {
    this.runs++
  }
}

/** A store whose every call fails, until `recover()`; then it counts in memory. */
class FlakyStore extends CooldownStore {
  failing = true
  readonly memory = new MemoryCooldownStore()

  constructor(private readonly how: 'reject' | 'hang') {
    super()
  }

  consume(key: string, limit: CooldownLimit): Promise<CooldownVerdict> {
    return this.consumeMany([{ key, limit }])
  }

  consumeMany(entries: readonly CooldownEntry[]): Promise<CooldownBatchVerdict> {
    if (!this.failing) return this.memory.consumeMany(entries)
    return this.how === 'reject' ? Promise.reject(new Error('ECONNREFUSED 127.0.0.1:6379')) : new Promise(() => undefined)
  }
}

function moduleWith(store: CooldownStore, policy: { cooldownStoreFailure?: 'deny' | 'allow'; cooldownStoreTimeoutMs?: number }) {
  @MeoCord({ controllers: [DailyController], clientOptions: { intents: [] }, observers: [Outcomes], ...policy })
  class App {}

  return MeoCordTestingModule.create({
    app: App,
    controllers: [DailyController],
    providers: [{ provide: CooldownStore, useValue: store }],
  }).compile()
}

const call = (userId = '1') =>
  createMockInteraction(ChatInputCommandInteraction, { commandName: 'daily', user: createMockInteraction(User, { id: userId }) })

let logs: { error: ReturnType<typeof vi.spyOn>; warn: ReturnType<typeof vi.spyOn>; log: ReturnType<typeof vi.spyOn> }

beforeEach(() => {
  outcomes.length = 0
  logs = {
    error: vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined),
    warn: vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined),
    log: vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined),
  }
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

const said = (spy: ReturnType<typeof vi.spyOn>, text: string) => spy.mock.calls.filter(([message]) => String(message).includes(text))

describe("cooldownStoreFailure: 'deny', the default", () => {
  it('refuses the call with CooldownStoreError when the store rejects, and logs it once for the outage', async () => {
    const store = new FlakyStore('reject')
    const module = moduleWith(store, {})

    for (const userId of ['1', '2', '3']) {
      const refused = module.invoke(DailyController, 'daily', call(userId))
      await expect(refused).rejects.toBeInstanceOf(CooldownStoreError)
    }

    expect(module.get(DailyController).runs).toBe(0)
    expect(said(logs.error, 'The cooldown store FlakyStore failed: ECONNREFUSED')).toHaveLength(1)
    expect(said(logs.error, 'refused until it answers again')).toHaveLength(1)
  })

  it('logs once when the store answers again, 30 seconds after its last failure, with how many calls failed', async () => {
    vi.useFakeTimers({ now: 0, toFake: ['Date'] })
    const store = new FlakyStore('reject')
    const module = moduleWith(store, {})
    await expect(module.invoke(DailyController, 'daily', call('1'))).rejects.toThrow()
    await expect(module.invoke(DailyController, 'daily', call('2'))).rejects.toThrow()

    store.failing = false
    await module.invoke(DailyController, 'daily', call('3'))
    expect(said(logs.log, 'answers again')).toHaveLength(0)
    vi.setSystemTime(30_000)
    await module.invoke(DailyController, 'daily', call('4'))
    await module.invoke(DailyController, 'daily', call('5'))

    expect(module.get(DailyController).runs).toBe(3)
    expect(said(logs.log, 'The cooldown store FlakyStore answers again, after 2 failed call(s)')).toHaveLength(1)
  })

  // As in a Redis Cluster with one master down: the keys in its slots fail, and the rest are counted
  it('logs a partial outage once, however its failures and answers interleave', async () => {
    vi.useFakeTimers({ now: 0, toFake: ['Date'] })
    const store = new FlakyStore('reject')
    const module = moduleWith(store, {})

    for (let round = 0; round < 5; round++) {
      vi.setSystemTime(round * 1_000)
      store.failing = true
      await expect(module.invoke(DailyController, 'daily', call(`failing-${round}`))).rejects.toThrow()
      store.failing = false
      await module.invoke(DailyController, 'daily', call(`answered-${round}`))
    }
    vi.setSystemTime(34_000)
    await module.invoke(DailyController, 'daily', call('after'))

    expect(said(logs.error, 'The cooldown store FlakyStore failed')).toHaveLength(1)
    expect(said(logs.log, 'answers again')).toEqual([[expect.stringContaining('answers again, after 5 failed call(s) over 4s')]])
  })

  it('refuses a call the store does not answer within cooldownStoreTimeoutMs', async () => {
    const module = moduleWith(new FlakyStore('hang'), { cooldownStoreTimeoutMs: 30 })

    const error = await module.invoke(DailyController, 'daily', call()).catch((failure: unknown) => failure)

    expect(error).toBeInstanceOf(CooldownStoreError)
    expect((error as CooldownStoreError).timedOut).toBe(true)
    expect(said(logs.error, 'did not answer within 30 ms')).toHaveLength(1)
  })

  it("tells observers 'error', with the CooldownStoreError", async () => {
    const module = moduleWith(new FlakyStore('reject'), {})
    await expect(module.invoke(DailyController, 'daily', call())).rejects.toThrow()

    expect(outcomes).toEqual([expect.objectContaining({ outcome: 'error', error: expect.any(CooldownStoreError) })])
  })
})

describe("cooldownStoreFailure: 'allow'", () => {
  it('runs the call uncounted, warning once for the outage and once when the store answers again', async () => {
    const store = new FlakyStore('reject')
    const module = moduleWith(store, { cooldownStoreFailure: 'allow' })

    vi.useFakeTimers({ now: 0, toFake: ['Date'] })
    await module.invoke(DailyController, 'daily', call())
    await module.invoke(DailyController, 'daily', call())
    store.failing = false
    vi.setSystemTime(30_000)
    await module.invoke(DailyController, 'daily', call())

    expect(module.get(DailyController).runs).toBe(3)
    expect(said(logs.warn, 'Calls run uncounted until it answers again')).toHaveLength(1)
    expect(said(logs.log, 'answers again, after 2 failed call(s)')).toHaveLength(1)
    // Uncounted: the first counted call, just now, is the only one in the store
    await expect(module.invoke(DailyController, 'daily', call())).rejects.toThrow('Slow down')
    expect(outcomes.map(({ outcome }) => outcome)).toEqual(['ran', 'ran', 'ran', 'cooldown'])
  })

  it('runs a call the store does not answer in time', async () => {
    const module = moduleWith(new FlakyStore('hang'), { cooldownStoreFailure: 'allow', cooldownStoreTimeoutMs: 30 })

    await expect(module.invoke(DailyController, 'daily', call())).resolves.toEqual({ ran: true })
  })
})

describe('a store that answers after the timeout', () => {
  it('counts the call once, in the store, and MeoCord not at all', async () => {
    const memory = new MemoryCooldownStore()
    const late = new (class extends CooldownStore {
      consume(key: string, limit: CooldownLimit) {
        return memory.consume(key, limit)
      }
      async consumeMany(entries: readonly CooldownEntry[]) {
        await new Promise(resolve => setTimeout(resolve, 60))
        return memory.consumeMany(entries)
      }
    })()
    const module = moduleWith(late, { cooldownStoreFailure: 'allow', cooldownStoreTimeoutMs: 20 })

    await module.invoke(DailyController, 'daily', call())
    await new Promise(resolve => setTimeout(resolve, 80))

    // The late answer recorded the call exactly once: a limit of one refuses, and a limit of two allows one more
    const key = 'DailyController.daily#5/60000:user:user:1'
    expect((await memory.consumeMany([{ key, limit: { uses: 1, windowMs: 60_000 } }])).allowed).toBe(false)
    expect((await memory.consumeMany([{ key, limit: { uses: 2, windowMs: 60_000 } }])).allowed).toBe(true)
    expect(module.get(DailyController).runs).toBe(1)
  })
})

describe('a store given as a value with only consume()', () => {
  it('is counted through consume(), one cooldown after another', async () => {
    const memory = new MemoryCooldownStore()
    const consume = vi.fn((key: string, limit: CooldownLimit) => memory.consume(key, limit))
    const module = moduleWith({ consume } as unknown as CooldownStore, {})

    await module.invoke(DailyController, 'daily', call())

    expect(consume.mock.calls.map(([key]) => key)).toEqual(['DailyController.daily#1/3000:user:user:1', 'DailyController.daily#5/60000:user:user:1'])
  })
})

describe('@MeoCord({ cooldownStoreFailure, cooldownStoreTimeoutMs })', () => {
  it.each([
    [{ cooldownStoreFailure: 'retry' }, "App: @MeoCord({ cooldownStoreFailure }) must be 'deny' or 'allow' (got \"retry\")"],
    [{ cooldownStoreTimeoutMs: 0 }, 'App: @MeoCord({ cooldownStoreTimeoutMs }) must be a number of milliseconds above 0, at most 2147483647 (got 0)'],
    [{ cooldownStoreTimeoutMs: '1s' }, 'must be a number of milliseconds above 0, at most 2147483647 (got "1s")'],
    // The longest delay a timer keeps; a longer one fires at once, so every call would time out
    [{ cooldownStoreTimeoutMs: 3_000_000_000 }, 'must be a number of milliseconds above 0, at most 2147483647 (got 3000000000)'],
    [{ cooldownStoreTimeoutMs: Infinity }, 'must be a number of milliseconds above 0, at most 2147483647 (got Infinity)'],
    [{ cooldownStoreTimeoutMs: Number.NaN }, 'must be a number of milliseconds above 0, at most 2147483647 (got NaN)'],
  ])('refuses %o where the app is declared', (options, message) => {
    const declare = () => {
      @MeoCord({ controllers: [], clientOptions: { intents: [] }, ...(options as object) })
      class App {}
      return App
    }

    expect(declare).toThrow(message)
  })
})
