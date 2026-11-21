---
'meocord': patch
---

A call is themed for the server its event names when the server is given as itself, after another value, or as the new value of an update whose old value was not cached. `@On` and `@Once` handlers for `guildCreate`, `guildUpdate`, `guildDelete` and the other events given a `Guild`, events given a server or a channel after a collection (`guildMembersChunk`, `messageDeleteBulk`, …), `threadMemberUpdate`, poll votes, and updates such as `presenceUpdate` with no cached old value now get `themeFor.guild`'s theme, as do functions `bindTheme` wraps when called with them. Before, they ran with no server's theme, and a bound function kept the theme of the call that bound it. A value from a direct message names no server, whether its `guildId` or its message's `guildId` is `null` or it is a direct message's channel or poll, so a later argument does not theme the call. See [Theming](https://meocord.dev/docs/4.3/theming#collectors-and-listeners).

An update whose old value was not cached also gets its new value's user, as it does when the old value is cached: a `presenceUpdate` is themed for its user's `themeFor.user` theme.
