import 'reflect-metadata'
import { types } from 'node:util'
import { vi, type Mock as VitestMock } from 'vitest'
import { ButtonInteraction } from 'discord.js'
import { clearAllMocks, createMockFn, forgetMockFn, resetAllMocks, useMockFn } from './mock-fn.js'
import { createMock, createMockInteraction } from './mock-interaction.js'
import { createDiscordError, getResponse } from './response.js'

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
