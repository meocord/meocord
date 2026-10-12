---
'meocord': patch
---

The `role` entry of `MessageParamTypes` now says when a role's name is read. A `role` param takes a mention, an ID or a role's name when it's required or ends the pattern. An optional `role` param that another optional param follows takes only a mention or an ID, since whether a word fits there is read from the word alone. With `tail {r:role?} {n:int?}`, `!tail Mods 3` gets the usage reply, and `!tail @Mods 3` runs the handler.

Nothing changes at runtime. If your users name a role in such a pattern, ask them for a mention or an ID, or move the role param to the end of the pattern.
