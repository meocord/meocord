---
'meocord': patch
---

`respond()` now edits a reply the app sent itself with `interaction.reply()` or `deferReply()` to a button, select menu or modal on a Components V2 message in that reply's own format. It took the format of the message the component is on, so an embed reply was edited as Components V2: its content and embeds were dropped, and Discord refused the edit with a 400. MeoCord's own error messages still follow the component's message.
