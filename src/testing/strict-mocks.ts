import { shared } from '@src/util/shared-state.util.js'

// Whether useStrictMocks() is on, and whether a mock was made before it could be, for both builds of this version
const settings = shared('strictMocks', () => ({ strict: false, mockMade: false }))

/** Whether mocks compute discord.js's state, as {@link useStrictMocks} turns on. */
export const strictMocks = (): boolean => settings.strict

/** Notes that a mock was made, which useStrictMocks() must come before. */
export function noteMockMade(): void {
  settings.mockMade = true
}

/**
 * Has every mock from `meocord/testing` compute the values discord.js computes, where it reads a placeholder otherwise.
 *
 * Call it once in the test runner's setup file. A message's `editable`, `deletable`, `pinnable`, `crosspostable`,
 * `bulkDeletable`, `hasThread` and `partial`, a member's `manageable`, `kickable`, `bannable` and `moderatable`, a
 * role's `editable`, a channel's and a thread's `viewable`, `manageable`, `deletable`, `joinable` and the rest, a voice
 * channel's `full`, and `partial` on users, channels and reactions then run discord.js's own getters against the mock,
 * and `message.thread` is `null` when the channel caches no thread under the message's id. So do a message's
 * `editedAt`, a member's `presence`, a server's `verified` and `systemChannel` and a channel's `parent`, each `null` or
 * `false` until the test gives what it is computed from. A reaction's `me` is `false`, a message's
 * `mentions.repliedUser` and a modal's `message` are `null`, an interaction's `ephemeral` is `null` until `reply()` or
 * `deferReply()` decides it, and a reaction has a whole message of its own, so MeoCord's dispatcher fetches neither. No
 * placeholder warning is logged.
 *
 * @remarks
 * Those getters read what a server holds, so strict mocks also have it as Discord sends it: the bot's member is in the
 * server's member cache from the start, @everyone has the permissions Discord gives it in a new server, and a channel
 * or thread made without a server has one of its own, a thread with a text channel as its parent. A message has empty
 * `content`, a thread is neither archived nor locked, and a reaction's `count` is 1. A user, server or channel made
 * with a generated id was created when the mock was made, as a message is. An interaction's `memberPermissions` apply
 * its channel's overwrites, a thread's parent's for a thread, to its member's permissions. An interaction is in its
 * message's channel and server, a guild's or a member's server, or, given a `guildId` alone, a server the bot isn't in.
 * A message the bot sends is its `client.user`'s, and one it sends in a DM is in that DM. Give the bot's member a role
 * to let it do more, such as kick a member its role ranks above. A value the test sets on a mock wins over the computed
 * one. A property the mock's discord.js class does not have reads `undefined`, as on discord.js, and `in` answers as
 * the class does, true for the fields discord.js sets on its instances; without strict mocks such a property reads a
 * placeholder, and the first read of one by the app's or the test's code warns once. A mock of a class discord.js does
 * not define, such as an app's subclass, or of one that sets fields under computed keys, keeps a placeholder for a key
 * its class lacks, since its fields can't be read in full from its source. An interaction's answer that discord.js
 * would refuse, such as a second `reply()` after one a test set with `mockResolvedValue`, is refused too, where without
 * it the mock runs it and warns. An interaction's `reply()`, `deferReply()`, `update()` and `deferUpdate()` resolve to
 * a mock `InteractionResponse`, or with `withResponse` to an `InteractionCallbackResponse` holding what Discord
 * answers, where without it they resolve to `undefined`, a deferred reply is flagged `Loading` until it is edited, and
 * `respond()`'s `send()` resolves to the message a reply or an update sent. An edit changes only the flags Discord lets
 * it change, so a private message stays private and a Components V2 message stays V2, and a Components V2 message that
 * holds content or embeds, sent so or made V2 by an edit that doesn't clear them, is refused with a 400; without strict
 * mocks an edit's flags replace the message's and such a message is sent, each with a warning. A client from
 * `createMockClient()` has a working emitter, and `dispatch` leaves a component or modal no route takes to its
 * `interactionCreate` listeners, such as a collector's, and delivers a message or a reaction to its message and
 * reaction listeners, routed or not, having applied the reaction to its message as the gateway does. A mock interaction
 * or message shares its client with what it holds, its user, member, channel and server, as discord.js reaches them
 * through its caches, and a mock message's, response's and channel's component collectors, a channel's message
 * collectors and a message's reaction collectors run discord.js's own on that client, so a click built from a reply
 * reaches the reply's collector. A mock reaction is on its message's client. A message an interaction sends names it in
 * `interactionMetadata`, and a command's `message` and a message's raw `channel_id` and `guild_id` read `undefined`, as
 * discord.js's `InteractionCollector` expects. An answer marks the interaction `replied`, `deferred` or `responded`
 * once it resolves, as discord.js does, so code that doesn't await one fails as it would on a bot, within one run of
 * the test's code. The next major version (5.0) computes these values, and refuses those answers, without the call.
 * With strict mocks or without, each `fetchReply()`, `editReply()` and `followUp()` resolves to a new message object,
 * never one an earlier call gave, as in discord.js, so a test compares messages by `id`, and two edits by
 * `editedTimestamp`.
 *
 * `invoke` also refuses a call that gives a handler fewer arguments than it declares where it builds none, such as a
 * reaction handler given its reaction without its `ReactionEvent`; without strict mocks, it warns once and calls it.
 * It refuses an autocomplete that dispatch gives to another `@Autocomplete` handler, or to none, the same way.
 *
 * `compile()` also refuses an `overrideGuard`, `overrideInterceptor` or `overrideFilter` stub without the stage's
 * method, `canActivate`, `intercept` or `catch`; without strict mocks, it warns and builds the module.
 *
 * `init({ ready: true })` and `close()` also run the lifecycle hooks of a class only a stage or the presenter injects
 * in the bot's order, after the controllers' and observers'; without strict mocks they run before the controllers', and
 * a module whose hooks would run in another order warns once.
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
 * @see {@link https://meocord.dev/docs/4.3/mocks | Mocks}
 */
export function useStrictMocks(): void {
  if (settings.strict) return
  if (settings.mockMade) {
    throw new Error(
      'useStrictMocks() goes before any mock is made: a mock made before it reads placeholders, and the two kinds would ' +
        "mix. Call it once, in the test runner's setup file.",
    )
  }
  settings.strict = true
}

/** Turns strict mocks off and forgets the mocks made, so a spec can turn them on afresh. */
export function forgetStrictMocks(): void {
  settings.strict = false
  settings.mockMade = false
}
