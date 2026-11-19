import { vi } from 'vitest'
import { clearAllMocks, createMockFn, isMockFunction, type MockedFunction, resetAllMocks } from '@src/testing/mock-fn.js'
import { createMockClient, createMockInteraction } from '@src/testing/mock-interaction.js'
import { ButtonInteraction } from 'discord.js'
import { collectGarbage, countGrowth, PILE_UP_BOUND } from '@src/spec-collection.js'

/**
 * These assert parity with jest and vitest, which is the whole promise of this
 * module. Where a case also runs `vi.fn()`, vitest's behaviour is the expectation
 * rather than taken on trust: if vitest changed, that case would fail too.
 */
describe('createMockFn', () => {
  describe('persistent behaviour is last-wins, as in jest and vitest', () => {
    it('mockImplementation overrides an earlier mockReturnValue', () => {
      const reference = vi.fn()
      reference.mockReturnValue(1)
      reference.mockImplementation(() => 2)
      expect(reference()).toBe(2)

      const mock = createMockFn()
      mock.mockReturnValue(1)
      mock.mockImplementation(() => 2)
      expect(mock()).toBe(2)
    })

    it('mockReturnValue overrides an earlier mockImplementation', () => {
      const reference = vi.fn()
      reference.mockImplementation(() => 1)
      reference.mockReturnValue(2)
      expect(reference()).toBe(2)

      const mock = createMockFn()
      mock.mockImplementation(() => 1)
      mock.mockReturnValue(2)
      expect(mock()).toBe(2)
    })

    it('mockRejectedValue overrides an earlier mockResolvedValue', async () => {
      const reference = vi.fn()
      reference.mockResolvedValue('resolved')
      reference.mockRejectedValue(new Error('rejected'))
      await expect(reference()).rejects.toThrow('rejected')

      const mock = createMockFn()
      mock.mockResolvedValue('resolved')
      mock.mockRejectedValue(new Error('rejected'))
      await expect(mock()).rejects.toThrow('rejected')
    })

    it('mockResolvedValue overrides an earlier mockRejectedValue', async () => {
      const reference = vi.fn()
      reference.mockRejectedValue(new Error('rejected'))
      reference.mockResolvedValue('resolved')
      await expect(reference()).resolves.toBe('resolved')

      const mock = createMockFn()
      mock.mockRejectedValue(new Error('rejected'))
      mock.mockResolvedValue('resolved')
      await expect(mock()).resolves.toBe('resolved')
    })

    it('mockImplementation overrides an earlier mockResolvedValue', async () => {
      const reference = vi.fn()
      reference.mockResolvedValue('resolved')
      reference.mockImplementation(async () => 'from impl')
      await expect(reference()).resolves.toBe('from impl')

      const mock = createMockFn()
      mock.mockResolvedValue('resolved')
      mock.mockImplementation(async () => 'from impl')
      await expect(mock()).resolves.toBe('from impl')
    })

    it('overrides the implementation passed to the factory', () => {
      const mock = createMockFn(() => 'from factory')
      expect(mock()).toBe('from factory')

      mock.mockReturnValue('from mockReturnValue')
      expect(mock()).toBe('from mockReturnValue')
    })
  })

  describe('once-values share a single queue, consumed in call order', () => {
    it('interleaves mockReturnValueOnce and mockImplementationOnce in the order declared', () => {
      const reference = vi.fn()
      reference.mockReturnValueOnce(1).mockImplementationOnce(() => 2)
      expect([reference(), reference()]).toEqual([1, 2])

      const mock = createMockFn()
      mock.mockReturnValueOnce(1).mockImplementationOnce(() => 2)
      expect([mock(), mock()]).toEqual([1, 2])
    })

    it('interleaves mockImplementationOnce and mockReturnValueOnce in the order declared', () => {
      const reference = vi.fn()
      reference.mockImplementationOnce(() => 1).mockReturnValueOnce(2)
      expect([reference(), reference()]).toEqual([1, 2])

      const mock = createMockFn()
      mock.mockImplementationOnce(() => 1).mockReturnValueOnce(2)
      expect([mock(), mock()]).toEqual([1, 2])
    })

    it('interleaves resolved and rejected once-values in the order declared', async () => {
      const mock = createMockFn()
      mock.mockResolvedValueOnce('first').mockRejectedValueOnce(new Error('second'))

      await expect(mock()).resolves.toBe('first')
      await expect(mock()).rejects.toThrow('second')
    })

    it('falls back to the persistent behaviour once the queue is drained', () => {
      const reference = vi.fn()
      reference.mockReturnValue('persistent')
      reference.mockReturnValueOnce('once')
      expect([reference(), reference()]).toEqual(['once', 'persistent'])

      const mock = createMockFn()
      mock.mockReturnValue('persistent')
      mock.mockReturnValueOnce('once')
      expect([mock(), mock()]).toEqual(['once', 'persistent'])
    })

    it('returns undefined when the queue is drained and nothing persistent is set', () => {
      const mock = createMockFn()
      mock.mockReturnValueOnce('once')

      expect(mock()).toBe('once')
      expect(mock()).toBeUndefined()
    })
  })

  describe('reset semantics', () => {
    it('mockReset clears the persistent behaviour and the queue', () => {
      const mock = createMockFn()
      mock.mockReturnValue('persistent')
      mock.mockReturnValueOnce('once')

      mock.mockReset()

      expect(mock()).toBeUndefined()
    })

    it('mockClear keeps the behaviour and clears only the call record', () => {
      const mock = createMockFn()
      mock.mockReturnValue('kept')
      mock()

      mock.mockClear()

      expect(mock.mock.calls).toHaveLength(0)
      expect(mock()).toBe('kept')
    })
  })

  describe('recording', () => {
    it('records arguments and results in order', () => {
      const mock = createMockFn((n: number) => n * 2)

      mock(1)
      mock(2)

      expect(mock.mock.calls).toEqual([[1], [2]])
      expect(mock.mock.results.map(r => r.value)).toEqual([2, 4])
    })

    it('records a throw as a throw result and still propagates it', () => {
      const mock = createMockFn(() => {
        throw new Error('boom')
      })

      expect(() => mock()).toThrow('boom')
      expect(mock.mock.results[0].type).toBe('throw')
    })

    // jest and Vitest record a result as each call starts, so results[i] is calls[i]'s however calls nest
    it("records each call's result at the call's own index, a re-entrant call's included, as jest and Vitest do", () => {
      let seen: number | undefined
      const countdown: MockedFunction<(n: number) => number> = createMockFn((n: number): number => {
        seen ??= countdown.mock.results.length
        return n > 0 ? countdown(n - 1) + 10 : 0
      })

      countdown(2)

      expect(countdown.mock.results.map(result => result.value)).toEqual([20, 10, 0])
      expect(countdown).toHaveNthReturnedWith(1, 20)
      expect(seen).toBe(1)
    })

    it('reads a call still running as incomplete', () => {
      let during: unknown
      const fn: MockedFunction<() => string> = createMockFn(() => {
        during = { ...fn.mock.results[0] }
        return 'done'
      })

      fn()

      expect([during, fn.mock.results[0]]).toEqual([
        { type: 'incomplete', value: undefined },
        { type: 'return', value: 'done' },
      ])
    })

    it('is recognised as a mock by both isMockFunction implementations', () => {
      const mock = createMockFn()

      expect(isMockFunction(mock)).toBe(true)
      expect(vi.isMockFunction(mock)).toBe(true)
    })
  })

  describe("Vitest's matchers on settled calls and call order", () => {
    it('reads each call as it settles, a rejection apart from a resolution', async () => {
      const load = createMockFn(async (id: string) => {
        if (id === '') throw new Error('empty')
        return id.length
      })

      await load('abc')
      await load('de')
      await expect(load('')).rejects.toThrow('empty')

      expect(load).toHaveResolved()
      expect(load).toHaveResolvedTimes(2)
      expect(load).toHaveResolvedWith(3)
      expect(load).toHaveNthResolvedWith(2, 2)
      expect(load.mock.settledResults).toEqual([
        { type: 'fulfilled', value: 3 },
        { type: 'fulfilled', value: 2 },
        { type: 'rejected', value: new Error('empty') },
      ])
    })

    it('reads the last call as resolved once it settles, and a plain return as resolved at once', async () => {
      const double = createMockFn((n: number) => n * 2)
      double(2)
      expect(double).toHaveLastResolvedWith(4)

      let settle!: (value: string) => void
      const pending = createMockFn(() => new Promise<string>(resolve => (settle = resolve)))
      const call = pending()
      expect(pending.mock.settledResults).toEqual([{ type: 'incomplete', value: undefined }])
      settle('done')
      await call
      expect(pending).toHaveLastResolvedWith('done')
    })

    it('orders calls across mocks, as an interaction answered in steps shows', async () => {
      const interaction = createMockInteraction(ButtonInteraction, { customId: 'refresh' })

      await interaction.deferUpdate()
      await interaction.editReply('Done.')

      // vi.mocked only for the argument's type: Vitest types it as its own MockInstance
      expect(interaction.deferUpdate).toHaveBeenCalledBefore(vi.mocked(interaction.editReply))
      expect(interaction.editReply).toHaveBeenCalledAfter(vi.mocked(interaction.deferUpdate))
      await interaction.followUp('More.')
      expect(interaction.followUp).toHaveResolved()
    })

    it("records each call's this, and forgets the new records on mockClear and mockReset, out of the mock's keys", async () => {
      const fn = createMockFn(async () => 1)
      const receiver = { fn }

      await receiver.fn()
      expect(fn.mock.contexts).toEqual([receiver])
      expect(fn.mock.invocationCallOrder).toHaveLength(1)

      fn.mockClear()
      expect([fn.mock.settledResults, fn.mock.invocationCallOrder, fn.mock.contexts]).toEqual([[], [], []])
      await fn()
      fn.mockReset()
      expect([fn.mock.settledResults, fn.mock.invocationCallOrder, fn.mock.contexts]).toEqual([[], [], []])
      expect(Object.keys(fn.mock)).toEqual(['calls', 'results', 'instances', 'lastCall'])
    })
  })
})

describe('clearAllMocks and resetAllMocks', () => {
  it('clearAllMocks forgets every mock’s calls and keeps what each was told to do', () => {
    const first = createMockFn((x: number) => x + 1)
    const second = createMockFn().mockReturnValue('set')
    first(1)
    second()

    clearAllMocks()

    expect(first.mock.calls).toEqual([])
    expect(second.mock.calls).toEqual([])
    expect(second()).toBe('set')
  })

  it('resetAllMocks also puts each mock back to the implementation it was created with', () => {
    const fn = createMockFn((x: number) => x + 1).mockReturnValue(99)
    fn(1)

    resetAllMocks()

    expect(fn.mock.calls).toEqual([])
    expect(fn(1)).toBe(2)
  })

  it('reaches the mocks inside discord.js mocks, which keep their own behaviour', async () => {
    const client = createMockClient()
    client.users.fetch.mockRejectedValue(new Error('set by a test'))
    const interaction = createMockInteraction(ButtonInteraction)
    await interaction.reply({ content: 'hi' })

    resetAllMocks()

    await expect(client.users.fetch('1')).resolves.toBeDefined()
    expect(interaction.reply.mock.calls).toEqual([])
    // Only the recorded calls and set behaviour go: the interaction has still been replied to
    await expect(interaction.reply({ content: 'again' })).rejects.toThrow('already been sent')
  })

  it("keeps a mock interaction's type guards and server checks answering as discord.js does", () => {
    const inServer = createMockInteraction(ButtonInteraction, { guildId: '100000000000000001' })
    const inDm = createMockInteraction(ButtonInteraction)

    resetAllMocks()

    expect([inServer.isButton(), inServer.isChatInputCommand(), inServer.isRepliable()]).toEqual([true, false, true])
    expect([inServer.inGuild(), inServer.inCachedGuild(), inServer.inRawGuild()]).toEqual([true, false, true])
    expect([inDm.inGuild(), inDm.inRawGuild()]).toEqual([false, false])
  })

  it('leaves vi.fn mocks to vitest', () => {
    const native = vi.fn().mockReturnValue('kept')

    resetAllMocks()

    expect(native()).toBe('kept')
  })

  it('reaches a mock at its next use, whichever use it is, as if it had been cleared or reset at once', () => {
    for (const all of [clearAllMocks, resetAllMocks]) {
      for (const [name, use] of USES) {
        const fn = prepared()
        all()
        const now = observe(fn, use(fn))
        const reference = prepared()
        if (all === clearAllMocks) reference.mockClear()
        else reference.mockReset()
        expect(now, `${all.name}, then ${name}`).toEqual(observe(reference, use(reference)))
      }
    }
  })

  it('lets a matcher read a mock as cleared, without the mock being used first', () => {
    const fn = prepared()

    clearAllMocks()

    expect(fn).not.toHaveBeenCalled()
    expect(fn).toHaveBeenCalledTimes(0)
  })

  it('empties an array a test holds once the mock is next used, in place, as a mock clear does', () => {
    const fn = prepared()
    const calls = fn.mock.calls

    clearAllMocks()
    fn(7)

    expect(calls).toEqual([[7]])
    expect(calls).toBe(fn.mock.calls)
  })

  it('gives every mock the state a clear or reset at once would, over seeded runs of clears, resets, calls and settings', () => {
    let seed = 1009
    const next = (n: number) => {
      // mulberry32: the same runs on every machine
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return (((t ^ (t >>> 14)) >>> 0) % n)
    }
    for (let run = 0; run < 200; run++) {
      const own: MockedFunction<(x: number) => unknown>[] = []
      const reference: ReturnType<typeof vi.fn<(x: number) => unknown>>[] = []
      for (let step = 0; step < 16; step++) {
        const action = next(7)
        const target = next(Math.max(own.length, 1))
        if (action === 0 || own.length === 0) {
          own.push(createMockFn((x: number) => x + 1))
          reference.push(vi.fn((x: number) => x + 1))
        } else if (action === 1) {
          clearAllMocks()
          for (const fn of reference) fn.mockClear()
        } else if (action === 2) {
          resetAllMocks()
          for (const fn of reference) fn.mockReset()
        } else if (action === 3) {
          own[target]!.mockReturnValue(step)
          reference[target]!.mockReturnValue(step)
        } else if (action === 4) {
          own[target]!.mockReturnValueOnce(-step)
          reference[target]!.mockReturnValueOnce(-step)
        } else {
          expect(own[target]!(step)).toBe(reference[target]!(step))
        }
      }
      expect(own.map(fn => [fn.mock.calls, fn.mock.results, fn(0)])).toEqual(reference.map(fn => [fn.mock.calls, fn.mock.results, fn(0)]))
    }
  })

  it('reaches a mock made between two clears with the second only', () => {
    const early = prepared()
    clearAllMocks()
    const late = createMockFn((x: number) => x + 1)
    late(1)
    early(1)
    clearAllMocks()
    late(2)

    expect(early.mock.calls).toEqual([])
    expect(late.mock.calls).toEqual([[2]])
  })

  it('applies a reset between two clears, and a clear after a reset keeps the reset', () => {
    const fn = prepared()

    clearAllMocks()
    resetAllMocks()
    clearAllMocks()

    expect(fn.mock.calls).toEqual([])
    expect([fn(1), fn(1)]).toEqual([2, 2])
  })

  it('lets every mock a test let go of be collected once the test yields to the event loop', async () => {
    const dropped = Array.from({ length: MOCKS_CHECKED_EACH }, () => new WeakRef(useAndDrop()))
    await collectGarbage()

    expect(dropped.map(mock => mock.deref())).toEqual(dropped.map(() => undefined))
  })

  it('keeps no pile of mocks alive before the test yields to the event loop', () => {
    const grown = countGrowth(Held)
    for (let i = 0; i < MOCKS_IN_ONE_STRETCH; i++) useAndDrop()

    // queryObjects collects garbage first; a mock tracked through a WeakRef would stay until the job ends
    expect(grown()).toBeLessThanOrEqual(PILE_UP_BOUND)
  })

  it('lets every answered mock interaction be collected once the test yields to the event loop', async () => {
    const dropped: WeakRef<object>[] = []
    for (let i = 0; i < INTERACTIONS_CHECKED_EACH; i++) dropped.push(new WeakRef(await answerAndDrop(i)))
    await collectGarbage()

    expect(dropped.map(interaction => interaction.deref())).toEqual(dropped.map(() => undefined))
  })

  it('keeps no pile of answered mock interactions alive while a test awaits only promises', async () => {
    const grown = countGrowth(ButtonInteraction)
    for (let i = 0; i < INTERACTIONS_IN_ONE_STRETCH; i++) await answerAndDrop(i)

    // The bound separates growth with the count from a constant; it does not make 20 kept interactions acceptable
    expect(grown()).toBeLessThanOrEqual(PILE_UP_BOUND)
  })
})

// Every way a test can use a mock next: a call, a read of what it recorded, a setter, and the rest of its API
const USES: [string, (fn: MockedFunction<(x: number) => unknown>) => unknown][] = [
  ['a call', fn => fn(2)],
  ['mock.calls', fn => fn.mock.calls],
  ['mock.results', fn => fn.mock.results],
  ['mock.instances', fn => fn.mock.instances],
  ['mock.lastCall', fn => fn.mock.lastCall],
  ['mock.settledResults', fn => fn.mock.settledResults],
  ['mock.invocationCallOrder', fn => fn.mock.invocationCallOrder.length],
  ['mock.contexts', fn => fn.mock.contexts],
  ['mockReturnValue', fn => fn.mockReturnValue('value') === fn],
  ['mockReturnValueOnce', fn => fn.mockReturnValueOnce('once') === fn],
  ['mockResolvedValue', fn => fn.mockResolvedValue('resolved') === fn],
  ['mockResolvedValueOnce', fn => fn.mockResolvedValueOnce('resolved once') === fn],
  ['mockRejectedValue', fn => fn.mockRejectedValue('rejected') === fn],
  ['mockRejectedValueOnce', fn => fn.mockRejectedValueOnce('rejected once') === fn],
  ['mockImplementation', fn => fn.mockImplementation(x => x * 10) === fn],
  ['mockImplementationOnce', fn => fn.mockImplementationOnce(x => x * 100) === fn],
  ['mockClear', fn => fn.mockClear() === fn],
  ['mockReset', fn => fn.mockReset() === fn],
  ['mockRestore', fn => fn.mockRestore() === fn],
  ['getMockName', fn => fn.getMockName()],
  ['mockName', fn => fn.mockName('named') === fn],
]

/** A mock with a call recorded, a persistent and a once value set, and a name, for clearAllMocks and resetAllMocks to undo. */
function prepared(): MockedFunction<(x: number) => unknown> {
  const fn = createMockFn((x: number) => x + 1)
  fn(1)
  return fn.mockReturnValue('set').mockReturnValueOnce('set once').mockName('prepared')
}

/** What a test sees of a mock after a use: what the use gave, the records, the name, and the next two calls. */
function observe(fn: MockedFunction<(x: number) => unknown>, given: unknown) {
  // Copied before any other read, which would catch the mock up and change an array the use returned
  const state = { given: structuredClone(given) }
  const records = structuredClone([fn.mock.calls, fn.mock.results, fn.mock.instances, fn.mock.lastCall, fn.mock.contexts])
  Object.assign(state, { records, settled: fn.mock.settledResults.length, name: fn.getMockName() })
  const answers = [0, 1].map(() => {
    try {
      const value = fn(3)
      if (value instanceof Promise) value.catch(() => undefined)
      return value instanceof Promise ? 'a promise' : value
    } catch (error) {
      return error
    }
  })
  return { ...state, answers }
}

// Mocks and interactions checked for collection one by one, so one kept alive among them shows
const MOCKS_CHECKED_EACH = 100
const INTERACTIONS_CHECKED_EACH = 20
// Made before the test yields to the event loop: one kept per use reads all of them, 100 and 10 times the bound
const MOCKS_IN_ONE_STRETCH = 100 * PILE_UP_BOUND
const INTERACTIONS_IN_ONE_STRETCH = 10 * PILE_UP_BOUND

class Held {}

/**
 * Makes a mock holding a value, then calls, configures and reads it, in a frame of its own that ends after. Returns
 * the mock for a test that wraps it in a WeakRef; one that counts drops it at once.
 */
function useAndDrop(): object {
  const held = new Held()
  const fn = createMockFn(() => held)
  fn()
  fn.mockReturnValueOnce(held)
  void fn.mock.calls
  return fn
}

/** Makes a mock interaction and answers it, in a frame of its own that ends after, and returns it as useAndDrop does. */
async function answerAndDrop(i: number): Promise<object> {
  const interaction = createMockInteraction(ButtonInteraction, { customId: `b/${i}` })
  await interaction.reply({ content: 'Done.' })
  return interaction
}

