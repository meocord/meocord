---
'meocord': patch
---

A mock interaction keeps its reply state, its original response and discord.js's errors whatever a test sets its answers to do.

- **A test's own value.** An answer given a value with `mockResolvedValue`, `mockResolvedValueOnce` or `mockImplementation` now replies or defers as a real one would: `reply`, `deferReply`, `followUp`, `editReply`, `showModal`, `update` and `deferUpdate`. `getResponse(interaction).state` then reads `'replied'` or `'deferred'` where it read `'unanswered'`. One that rejects still changes nothing.
  - A second answer after such an answer, which discord.js refuses, still runs in default mode, with a warning.
  - Under `useStrictMocks()` it is refused, as discord.js refuses it. The next major version (5.0) refuses it without the call.
- **The original response.** `fetchReply()` reads back what `reply()` or `update()` sent instead of an empty message. After `deleteReply()`, fetching, editing or deleting the original response rejects with 10008 (Unknown Message), as Discord answers. So does fetching it before any answer. Follow-ups stay reachable by their id: `editReply({ message: id })`, `fetchReply(id)` and `deleteReply(id)` act on the follow-up, where `editReply` edited the original before.
- **Flags.** `flags` given as an array, a name or a `MessageFlagsBitField` makes a reply ephemeral, as in discord.js; only a number did before. `null` flags are none. A bigint or an unknown name rejects with discord.js's RangeError, where a bigint read as ephemeral before.
- **Errors.** A second reply, an answer before any reply and a second autocomplete `respond()` throw discord.js's `DiscordjsError`, with the codes `InteractionAlreadyReplied` and `InteractionNotReplied`. They keep their messages, so a test matching the message as a string or a regex keeps passing. One comparing with `new Error(message)` sees the new name and code.
