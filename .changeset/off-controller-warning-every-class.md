---
'meocord': patch
---

The startup warning about a `@Command`, `@MessageHandler`, `@ReactionHandler` or `@Autocomplete` on a class that isn't a controller, which never runs, now covers every class the app makes. That includes a service only a guard, interceptor, filter, pipe or the presenter injects, and a class made for each call because it injects `ExecutionContext`. Those stage classes are covered themselves too, so a guard's own `@MessageHandler` is now named. A testing module now names the same handlers as the bot, a provider's `useClass` under another token included. Nothing else changes: such a handler didn't run before and doesn't now. Move it to a controller.
