---
'meocord': patch
---

A command whose builder lists guilds but no guild id, as `@CommandBuilder(CommandType.SLASH, { guilds: [process.env.STAFF_GUILD] })` does with the variable unset, is now named in one warning that lists every such builder and its command, says none of them is registered, and says `meocord register` still exits 0 for them. Each was warned about on its own, without its builder, and nothing said the deploy step still succeeded. In the next major version (5.0), such a builder makes `meocord register` exit 1, as an empty `commands.guilds` already does.
