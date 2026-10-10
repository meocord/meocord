---
'meocord': patch
---

A mock interaction holds each message it sends as it was sent, as Discord does:

- `followUp()` resolves to the follow-up it sent, with the content, embeds, components and flags that `fetchReply(id)` reads back, as discord.js resolves it to the message Discord returns. It used to resolve to a message holding only the id, with a stub `content` and flags of 0, so code reading whether a follow-up was private saw a different value than against Discord.
- `reply()`, `update()` and `followUp()` build what they send when they are called, so a builder changed afterwards no longer changes what `fetchReply()` reads.
- Under `useStrictMocks()`, an answer whose components or embeds discord.js refuses to build, such as a button with no label, rejects at the call with discord.js's error and leaves the interaction as it was. In default mode it still resolves, and it warns once. The next major version (5.0) rejects it without the call.
