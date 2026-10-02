---
'meocord': patch
---

A handler that a subclass re-declares follows one rule for `@Command`, `@MessageHandler`, `@ReactionHandler` and `@Autocomplete`.

- **On the route it inherits**, the subclass's declaration takes that route's place, so the subclass's options apply: a re-declared `@Command('ping', LoudPingBuilder)`, `@MessageHandler('roll', { description })` or `@ReactionHandler('👍', { bots: true })` uses its own builder, description or settings. In 4.0 the base's applied, since the base's declaration came first. To keep the base's builder or options, don't re-declare that route on the subclass, or declare it with the base's builder. The routes the subclass answers are unchanged.
- **On another route**, the subclass still answers the route it inherits too, as in 4.0. For example, a subclass overrides `page()`, which its base declares as `@Command('page/{n}', …)`, with `@Command('shop/page/{n}', …)`, and answers both. The bot now names each such handler in one warning as it starts, with the routes it inherits and its own. In the next major version (5.0), a handler's own routes replace the ones it inherits. To keep an inherited route, declare it on the subclass's method as well.

A class between them that declares nothing changes neither. A subclass that declares every route itself, or none, gets no warning. See [the upgrade guide](https://meocord.dev/docs/4.1/migrating#a-re-declared-handler-that-keeps-its-inherited-route-logs-a-warning).
