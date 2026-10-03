---
'meocord': patch
---

`invoke` rejects a command that dispatch gives to another handler, naming the one that runs, as it already does for a customId: with `@Command('settings')` and `@Command('settings language')`, invoking the first with the `language` subcommand throws `command 'settings language' does not reach Settings.bare: dispatch runs Settings.language.`. Both now find a command's handler with the same match.
