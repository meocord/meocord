---
'meocord': patch
---

The built-in `help` reply over 2,000 characters is now split into messages Discord shows as written:

- A line longer than a message is cut after the last whole character that fits. An emoji, a flag, a joined emoji or a letter with its accent is no longer split across two messages.
- A message that would be only whitespace isn't sent. Discord refused it as empty, and the rest of the reply was lost with it.

A help text with no long line and no blank stretch at a cut is split as before.
