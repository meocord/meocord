---
'meocord': minor
---

A select menu's choices arrive in its handler's params, as a modal's fields do. `values` holds the chosen options' values or ids, beside the customId params. discord.js's resolved objects come too: `users` and `members` from a user select, `roles` from a role select, `channels` from a channel select, and `users`, `members` and `roles` from a mentionable one.

`@Validate`, pipes, `@Cooldown({ by })` and `getHandlerParams()` see them, so a poll can limit each option on its own with `by: (_context, { values }: { values: string[] }) => values[0]`. A customId param of the same name keeps winning, and development warns about the clash. `invoke` builds them from a mock's `values`, `users`, `members`, `roles` and `channels`. Handlers that read `interaction.values` keep working.
