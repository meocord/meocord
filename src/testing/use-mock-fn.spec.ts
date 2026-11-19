import 'reflect-metadata'
import { types } from 'node:util'
import { vi, type Mock as VitestMock } from 'vitest'
import { ButtonInteraction } from 'discord.js'
import {
  clearAllMocks,
  createMockFn,
  forgetMockFn,
  resetAllMocks,
  useMockFn,
  type MockFnFactory,
} from '@src/testing/mock-fn.js'
import { createMock, createMockInteraction } from '@src/testing/mock-interaction.js'
import { createDiscordError, getResponse } from '@src/testing/response.js'
import { collectGarbage, countGrowth, PILE_UP_BOUND } from '@src/spec-collection.js'

// As jest's and bun's mocks do, a reset drops the implementation the mock was created with
const droppingOnReset = (impl?: (...args: any[]) => any) => {
  const fn = vi.fn(impl)
  const reset = fn.mockReset.bind(fn)
  fn.mockReset = () => reset().mockImplementation(() => undefined)
  return fn
}

beforeEach(() => forgetMockFn())
afterAll(() => forgetMockFn())

describe('useMockFn', () => {
  it("makes every mock with the runner's function, which the runner then treats as its own", async () => {
    useMockFn(vi.fn)
    const interaction = createMockInteraction(ButtonInteraction)
    await interaction.reply({ content: 'hi' })

    expect(vi.isMockFunction(createMockFn())).toBe(true)
    expect(vi.isMockFunction(interaction.reply)).toBe(true)
    expect(typeof (interaction.reply as unknown as VitestMock).withImplementation).toBe('function')
    vi.clearAllMocks()
    expect(interaction.reply.mock.calls).toEqual([])
  })

  it("hands the runner meocord's behaviour as each mock's own", async () => {
    useMockFn(vi.fn)
    const interaction = createMockInteraction(ButtonInteraction)

    expect(interaction.isButton()).toBe(true)
    await interaction.reply({ content: 'hi' })
    await expect(interaction.reply({ content: 'again' })).rejects.toThrow('already been sent')
  })

  it("keeps getResponse's record of every answer, as the runner's plain mock, whatever behaviour a test sets", async () => {
    useMockFn(vi.fn)
    const interaction = createMockInteraction(ButtonInteraction)
    const refused = createDiscordError(10062)
    vi.mocked(interaction.update).mockRejectedValueOnce(refused)

    await expect(interaction.update({ content: 'late' })).rejects.toBe(refused)
    await interaction.update({ content: 'on time' })

    // A runner's matchers, bun's among them, read only its own function, never a wrapper around it
    expect(types.isProxy(interaction.update)).toBe(false)
    expect(getResponse(interaction).calls).toEqual([
      expect.objectContaining({ method: 'update', payload: { content: 'late' }, error: refused }),
      expect.objectContaining({ method: 'update', payload: { content: 'on time' } }),
    ])
  })

  it("makes a mocked interface's members the runner's plain mocks, nested ones included", async () => {
    useMockFn(vi.fn)
    const cache = createMock<{ store: { flush(key: string): Promise<void> } }>()

    await cache.store.flush('guilds')

    for (const member of [cache.store, cache.store.flush]) {
      expect([vi.isMockFunction(member), types.isProxy(member)]).toEqual([true, false])
    }
    expect(cache.store.flush).toHaveBeenCalledWith('guilds')
    expect(await cache.store.flush('guilds')).toBeUndefined()
  })

  it('reaches those mocks with clearAllMocks and resetAllMocks, which keep their behaviour where the runner drops it', async () => {
    useMockFn(droppingOnReset)
    const double = createMockFn((x: number) => x * 2).mockReturnValue(99)
    const interaction = createMockInteraction(ButtonInteraction)
    double(1)

    clearAllMocks()
    expect(double.mock.calls).toEqual([])
    expect(double(1)).toBe(99)

    resetAllMocks()
    expect(double(1)).toBe(2)
    expect(interaction.isButton()).toBe(true)
    await interaction.reply({ content: 'hi' })
    expect(interaction.reply.mock.calls).toEqual([[{ content: 'hi' }]])
    expect(getResponse(interaction).calls).toEqual([expect.objectContaining({ method: 'reply', payload: { content: 'hi' } })])
  })

  it('takes the same function again, as a setup file run once per test file gives it', () => {
    useMockFn(vi.fn)
    createMockFn()

    expect(() => useMockFn(vi.fn)).not.toThrow()
  })

  it('refuses another function once a mock exists, which would mix the two kinds', () => {
    createMockFn()

    expect(() => useMockFn(vi.fn)).toThrow(/before any mock is made.*setup file/)
  })

  it('refuses a function after a mock made before it was collected', async () => {
    const dropped = makeAndDrop()
    await collectGarbage()

    expect(dropped.map(mock => mock.deref())).toEqual(dropped.map(() => undefined))
    expect(attempt(vi.fn)).toBe('refuses')
  })

  it("refuses another function after the runner's mocks were made and collected", async () => {
    useMockFn(plainRunnerFn)
    const dropped = makeAndDrop()
    await collectGarbage()

    expect(dropped.map(mock => mock.deref())).toEqual(dropped.map(() => undefined))
    expect(attempt(vi.fn)).toBe('refuses')
  })

  it('refuses after thousands of mocks made in one loop, keeping no pile of them alive', () => {
    const grown = countGrowth(Held)
    makeThousands()

    expect(grown()).toBeLessThanOrEqual(PILE_UP_BOUND)
    expect(attempt(vi.fn)).toBe('refuses')
  })

  it('takes a function after forgetMockFn, though a mock made before it is still kept', () => {
    const kept = createMockFn()
    forgetMockFn()

    expect(attempt(vi.fn)).toBe('takes')
    void kept
  })

  it('refuses a function after forgetMockFn once a mock is made after it', () => {
    makeAndDrop()
    forgetMockFn()
    createMockFn()

    expect(attempt(vi.fn)).toBe('refuses')
  })

  it('keeps every clear and reset made before forgetMockFn on a mock made before it', () => {
    const cleared = createMockFn((x: number) => x)
    cleared(1)
    clearAllMocks()
    const reset = createMockFn((x: number) => x).mockReturnValue(5)
    resetAllMocks()
    forgetMockFn()

    expect([cleared.mock.calls, reset(2)]).toEqual([[], 2])
  })

  it('leaves a mock made before forgetMockFn out of clearAllMocks and resetAllMocks, as a spec starting afresh expects', () => {
    const earlier = createMockFn((x: number) => x + 1).mockReturnValue(9)
    earlier(1)
    forgetMockFn()

    resetAllMocks()

    expect(earlier.mock.calls).toEqual([[1]])
    expect(earlier(1)).toBe(9)
  })

  it("refuses a function whose mocks lack jest's and Vitest's API, such as node:test's mock.fn", () => {
    expect(() => useMockFn((() => () => undefined) as never)).toThrow(/node:test.*meocord's own/)
  })

  it("refuses node:test's mock.fn, as the docs write it, with that message and node's own error as its cause", async () => {
    const { mock } = await import('node:test')

    let refusal: unknown
    try {
      useMockFn(mock.fn as never)
    } catch (error) {
      refusal = error
    }
    expect(refusal).toBeInstanceOf(Error)
    expect((refusal as Error).message).toMatch(/node:test.*meocord's own/)
    expect((refusal as Error).cause).toBeInstanceOf(TypeError)
  })

  it("lets a mocked interface's methods run without an implementation under a runner that reads _protoImpl, as jest's does", () => {
    // jest's mock runs `_protoImpl` when it finds one, reading it from the mock itself, so through its prototype chain
    const readingProtoImpl = (impl?: (...args: any[]) => any) => {
      const fn: any = vi.fn(function (this: unknown, ...args: unknown[]) {
        return fn._protoImpl ? fn._protoImpl.apply(this, args) : impl?.apply(this, args)
      })
      return fn
    }
    useMockFn(readingProtoImpl)
    const store = createMock<{ save(key: string): unknown; _save(key: string): unknown; cache: { flush(): void } }>()

    expect(store.save('k')).toBeUndefined()
    store.cache.flush()
    expect(store.cache.flush).toHaveBeenCalled()
    // Any other name, an underscore first included, is a nested mock as before
    store._save.mockReturnValue(1)
    expect(store._save('k')).toBe(1)
  })
})

// Mocks a spec makes together, each checked on its own, so one kept alive among them shows
const MOCKS_AT_ONCE = 10
// As many mocks as a test making mock interactions in a loop makes
const THOUSANDS = 5000

class Held {}

/** A runner's factory that no runner holds the mocks of, so they can be collected. */
const plainRunnerFn = (impl?: (...args: any[]) => any) => {
  const fn = (...args: any[]) => impl?.(...args)
  return Object.assign(fn, { _isMockFunction: true, mock: { calls: [] }, mockImplementation: () => fn, mockClear: () => fn, mockReset: () => fn })
}

/** Whether useMockFn takes `factory` or refuses it as coming after a mock. */
function attempt(factory: MockFnFactory): 'takes' | 'refuses' {
  try {
    useMockFn(factory)
    return 'takes'
  } catch (error) {
    if ((error as Error).message.startsWith('useMockFn() goes before any mock is made')) return 'refuses'
    throw error
  }
}

/**
 * Makes thousands of mocks, each holding a value, in a frame of its own. None is called: while V8 optimizes a hot call
 * site it holds the function the site last reached, which would keep that mock.
 */
function makeThousands(): void {
  for (let i = 0; i < THOUSANDS; i++) {
    const held = new Held()
    createMockFn(() => held)
  }
}

/**
 * Makes MOCKS_AT_ONCE mocks in a frame of its own and returns only weak references to them, so a test can check
 * they were collected. None is called, as in makeThousands.
 */
function makeAndDrop(): WeakRef<object>[] {
  return Array.from({ length: MOCKS_AT_ONCE }, (_, i) => new WeakRef(createMockFn(() => i)))
}
