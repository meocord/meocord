---
'meocord': patch
---

`respond()` now edits a follow-up that became the answer in that follow-up's own format. A Components V2 `respond(interaction).followUp()` that replaced a public deferral, or followed a `delete()`, was edited as an embed message, which Discord's documentation says doesn't work on a V2 message; and an embed one that followed a component's V2 message was edited as V2, dropping its content and embeds.
