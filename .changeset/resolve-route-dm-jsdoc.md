---
'meocord': patch
---

The JSDoc of `resolveRoute`'s `dm` option now says that dispatch never runs a handler that works only in a server, by its scope or a `member`, `role` or `channel` param, for a DM, and answers "This command works in a server only." when the message used a prefix or a mention, and nothing when it didn't. It said dispatch answered such a DM with the command's usage.
