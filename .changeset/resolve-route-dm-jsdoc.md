---
'meocord': patch
---

The JSDoc of `resolveRoute`'s `dm` option now says that dispatch answers a DM to a handler that works only in a server, by its scope or a `member`, `role` or `channel` param, "This command works in a server only.", as it does whatever words the message gives. It said dispatch answered such a DM with the command's usage.
