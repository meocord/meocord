---
'meocord': patch
---

`respond(interaction).error()` now adds an error to a private component message only when the message stays within Discord's text limits: 4000 characters across a Components V2 message's Text Displays, and 6000 characters across an embed message's embeds. It counted only components and embeds, so a long error could push the message past those limits and Discord refused the edit. Past them, the error follows up privately, as it does when the components or embeds don't fit.
