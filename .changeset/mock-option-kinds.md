---
'meocord': patch
---

`createChatInputOptions` reads each entity option only as its own kind: `getRole()` on a user option is `null`, not the user, and with `required` it throws discord.js's `Option "…" is of type: 6; expected 8, 9.`. The same holds for `getUser()`, `getMember()`, `getChannel()` and `getMentionable()`. Options assigned to a mock interaction after it is created, as with `interaction.options = createChatInputOptions({ target })`, belong to it, so `getMember()` is the server's cached member, or `null` in a DM.
