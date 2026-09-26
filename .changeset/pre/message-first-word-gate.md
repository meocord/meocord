---
'meocord': patch
---

A message after a prefix whose first word names no command is no longer split into words, so an unknown command costs dispatch about 40% less. A message naming a command with flags is split once instead of twice.
