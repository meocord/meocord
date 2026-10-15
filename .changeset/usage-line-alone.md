---
'meocord': patch
---

A message command's usage reply no longer says "The command has more words than it takes" to a message with no more words than its pattern takes. When none of MeoCord's reasons is true, the reply is the usage line alone. That happens for a role's name given where the pattern has an optional role param before another param, such as `!tail Mods 3` for `tail {r:role?} {n:int?}` in a server with a role named Mods: there the role is read only as a mention or an ID, as `!tail @Mods 3` gives it.
