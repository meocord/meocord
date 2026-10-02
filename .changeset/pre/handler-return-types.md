---
'meocord': patch
---

A handler may return a value. `@Command`, `@MessageHandler`, `@ReactionHandler` and `@Autocomplete` accepted only a method returning nothing, so `return interaction.reply(…)` or `return message.reply(…)`, as discord.js code often ends a handler, failed to compile with "Unable to resolve signature of method decorator". As with `@On`, any return type compiles: MeoCord answers nothing with it, and an interceptor receives it from `next.handle()`. A parameter of the wrong type is still refused.
