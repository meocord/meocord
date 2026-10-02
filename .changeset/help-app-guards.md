---
'meocord': patch
---

The built-in help, and the list of subcommands a parent command with no handler of its own answers, now run the app's `@MeoCord({ guards })` first, as a command does. A guard that returns `false` leaves the message unanswered, and one that throws `GuardDeniedError` gets its reason as the reply, as a denied command does. They answered whatever the app's guards decide, so a bot its guards close in a channel, or to a user, still answered help there.
