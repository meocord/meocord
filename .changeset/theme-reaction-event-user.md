---
'meocord': patch
---

`@On('messageReactionAdd')` and `@On('messageReactionRemove')` handlers now run with the reacting user's `themeFor.user` theme over the server's, as a `@ReactionHandler` for the same reaction does. They ran with the server's theme only, and the `user` resolver wasn't asked. Any other event whose second argument is a discord.js `User`, such as `guildScheduledEventUserAdd` or `userUpdate`, gets that user's theme the same way. Nothing to change in your code; a listener that answers in the user's colours now gets them. See [Theming](https://meocord.dev/docs/4.2/theming).
