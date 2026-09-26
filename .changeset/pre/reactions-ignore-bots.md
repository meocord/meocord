---
'meocord': patch
---

`@ReactionHandler` skips reactions from bots, the bot's own included, as `@MessageHandler` skips messages from bots. Every handler ran for them: a bot's reaction handlers ran for the reactions it added itself, a poll counted the reactions the bot seeded, and the generated sample answered its own reaction twice. A handler that should still run for bot reactions sets `bots: true`: `@ReactionHandler('📌', { bots: true })`, or `@ReactionHandler({ bots: true })` for every emoji. A partial user is fetched to tell whether it is a bot. See [Reactions from bots reach no handler](https://github.com/meocord/meocord/blob/main/docs/MIGRATING.md#reactions-from-bots-reach-no-handler) in the upgrade guide.

New applications' sample reaction controller answers 😋 once, and its handler for every emoji only logs.
