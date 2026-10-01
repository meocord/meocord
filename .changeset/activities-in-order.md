---
'meocord': patch
---

`@MeoCord({ activities })` now cycle in order, as documented: the first is shown once the bot is ready, then the next every 10 seconds, starting again after the last. 4.0 picked one at random each time, so the same activity could show several times in a row.
