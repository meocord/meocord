---
'meocord': patch
---

A message command's `scope` now decides which handler runs, not only whether it may. A handler whose scope fits where the message was sent runs before one of another scope, so a DM-only `config {key}` no longer answers "direct messages only" in a server where an unscoped `config {words...}` fits, and one command may have a server handler and a DM handler with the same pattern, which startup refused. A message that only an out-of-scope handler matches still gets the reply saying where the command works.
