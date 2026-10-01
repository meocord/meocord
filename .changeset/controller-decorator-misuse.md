---
'meocord': patch
---

Three mistakes with `@Command` and `@MessageHandler` are now named where they happen:

- **A command builder whose constructor throws**, such as one reading a translator or the environment in a field, is refused as the class loads, like a builder whose `build()` throws: `Stats.stats: StatsBuilder could not be made for "stats": missing translator.` It used to surface as the bare error at import, naming neither the builder nor the command.
- **A `@Command` handler called with another kind of interaction**, as a direct call in a test can be, throws `Cards.card: @Command('card/{id}', CommandType.BUTTON) takes a ButtonInteraction, not a ChatInputCommandInteraction.`, or `…; it was given undefined.` for something that is no interaction at all, instead of `Invalid interaction type passed to @Command for method: card`.
- **`@MessageHandler('')`** still runs for every message, as `@MessageHandler()` does, and now logs a warning naming the handler: `@MessageHandler('') on Chat.every is deprecated; in the next major version (5.0) it is refused. Use @MessageHandler() instead.` See [the upgrade guide](https://meocord.dev/docs/4.1/migrating#messagehandler-logs-a-warning).

A builder error that ends in a full stop no longer gets a second one in its refusal.
