---
'meocord': patch
---

`messages.dmOnCooldown` now DMs an author once per wait, as documented, however often they retry within it. The notice was counted over the wait left at each refusal, which shrinks with every retry, so it expired halfway through: an author retrying every second during a 60-second wait got six DMs (at 1, 31, 46, 53, 57 and 59 seconds), and about twelve in an hour-long one. Each wait now has a notice of its own, kept for the cooldown's full window.
