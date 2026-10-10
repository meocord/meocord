import { describe, expect, it, jest } from '@jest/globals'
import { createMock, isMockFunction, useMockFn } from 'meocord/testing'
import { clickGreet } from './shared/module.js'

useMockFn(jest.fn)

describe('meocord/testing under jest', () => {
  it("dispatches a mock interaction, and jest's matchers read meocord's mocks", async () => {
    const text = jest.fn(() => 'from jest')
    const { click, outcome } = await clickGreet(text)

    expect(outcome.ran).toBe(true)
    expect(text).toHaveBeenCalled()
    expect(click.update).toHaveBeenCalledWith(expect.objectContaining({ content: 'from jest' }))
    expect(jest.isMockFunction(click.update) && isMockFunction(click.update)).toBe(true)
  })

  it("runs a mocked interface's methods with no implementation, nested ones and an underscored one included", () => {
    const store = createMock<{ save(key: string): unknown; _save(key: string): unknown; cache: { flush(): void } }>()

    expect(store.save('k')).toBeUndefined()
    store.cache.flush()
    expect(store.cache.flush).toHaveBeenCalled()
    store._save.mockReturnValue(1)
    expect(store._save('k')).toBe(1)
  })
})
