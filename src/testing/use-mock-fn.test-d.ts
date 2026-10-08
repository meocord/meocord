import { describe, expectTypeOf, it, vi } from 'vitest'
import { type MockFnFactory, useMockFn } from './mock-fn.js'

describe('useMockFn', () => {
  it("takes Vitest's vi.fn", () => {
    useMockFn(vi.fn)
    expectTypeOf(vi.fn).toExtend<MockFnFactory>()
  })

  it('refuses a factory whose functions are not mocks', () => {
    // @ts-expect-error a plain function has no mock.calls, mockImplementation, mockClear or mockReset
    useMockFn(() => () => undefined)
  })
})
