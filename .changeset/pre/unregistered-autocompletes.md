---
'meocord': patch
---

The startup warning about command handlers that Discord never sends now also covers `@Autocomplete` handlers. One is named when:

- no builder registers its command;
- its path isn't a subcommand that its command's builder registers;
- it names an option the builder doesn't register, or one built without `setAutocomplete(true)`;
- it completes every option of a subcommand that has no option with autocomplete on.

A handler of the whole command is checked against every option of the command, its subcommands' included, since MeoCord falls back to it for all of them. The bot still starts. In the next major version (5.0), these refuse to start. See [the upgrade guide](https://meocord.dev/docs/4.1/migrating#a-command-handler-discord-never-sends-logs-a-warning).

`MeoCordTestingModule.compile()` names the same cases, apart from a command no builder registers, as it already does for `@Command` handlers.

`meocord generate controller autocomplete <name>` now ends by saying what to add to `/<name>`'s builder, the `query` option with `setAutocomplete(true)`, since the generated handler completes that option and Discord never asks it to until the command declares it.
