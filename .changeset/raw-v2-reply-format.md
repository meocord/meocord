---
'meocord': patch
---

`respond()` now edits a Components V2 reply the app sent itself with `interaction.reply()` as V2. It edited it as an embed message, which Discord's documentation says doesn't work on a V2 message. discord.js keeps no flags of such a reply, so `respond()` reads it back once with `fetchReply()` before it first edits it, whether it is an embed or V2. It reads back nothing after a `deferReply()`, an `update()` or a `deferUpdate()`, whose format is known.
