---
'meocord': patch
---

A flag before a command's first word, as in `!--bots purge 5`, is never read, and the message names no command. Before, such a message ran `purge` whenever some other handler's pattern with flags began with a param, such as `{target} {--ping}`, so whether it matched depended on unrelated handlers. A pattern that begins with a param still takes its flags anywhere.
