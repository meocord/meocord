---
'meocord': patch
---

A mock member's `roles.resolve()` and `roles.resolveId()` now read the roles the member has, given a role or its id, where they threw "Right-hand side of 'instanceof' is not callable". `member.roles.guild` and `member.roles.client` are the member's server and client, as discord.js sets them, where they were placeholders.
