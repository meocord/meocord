---
'meocord': patch
---

Without `useStrictMocks()`, a mock interaction given a `guild` but no `guildId` no longer warns that its `guildId` reads a DM's value when MeoCord answers it, by `respond()` or its error reply, though the test read nothing. MeoCord's answer only needs whether the bot is present, which it now reads from Discord's `context` and the authorizing integrations alone, and the response's `location` is read when asked for. A test's own read of the mock's `guildId` still warns.
