---
'meocord': minor
---

`meocord/common` exports discord.js's formatters under their own names, so a bot imports its formatting from one place: `userMention`, `channelMention`, `time` with `TimestampStyles`, `bold`, `codeBlock`, `escapeMarkdown` and the rest, 44 functions and constants and 4 types. They are your own discord.js's functions, not copies: `userMention` from `meocord/common` is `userMention` from `discord.js`, so code that imports them from discord.js keeps working, and their documentation is discord.js's. `version` and the deprecated `underscore` aren't exported. A new app's sample button replies with `userMention(ownerId)`. See [Formatting](https://meocord.dev/docs/4.3/formatting).
