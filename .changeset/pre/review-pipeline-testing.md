---
'meocord': patch
---

Testing mocks behave more like discord.js, and a few messages and types say more:

- An interaction mock has an `id`, a `channelId` and a `user` with an `id`, and a message mock an `id`, `author.id`, `channelId` and `guildId`, each a snowflake string no other mock in the test run has; `createMockUser`, `createMockGuild` and `createMockChannel` get ids too. They were mock objects that all read as `[object Object]`, so two default users were one user, and shared a per-user cooldown.
- An interaction mock made without a `guildId` has `guildId`, `guild` and `member` `null`, as a direct message does, where they were truthy while `inGuild()` said otherwise. Giving it a `guildId` gives it a member.
- The autocomplete mock's `respond()` rejects more than 25 choices, as Discord does.
- `invoke` takes the interaction for a handler declared with no parameters, which failed to compile.
- `respond().modal()` after `@Defer` acknowledged the interaction says so, and how to fix it.
- A class listed alone in `providers` is refused with what to write instead: in the testing module it needs no listing, and in `@MeoCord` it goes in `services`.
- The `ExceptionFilter` and `@Catch` examples answer through `context.response?.error()`, which suits a deferred interaction too.
- The README gives the key a cooldown is counted under, with an example.

Tests that relied on the old mock defaults may need a change; see [Smaller changes](https://github.com/meocord/meocord/blob/main/docs/MIGRATING.md#smaller-changes).
