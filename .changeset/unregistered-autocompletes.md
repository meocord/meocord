---
'meocord': patch
---

The startup warning about command handlers that Discord never sends now also covers `@Autocomplete` handlers. One is named when:

- no builder registers its command;
- its path isn't a subcommand that its command's builder registers;
- it names an option the builder doesn't register, or one built without `setAutocomplete(true)`;
- it completes every option of a subcommand that has no option with autocomplete on.

A handler of the whole command is checked against every option of the command, its subcommands' included, since Discord falls back to it for all of them. The bot still starts. In 5.0, these refuse to start.

`MeoCordTestingModule.compile()` names the same cases, apart from a command no builder registers, as it already does for `@Command` handlers.
