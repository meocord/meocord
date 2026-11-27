---
'meocord': patch
---

`respond()` now clears the content and embeds of an embed message when its edit or update makes it Components V2, sending `content: null` and `embeds: []` with the components. It sent only the components and the flag, which Discord refuses with a 400, and which `useStrictMocks()` refuses too: a `send({ components, flags: MessageFlags.IsComponentsV2 })` after an embed answer, the app's own embed reply, or on a component's embed message failed. An answer that is already V2, or stays an embed, is edited as before.
