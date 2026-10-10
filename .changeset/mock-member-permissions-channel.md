---
'meocord': patch
---

Under `useStrictMocks()`, a mock interaction's `memberPermissions` applies its channel's permission overwrites, as Discord computes it, so a guard that checks it denies in a test where it denies in production. The overwrites go on top of `member.permissions`, so a value a test sets there still decides the base. As in discord.js:

- an Administrator or the server's owner keeps every permission;
- a thread takes its parent's overwrites;
- a raw member's permissions are kept as given.

In default mode `memberPermissions` is still the member's permissions. Where the channel's overwrites would change them, reading it warns once, naming the permissions strict mocks read without or with. The next major version (5.0) applies the overwrites without the call.
