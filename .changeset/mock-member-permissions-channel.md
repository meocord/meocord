---
'meocord': patch
---

Under `useStrictMocks()`, a mock interaction's `memberPermissions` applies its channel's permission overwrites, as Discord computes it, so a guard that checks it denies in a test where it denies in production. The overwrites go on top of `member.permissions`, so a value a test sets there still decides the base. As in discord.js:

- an Administrator or the server's owner has every permission, `PermissionsBitField.All`;
- a thread takes its parent's overwrites;
- a raw member's permissions are kept as given.

In default mode `memberPermissions` is still the member's own permissions. Where strict mocks would read otherwise, because of the channel's overwrites or an Administrator's or owner's every permission, reading it warns once, naming the permissions strict mocks read without or with. It also warns once where the server's @everyone role has no permissions set, since strict mocks give @everyone the permissions Discord gives it in a new server; set `guild.roles.everyone.permissions` to read the same in both modes. The next major version (5.0) applies the overwrites without the call.
