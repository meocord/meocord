---
'meocord': patch
---

Under `useStrictMocks()`, a mock interaction is marked `replied`, `deferred` or `responded` once its answer resolves, as discord.js marks it after Discord takes the answer, rather than when the answer is called. Code that doesn't await an answer now fails in a test as it would on a bot:

- an `editReply()`, `followUp()` or `deleteReply()` made before the first answer resolves rejects with `InteractionNotReplied`;
- a second answer sent while the first is in flight passes discord.js's check and is refused with Discord's 40060, unless the first one failed;
- `replied`, `deferred`, `responded` and `ephemeral` read in the same run as an un-awaited answer are as before it.

This catches overlaps within one synchronous run of the test's code. A mock answer resolves on the next microtask, so an answer still in flight across an `await`, as a guard's `void interaction.reply()` followed by `return false` is on a bot, isn't caught.

In both modes, an answer that fails no longer undoes an answer made after it. A test could make the first of two un-awaited replies reject, and the interaction then read as unanswered though the second reply went through; it now reads as answered by the second. A failed answer's change is undone once every change after it is undone too, so an interaction whose answers all fail still reads as unanswered.

In default mode the flags are still set at the call. The first time an interaction does what a bot would refuse, an edit or a second answer while its first is in flight, a warning says what the bot would do. In the next major version (5.0), every mock interaction marks its answers when they resolve, as strict mocks do now.
