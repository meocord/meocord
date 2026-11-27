---
'meocord': patch
---

`respond()` now logs a warning, naming the interaction, when it drops non-empty `content` or `embeds` from an answer to a Components V2 message, which can carry only components. The drop was silent, so the user kept seeing the old message and the app was never told. Send that text as components instead, such as a Text Display.
