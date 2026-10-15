---
'meocord': patch
---

More of what Discord always sends now reads as discord.js gives it on mocks from `meocord/testing`, in both modes unless noted:

- **A component interaction made without a `message`** has one: the bot's message in the interaction's channel, holding the button or menu that was used. So `interaction.message.edit()` and `delete()` resolve, and `interaction.component` is that component, which discord.js finds by its customId. Before, `message.edit` was not a function.
- **A modal submit made without `fields`** has none. `fields.getTextInputValue()` throws discord.js's not-found error, and `components` is empty.
- **A member's `joinedTimestamp` and a client's `readyTimestamp`**, under `useStrictMocks()`, are stamped when the mock is made, so time a test advances afterwards counts. In default mode they are still stamped at the first read, with a warning once.
- **A channel's or thread's `guildId` and `guild` agree.** A thread given a guild reads its id. Under `useStrictMocks()`, a channel or thread given only a `guildId` is in a server with that id.
- **Every channel class has its `type`**, including stage, category, directory and group DM channels, so `isVoiceBased()`, `isDMBased()` and the other guards answer as discord.js does.
- **A member's `displayColor` and `displayHexColor`, and its roles' `color`, `hoist` and `icon`,** are computed from its roles. Before, `new EmbedBuilder().setColor(member.displayColor)` threw.
