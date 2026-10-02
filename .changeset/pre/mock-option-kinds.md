---
'meocord': patch
---

`createChatInputOptions` reads options as discord.js does, and throws discord.js's own errors: each a `DiscordjsTypeError` with discord.js's code and message.

- A getter of another type throws discord.js's type error, such as `Option "x" is of type: 4; expected 3.`, with or without `required`: `getString()` on a number, `getInteger()` on a fraction, `getChannel()` on a user. A user or member read as a role, or a role read as a user or member, is `null`, or that error when `required`, as the option may be a mentionable one.
- A missing required option throws `Required option "x" not found.`, `getSubcommand()` throws `No subcommand specified for interaction.` unless given `false`, as in discord.js, `getSubcommandGroup(true)` and `getFocused()` throw discord.js's messages, and `getChannel()` checks the channel types it's given.
- `get()` returns the option as discord.js does, and `getMessage()` reads no option of a slash command.
- Options assigned to a mock interaction after it is created, as with `interaction.options = createChatInputOptions({ target })`, belong to it, so `getMember()` is the server's cached member, or `null` in a DM.
