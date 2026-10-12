---
'meocord': patch
---

Startup now warns when `clientOptions.partials` lacks a partial that discord.js needs to deliver an `@On` handler's event about something the bot hasn't cached. Without it, discord.js drops the event and the handler never runs:

- `messageReactionRemoveEmoji` needs `Partials.Message` as well as `Partials.Reaction`;
- `guildMemberRemove` and `guildMemberUpdate` need `Partials.GuildMember` (without it, an uncached member's update arrives as `guildMemberAvailable`);
- `messagePollVoteAdd` and `messagePollVoteRemove` need `Partials.Message`, `Partials.Poll` and `Partials.PollAnswer`;
- `guildScheduledEventUserAdd` and `guildScheduledEventUserRemove` need `Partials.User`.

If you see one of these warnings, add the partials it names to `clientOptions.partials`. The warnings about `Partials.GuildMember`, `Partials.Poll` and `Partials.PollAnswer` say these events are about members or polls the bot has not cached. The existing warnings keep their wording.
