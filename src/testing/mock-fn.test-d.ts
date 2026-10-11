import { describe, it, expectTypeOf } from 'vitest'
import { clearAllMocks, createMockFn, resetAllMocks } from '@src/testing/index.js'

describe('clearAllMocks and resetAllMocks', () => {
  it('take nothing and return nothing, to be passed to afterEach as they are', () => {
    expectTypeOf(clearAllMocks).toEqualTypeOf<() => void>()
    expectTypeOf(resetAllMocks).toEqualTypeOf<() => void>()
  })
})

describe('a mock function', () => {
  // What MockedFunction's JSDoc says: the call is checked against the function, the mock API's values are not
  it('is called as the function it mocks, and its mock API takes and records any value', () => {
    const double = createMockFn((value: number) => value * 2)

    // @ts-expect-error a string is not what the function takes
    double('x')
    expectTypeOf(double.mockReturnValue).parameter(0).toBeAny()
    expectTypeOf(double.mockResolvedValue).parameter(0).toBeAny()
    expectTypeOf(double.mock.calls[0][0]).toBeAny()
    expectTypeOf(double.mock.results[0].value).toBeAny()
    double.mockImplementation((text: string) => text.length)
    // @ts-expect-error an implementation is a function
    double.mockImplementation(42)
  })
})
