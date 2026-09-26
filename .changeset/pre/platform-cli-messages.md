---
'meocord': patch
---

A bot token Discord refuses, or an empty one, is now explained in one line: what is wrong, and where to get a token (Developer Portal → your application → Bot → Reset Token, into `DISCORD_TOKEN` in `.env` for a generated app). `app.start()` still rejects and sets the exit code, and the error is recognised by `isExplainedError`, so the generated `main.ts` no longer logs discord.js's error and stack a second time. `meocord register` explains a refused token the same way instead of printing the raw `DiscordAPIError` 401. With process sharding, the manager explains it and exits before spawning any shard.

`commands.guilds` whose ids are all blank, as `[process.env.GUILD_ID]` leaves it with the variable empty or unset, no longer registers globally. The commands without guilds of their own are registered nowhere, with a warning that names them, leftovers are not cleared even with `clearOther`, and `meocord register` exits 1. `guilds` accepts undefined ids, so `[process.env.GUILD_ID]` needs no `!`.

With `bundleDependencies`, a build that finds `supports-color` missing, which `debug` probes for, prints one line naming the dependency and the `optionalExternals` entry that silences it, instead of the bundler's "Module not found" warning with a code frame.

`meocord show` without a flag says to run `meocord show --license` or `meocord show --warranty` instead of reprinting its options. A config number out of range shows the value and the range, as in `sharding.shards must be 'auto' or a whole number of shards, 1 or more (got 0)`. A new application's README lists the observer generator.
