---
'meocord': patch
---

A primary entry point command is now registered only globally, as Discord requires. Discord refuses a guild update that holds one (400, code 50222), and before, that refusal took every other command in the update with it.

- A production run sends the entry point in the global update, even with `commands.guilds` set, and ignores a `guilds` restriction on its builder, with a warning. With `commands.guilds`, that global update holds the entry point and replaces any global commands left from an earlier configuration.
- A development run with `developmentGuild`, and `meocord register --guild`, leave the entry point out of the guild update with a warning, so the rest of the commands register. They send nothing global, as a global update from such a run would delete the application's other global commands. A production run or `meocord register` registers the entry point.

See [Slash commands](https://meocord.dev/docs/4.2/slash-commands).
