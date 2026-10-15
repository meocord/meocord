---
'meocord': patch
---

A DM to a message command that works only in a server is answered "This command works in a server only." whatever words it gives, as one whose words fit already was. A command with a `member`, `role` or `channel` param, or such a required flag, such as `pin {text...} {--in:channel}`, answered `!pin` in a DM with its usage, then `!pin hello` with the server-only reply. A DM that gives an optional flag of those types, such as `--in=…`, is answered the same way. When another route of the command works in a DM, a DM that names it without fitting gets that route's usage.
