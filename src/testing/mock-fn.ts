// Framework-agnostic mock function, so `meocord/testing` depends on neither jest nor vitest.
// Both detect it through `_isMockFunction` and read `fn.mock.calls` in their assertions.

// Each call signature of `T`, up to four, as a union: `Parameters` and `ReturnType` read only an overloaded function's
// last signature, such as the list form of a manager's `fetch`
type Overloads<T> = T extends {
  (...args: infer A1): infer R1
  (...args: infer A2): infer R2
  (...args: infer A3): infer R3
  (...args: infer A4): infer R4
}
  ? ((...args: A1) => R1) | ((...args: A2) => R2) | ((...args: A3) => R3) | ((...args: A4) => R4)
  : T
type CallArgs<T> = Parameters<Overloads<T> & ((...args: any[]) => any)>
type CallResult<T> = ReturnType<Overloads<T> & ((...args: any[]) => any)>
// A function for any of `T`'s signatures; declared as a method so a narrower parameter, one overload's, is accepted
type Implementation<T> = { fn(...args: CallArgs<T>): CallResult<T> }['fn']

/**
 * One call's outcome, as a mock function records it: the value it returned, or the error it threw.
 *
 * @group Testing
 * @category Mocks
 * @see {@link MockState}
 */
export interface MockResult<T = unknown> {
  /** `'return'` when the call returned, `'throw'` when it threw. */
  type: 'return' | 'throw'
  /** What the call returned, or the error it threw. */
  value: T
}

/**
 * What a mock function has recorded: each call's arguments, outcome and `this`, in order.
 *
 * Read it as `fn.mock`. Jest's and Vitest's `toHaveBeenCalledWith` and the rest read it too.
 *
 * @group Testing
 * @category Mocks
 * @see {@link MockInstance}
 */
export interface MockState<T extends (...args: any[]) => any = (...args: any[]) => any> {
  /** Arguments from each call, in order. */
  readonly calls: CallArgs<T>[]
  /** Return / throw result from each call, in order. */
  readonly results: MockResult<CallResult<T>>[]
  /** The `this` value recorded for each call. */
  readonly instances: any[]
  /** Arguments from the most recent call, or undefined if never called. */
  readonly lastCall?: CallArgs<T>
}

/**
 * The mock API of a mock function: what it has recorded, and the methods that change what it does.
 *
 * Every mock from `meocord/testing` has it, with the names jest and Vitest use, so a test written for either runner
 * reads the same.
 *
 * @group Testing
 * @category Mocks
 * @see {@link createMockFn}
 * @see {@link MockedFunction}
 */
export interface MockInstance<T extends (...args: any[]) => any = (...args: any[]) => any> {
  /** Marks the function as a mock for jest and Vitest, which check it through `isMockFunction`. */
  readonly _isMockFunction: true
  /** What the mock has recorded: its calls, their outcomes and their `this`. */
  readonly mock: MockState<T>
  /** Returns `value` from every call, until another implementation is set. */
  mockReturnValue(value: CallResult<T>): MockedFunction<T>
  /** Returns `value` from the next call only. */
  mockReturnValueOnce(value: CallResult<T>): MockedFunction<T>
  /** Resolves every call to `value`. */
  mockResolvedValue(value: Awaited<CallResult<T>>): MockedFunction<T>
  /** Resolves the next call only to `value`. */
  mockResolvedValueOnce(value: Awaited<CallResult<T>>): MockedFunction<T>
  /** Rejects every call with `value`. */
  mockRejectedValue(value: unknown): MockedFunction<T>
  /** Rejects the next call only with `value`. */
  mockRejectedValueOnce(value: unknown): MockedFunction<T>
  /** Runs `fn` for every call. */
  mockImplementation(fn: Implementation<T>): MockedFunction<T>
  /** Runs `fn` for the next call only; `*Once` implementations run in the order they were set. */
  mockImplementationOnce(fn: Implementation<T>): MockedFunction<T>
  /** Forgets the recorded calls, keeping the implementation. */
  mockClear(): MockedFunction<T>
  /** Forgets the recorded calls, and puts back the implementation the mock was created with. */
  mockReset(): MockedFunction<T>
  /** Does what `mockReset` does: a mock from `meocord/testing` replaces no original to restore. */
  mockRestore(): MockedFunction<T>
  /** The name the mock reports in an assertion's message. */
  getMockName(): string
  /** Sets the name the mock reports in an assertion's message. */
  mockName(name: string): MockedFunction<T>
}

/**
 * A mock function with the signature of `T`, and the mock API of {@link MockInstance}.
 *
 * It takes the place of jest's `MockedFunction<T>` and Vitest's `MockedFunction<T>`. The mock factories type each
 * method of a mock with it, so `interaction.reply.mockResolvedValue(...)` type-checks. For an overloaded method, such as
 * a manager's `fetch`, the mock API takes what any of its overloads takes or returns.
 *
 * @group Testing
 * @category Mocks
 * @see {@link createMockFn}
 * @see {@link DeepMocked}
 */
export type MockedFunction<T extends (...args: any[]) => any> = ((...args: Parameters<T>) => ReturnType<T>) &
  MockInstance<T>

/**
 * A mock function, as jest's `Mock` and Vitest's `Mock` name it: the same type as {@link MockedFunction}.
 *
 * @group Testing
 * @category Mocks
 */
export type Mock<T extends (...args: any[]) => any = (...args: any[]) => any> = MockedFunction<T>

/**
 * Tells whether a value is a mock function: one from `meocord/testing`, `jest.fn()` or `vi.fn()`.
 *
 * Use it in a helper that takes mocks and real functions alike, such as one that sets a default on every mock method.
 *
 * @param fn - The value to check.
 *
 * @example
 * ```ts
 * import { expect } from 'vitest'
 *
 * const interaction = createMockInteraction(ButtonInteraction, { customId: 'refresh' })
 * expect(isMockFunction(interaction.reply)).toBe(true)
 * expect(isMockFunction(() => undefined)).toBe(false)
 * ```
 *
 * @group Testing
 * @category Mocks
 * @see {@link createMockFn}
 */
export function isMockFunction(fn: unknown): fn is MockInstance {
  return (
    typeof fn === 'function' &&
    '_isMockFunction' in fn &&
    (fn as { _isMockFunction?: unknown })._isMockFunction === true
  )
}

// Every mock createMockFn made, held weakly so the mocks of a finished test can still be collected
const created = new Set<WeakRef<MockInstance>>()
const collected = new FinalizationRegistry<WeakRef<MockInstance>>(ref => created.delete(ref))

/**
 * Clears the calls every mock from `meocord/testing` has recorded, keeping what each was told to do.
 *
 * Vitest's `clearMocks` and jest's `clearAllMocks()` reach only their own `vi.fn()` and `jest.fn()` mocks. This one
 * covers `createMockFn` and everything built on it, such as `createMockInteraction` and `createMockClient`. To also
 * undo what a test set, use {@link resetAllMocks}.
 *
 * @example
 * ```ts
 * import { afterEach } from 'vitest'
 *
 * afterEach(() => clearAllMocks())
 * ```
 *
 * @group Testing
 * @category Mocks
 * @see {@link resetAllMocks}
 */
export function clearAllMocks(): void {
  for (const ref of created) ref.deref()?.mockClear()
}

/**
 * Clears every mock from `meocord/testing`, and puts each back to the implementation it was created with.
 *
 * Use it so every test starts from mocks as they were created: `mockReturnValue`, `mockResolvedValue` and the rest a
 * test set are undone, and a mock interaction's methods reply, defer and refuse a second reply as before.
 *
 * @remarks
 * State a mock keeps outside its methods, such as whether an interaction was replied to, stays.
 *
 * @example
 * ```ts
 * import { afterEach } from 'vitest'
 *
 * // In a Vitest setup file
 * afterEach(() => resetAllMocks())
 * ```
 *
 * @group Testing
 * @category Mocks
 * @see {@link clearAllMocks}
 */
export function resetAllMocks(): void {
  for (const ref of created) ref.deref()?.mockReset()
}

/**
 * Creates a mock function that jest's and Vitest's `expect` both read.
 *
 * Use it for a function double in code that must not depend on one test runner, such as a shared test helper; in a
 * Vitest test, `vi.fn()` works as well. {@link clearAllMocks} and {@link resetAllMocks} reach it.
 *
 * @remarks
 * `mockReturnValue`, `mockResolvedValue`, `mockRejectedValue` and `mockImplementation` share one implementation, so
 * the last one set wins. The `*Once` variants queue, and run first, in the order they were set.
 *
 * @param impl - The implementation to run until another is set.
 *
 * @example
 * ```ts
 * import { expect } from 'vitest'
 *
 * const double = createMockFn((value: number) => value * 2)
 * expect(double(2)).toBe(4)
 * double.mockReturnValueOnce(99)
 * expect(double(2)).toBe(99)
 * expect(double).toHaveBeenCalledTimes(2)
 * ```
 *
 * @group Testing
 * @category Mocks
 * @see {@link MockInstance}
 */
export function createMockFn<T extends (...args: any[]) => any = (...args: any[]) => any>(impl?: T): MockedFunction<T> {
  // One persistent implementation and one queue of single-use ones, as in jest and vitest: the
  // four setters share the slot, so the last call wins, and the `*Once` variants share the queue,
  // so they run in declaration order.
  let currentImpl: ((...args: any[]) => any) | undefined = impl as ((...args: any[]) => any) | undefined
  let onceQueue: ((...args: any[]) => any)[] = []
  let name = 'vi.fn'

  const calls: any[][] = []
  const results: MockResult<any>[] = []
  const instances: any[] = []

  const mockFn = function (this: unknown, ...args: any[]): any {
    calls.push(args)
    instances.push(this)

    let type: 'return' | 'throw' = 'return'
    let value: any
    try {
      if (onceQueue.length > 0) {
        value = onceQueue.shift()!.apply(this, args)
      } else if (currentImpl !== undefined) {
        value = currentImpl.apply(this, args)
      } else {
        value = undefined
      }
      return value
    } catch (err) {
      type = 'throw'
      value = err
      throw err
    } finally {
      results.push({ type, value })
    }
  } as MockedFunction<T>

  // Stamp the marker both jest and vitest check via isMockFunction.
  Object.defineProperty(mockFn, '_isMockFunction', { value: true, enumerable: false })

  const mock = {
    get calls() {
      return calls
    },
    get results() {
      return results
    },
    get instances() {
      return instances
    },
    get lastCall() {
      return calls.length > 0 ? calls[calls.length - 1] : undefined
    },
  } as MockState<T>
  Object.defineProperty(mockFn, 'mock', { value: mock, enumerable: false })

  mockFn.mockReturnValue = ((v: any) => {
    currentImpl = () => v
    return mockFn
  }) as MockInstance<T>['mockReturnValue']
  mockFn.mockReturnValueOnce = ((v: any) => {
    onceQueue.push(() => v)
    return mockFn
  }) as MockInstance<T>['mockReturnValueOnce']
  mockFn.mockResolvedValue = ((v: any) => {
    currentImpl = () => Promise.resolve(v)
    return mockFn
  }) as MockInstance<T>['mockResolvedValue']
  mockFn.mockResolvedValueOnce = ((v: any) => {
    onceQueue.push(() => Promise.resolve(v))
    return mockFn
  }) as MockInstance<T>['mockResolvedValueOnce']
  mockFn.mockRejectedValue = ((v: any) => {
    currentImpl = () => Promise.reject(v)
    return mockFn
  }) as MockInstance<T>['mockRejectedValue']
  mockFn.mockRejectedValueOnce = ((v: any) => {
    onceQueue.push(() => Promise.reject(v))
    return mockFn
  }) as MockInstance<T>['mockRejectedValueOnce']
  mockFn.mockImplementation = ((fn: any) => {
    currentImpl = fn
    return mockFn
  }) as MockInstance<T>['mockImplementation']
  mockFn.mockImplementationOnce = ((fn: any) => {
    onceQueue.push(fn)
    return mockFn
  }) as MockInstance<T>['mockImplementationOnce']
  mockFn.mockClear = (() => {
    calls.length = 0
    results.length = 0
    instances.length = 0
    return mockFn
  }) as MockInstance<T>['mockClear']
  mockFn.mockReset = (() => {
    calls.length = 0
    results.length = 0
    instances.length = 0
    onceQueue = []
    currentImpl = impl as ((...args: any[]) => any) | undefined
    return mockFn
  }) as MockInstance<T>['mockReset']
  mockFn.mockRestore = (() => {
    mockFn.mockReset()
    return mockFn
  }) as MockInstance<T>['mockRestore']
  mockFn.getMockName = (() => name) as MockInstance<T>['getMockName']
  mockFn.mockName = ((n: string) => {
    name = n
    return mockFn
  }) as MockInstance<T>['mockName']

  const ref = new WeakRef<MockInstance>(mockFn as MockInstance)
  created.add(ref)
  collected.register(mockFn, ref)
  return mockFn
}
