---
'meocord': patch
---

A mock interaction's type guards, such as `isButton()` and `isRepliable()`, and its `inGuild()`, `inCachedGuild()` and `inRawGuild()` keep answering as discord.js does after `resetAllMocks()`. They returned `undefined` after a reset, so a mock made once for several tests, such as in `beforeAll`, failed every type check after the first test in a project that resets between tests, as a generated one does.
