---
'meocord': patch
---

A presenter's `messageError()` that throws or rejects no longer leaves a message command's author without an answer. The usage reply, a guard's or validation's reason, a `UserError`'s message and the direct messages `dmOnError` and `dmOnCooldown` send are then sent as MeoCord's own plain text, as without `messageError`, and a warning names the presenter and carries its error. Interactions already fell back to MeoCord's own view when a presenter's drawing failed.
