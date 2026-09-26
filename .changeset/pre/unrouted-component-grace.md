---
'meocord': patch
---

A click a discord.js collector takes is no longer answered "Command not found!". A button, select menu or modal submission no `@Command` route matches was answered at once, before a collector's `collect` callback or `awaitModalSubmit` could answer it, so the user saw "Command not found!" and the collector's own answer failed as already sent. While anything besides MeoCord listens for the client's interactions, such an interaction is now left to it for 1.5 seconds, and "Command not found!" and its warning come only if nothing has answered it by then. A bot with no other listener, and a command no handler takes, are answered at once as before. In a testing module, `dispatch()` does the same for the client of the interaction it is given. Observers are told of such an interaction only when nothing answered it, as `'not-found'`; a click a collector answered is the collector's, and is not reported.
