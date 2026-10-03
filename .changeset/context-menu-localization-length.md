---
'meocord': patch
---

Registration checks localised command names by Discord's own rules, naming any it would reject, so registration no longer fails with error 50035:

- A localised name over 32 characters is refused for a user or message context menu or an entry point command, as for slash commands, where up to 100 was let through. Choice names keep their limit of 100.
- A localised slash command or option name takes the apostrophe Discord allows, `ʼ` (U+02BC), and refuses the ASCII `'`, which it let through.
