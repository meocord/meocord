---
'meocord': minor
---

A context menu handler can declare the kind of interaction its builder registers: `UserContextMenuCommandInteraction` for a builder that calls `setType(ApplicationCommandType.User)`, or `MessageContextMenuCommandInteraction` for `Message`. It had to take the union of both, since declaring one failed to compile with "Unable to resolve signature of method decorator". The union still works. A builder's kind is a value TypeScript cannot read, so the bot checks it as it starts: a handler that declares the other kind stops it, naming both.

`meocord g co context-menu <name>` generates a user context menu command with its handler typed to match, and `--message` generates a message one. The context menu controller in a new project is typed the same way.
