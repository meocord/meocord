---
'meocord': patch
---

The startup check now names a `@MessageHandler` with `scope: 'dm'` that can never receive a DM. A DM reaches the bot only with the `DirectMessages` intent, and only with discord.js's `Partials.Channel`, since no DM channel is cached after the bot starts. The generated app's client options have neither, so a DM-only command added to it never ran, and nothing said why. The warning names the handler and what is missing. A command for servers, or for both, gets no new warning.
