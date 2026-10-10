import { vi } from 'vitest'
import { clearAllMocks, createMockFn, isMockFunction, resetAllMocks } from './mock-fn.js'
import { createMockClient, createMockInteraction } from './mock-interaction.js'
import { ButtonInteraction } from 'discord.js'

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
})
