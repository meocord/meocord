---
'meocord': patch
---

A `UserError` thrown from a message command or an `@On` message event is answered with a reply that pings no one its text mentions, as MeoCord's other replies to messages already do. Users, roles, `@everyone` and `@here` in the error's message are shown as written. Nothing changes for a bot whose error messages hold no mentions.
