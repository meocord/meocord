---
'meocord': patch
---

Under `useStrictMocks()`, a mock interaction's `ephemeral` is `null` until `reply()` or `deferReply()` decides it, as discord.js has it; `update()` and `deferUpdate()` leave it `null`. In default mode it still reads `false` before an answer, and a test reading it there logs a warning once. MeoCord's own reads while it answers log nothing. The next major version (5.0) reads `null` without the call.
