---
'meocord': minor
---

New `commandMention(path, target)` in `meocord/common` gives a clickable mention of one of your slash commands, a subcommand or a grouped subcommand, such as `</settings channel:1234567890123456789>`, so a help reply or an error can point at the command to run:

```ts
await respond(interaction).send(`Set a channel first with ${await commandMention('settings channel', interaction)}.`)
```

`target` is the interaction, message, guild or client the mention is shown with. It looks the command up where the reader can use it: the target's guild first, then the global commands. The IDs come from the bot's own registration, or from one request per scope on its first mention, listed again when no scope holds it, so it works in a shard, with `commands.register: false`, and for commands `meocord register` sent. A path the app doesn't declare is a `RangeError`; a command that isn't registered where the reader is, or a mention before the bot is ready, is an `Error` that says what to do. A scope whose listing fails, such as a guild the bot lost access to, doesn't stop a mention the global scope resolves; if none does, the `Error` names the failure.

In tests, a testing module answers from the commands its controllers declare, with a fixed ID per command and no request; `MeoCordTestingModule.create({ … }).overrideCommandId(name, id)` sets one. See [Formatting](https://meocord.dev/docs/4.3/formatting).
