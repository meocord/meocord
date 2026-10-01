---
'meocord': patch
---

A command handler that Discord never sends an interaction to now gets a warning when the app is created, so `meocord start`, `meocord register` and the shard manager report it. Before, such a handler was dead or misrouted with no sign at startup. One warning names every such handler, what is wrong and what to do:

- a subcommand path that the command's builder doesn't register: `@Command('settings notfy', CommandType.SLASH)` beside a `settings` builder with `view` and `notify`. Before, `/settings notify` silently ran the `settings` handler;
- a customId pattern, such as a `route()`, given to a slash, context menu or entry point handler, which is matched by its command name;
- a builder that registers another name than its `@Command`'s, such as `setName('ping')` under `@Command('pong', PingBuilder)`;
- a slash, context menu or entry point command that no builder registers at all.

The bot still starts. In 5.0, these refuse to start.

`MeoCordTestingModule.compile()` gives the same warning, apart from the last case: a handler with a `CommandType` and no builder is how a test fixture is written.
