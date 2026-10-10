---
'meocord': patch
---

Command registration keeps in step with what Discord holds:

- A development start no longer skips a scope as unchanged when the commands were removed or changed since: it checks the scope with one listing first, and sends again when Discord's commands differ. A scope that `clearOther` cleared, or that a production run wrote, from the same checkout is sent again without the check. Before, only `--force-register` brought such commands back.
- `meocord register --guild` with a blank guild, as an unset `--guild "$DEV_GUILD_ID"` gives, stops with an error and exits 1, where it registered to `commands.guilds` or globally. That matches what `commands.guilds` already does for an unset id.
- The warning about commands left in another scope says why they are kept during a development-guild run, instead of advising `commands.clearOther`, which doesn't apply there.
- The registered-commands table lists only subcommands and subcommand groups under Sub-commands, not a command's plain options.
