---
'meocord': patch
---

A reaction in a DM the bot has not cached since it started reaches its handlers again. From discord.js 14.26.2, discord.js makes a channel it has not cached from a gateway event only when the event says the channel is a DM, and a reaction's event names its channel by id alone, so such reactions were dropped before any listener saw them, even with `Partials.Channel`. With the `DirectMessageReactions` intent, MeoCord now fetches that DM channel once, on its first reaction, and hands the reaction back to discord.js, which delivers it to `@ReactionHandler` and to your own `messageReactionAdd` and `messageReactionRemove` listeners alike. Later reactions in that DM need no request, and a reaction discord.js delivers itself is left alone. One window remains: a DM reaction that arrives before the gateway is ready, in the seconds while discord.js waits for the bot's servers, is replayed by discord.js later without a raw event, so it is still dropped.
