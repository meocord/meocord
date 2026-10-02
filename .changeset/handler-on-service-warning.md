---
'meocord': patch
---

`MeoCordFactory.create()` and the testing module's `compile()` now warn about each `@MessageHandler`, `@ReactionHandler`, `@Command` or `@Autocomplete` on a class that is not one of the app's `@MeoCord({ controllers })`, such as a service or a class one injects. MeoCord dispatches only to controllers, so these handlers never run, and nothing said so. Move them to a controller: the next major version (5.0) refuses to start with them, as the [upgrade guide](https://meocord.dev/docs/4.1/migrating#a-handler-on-a-class-that-isnt-a-controller-logs-a-warning) describes. A sharded bot warns once, from its manager. The warnings about missing intents and partials no longer name these handlers, since no intent would make them run. `@On` and `@Once` handlers run on any bound class, as before.
