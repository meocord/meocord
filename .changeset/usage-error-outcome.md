---
'meocord': patch
---

An observer is told a message command's usage error as `'invalid'`, the user's input that doesn't fit, as it is told a `ValidationError`. It was told `'error'`, so metrics counted a user's typo as a fault of the bot. This covers a word of the wrong type, a param left out, a flag the command lacks, a command sent where it doesn't work, and a parent's words alone, answered with its subcommands. A dashboard that counts `'error'` sees these under `'invalid'` from this release.
