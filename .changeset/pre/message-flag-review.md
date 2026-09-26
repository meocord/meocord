---
'meocord': patch
---

A message pattern's flag must start with a letter: `{--2fa}` or `{--_x}` stops the bot at startup with a message saying so, since a message's `--2fa` is read as a word and the flag could never be given. A rest param with flags taken out keeps its own spacing and line breaks: `say {text...} {--loud}` with "one\n--loud\ntwo" gives "one\ntwo", where the flag's surroundings were joined by a single space.
