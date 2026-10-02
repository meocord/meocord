---
'meocord': patch
---

`createChatInputOptions` reads each option by its type, as discord.js does: a getter of another type, such as `getString()` on a number or `getChannel()` on a user, throws discord.js's type error, such as `Option "x" is of type: 4; expected 3.`, with or without `required`. A user or member read as a role, or a role read as a user or member, is `null`, or that error when `required`, as the option may be a mentionable one. Options assigned to a mock interaction after it is created, as with `interaction.options = createChatInputOptions({ target })`, belong to it, so `getMember()` is the server's cached member, or `null` in a DM.
