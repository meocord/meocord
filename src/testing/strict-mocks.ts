// Whether useStrictMocks() is on, and whether a mock was made before it could be
let strict = false
let mockMade = false

/** Whether mocks compute discord.js's state, as {@link useStrictMocks} turns on. */
export const strictMocks = (): boolean => strict

/** Notes that a mock was made, which useStrictMocks() must come before. */
export function noteMockMade(): void {
  mockMade = true
}

/**
 * Has every mock from `meocord/testing` compute the values discord.js computes, where it reads a placeholder otherwise.
 *
 * Call it once in the test runner's setup file. A message's `editable`, `deletable`, `pinnable`, `crosspostable`,
 * `bulkDeletable`, `hasThread` and `partial`, a member's `manageable`, `kickable`, `bannable` and `moderatable`, a
 * role's `editable`, a channel's and a thread's `viewable`, `manageable`, `deletable`, `joinable` and the rest, and
 * `partial` on users, channels and reactions then run discord.js's own getters against the mock, and `message.thread`
 * is `null` when the channel caches no thread under the message's id. No placeholder warning is logged.
 *
 * @remarks
 * Those getters read what a server holds, so strict mocks also have it as Discord sends it: the bot's member is in
 * the server's member cache from the start, @everyone has the permissions Discord gives it in a new server, and a
 * channel or thread made without a server has one of its own, a thread with a text channel as its parent. A message
 * has empty `content`, a thread is neither archived nor locked, and a reaction's `count` is 1. A user, server or
 * channel made with a generated id was created when the mock was made, as a message is. Give the bot's member
 * a role to let it do more, such as kick a member its role ranks above. A value the test sets on a mock wins over the
 * computed one. The next major version (5.0) computes these values without the call.
 *
 * @throws Error when a mock already exists, which was made without it.
 *
 * @example
 * ```ts
 * // vitest.setup.ts
 * useStrictMocks()
 * ```
 *
 * @group Testing
 * @category Mocks
 * @see {@link useMockFn}
 * @see {@link https://meocord.dev/docs/4.2/mocks | Mocks}
 */
export function useStrictMocks(): void {
  if (strict) return
  if (mockMade) {
    throw new Error(
      'useStrictMocks() goes before any mock is made: a mock made before it reads placeholders, and the two kinds would ' +
        "mix. Call it once, in the test runner's setup file.",
    )
  }
  strict = true
}

/** Turns strict mocks off and forgets the mocks made, so a spec can turn them on afresh. */
export function forgetStrictMocks(): void {
  strict = false
  mockMade = false
}
