---
'meocord': patch
---

A slash command builder given on a subcommand path, such as `@Command('settings notify email', SettingsCommandBuilder)`, is named for what it is. A builder that builds its name from the path fails as before, now with a message naming the handler: `SettingsSlashController.notifyEmail declares the builder SettingsCommandBuilder on "settings notify email", which is a subcommand path: the builder of its command, "settings", describes it`, with what to declare instead, where it said "Invalid string format" and advised checking name lengths. A builder that names its command itself keeps working, and is warned about once as the bot starts, with the same advice: declare the handler with `@Command('settings notify email', CommandType.SLASH)`, and give the builder to `@Command('settings')`.
