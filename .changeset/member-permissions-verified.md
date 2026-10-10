---
'meocord': patch
---

Under `useStrictMocks()`, reading a mock interaction's `memberPermissions` no longer resolves its member through `guild.members.resolve()` again. A test that stubbed `resolve` once for its own lookup lost that stub to the mock, and `memberPermissions` threw "Cannot read properties of undefined (reading 'length')". The channel's overwrites are now applied to the member the interaction has, as discord.js applies them to a member it has already resolved.
