---
'meocord': patch
---

A bot whose commands only one handler or one builder could ever take stops when it is created, as `meocord start`, `meocord register`, a shard manager and a testing module build it, naming both:

- two handlers of one slash command name or subcommand path, or of one context menu name and kind, where only the first ever ran: `StatsController.stats and AdminController.adminStats both handle the slash command "stats", so only StatsController.stats would ever run.`;
- two builder classes that build one application command, where only the first was registered, with a warning: `StatsBuilder on StatsController.stats and CopiedStatsBuilder on StatsController.statistics both build the slash command "stats"…`.

One builder on a command and its own subcommand paths is still one command, and a user and a message context menu may still share a name. See [Upgrading to 4.1](https://meocord.dev/docs/4.1/migrating#two-handlers-of-one-command-stop-the-bot).
