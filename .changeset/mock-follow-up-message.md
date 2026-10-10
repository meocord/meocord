---
'meocord': patch
---

A mock interaction's `followUp()` resolves to the follow-up it sent, with the content, embeds, components and flags that `fetchReply(id)` reads back, as discord.js resolves it to the message Discord returns. It used to resolve to a message holding only the id, with a stub `content` and flags of 0, so code reading whether a follow-up was private saw a different value than against Discord. The follow-up is held as it was when sent, so a builder changed afterwards doesn't change it.
