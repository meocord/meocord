---
'meocord': patch
---

A `number` or `duration` message param, and a `number` customId segment, now read a word in time linear in its length. A long run of digits that isn't a number or a duration, such as a message of 4,000 digits ending in `x`, took time growing with the square of its length to refuse, about 20–30 ms at 4,000 characters and more for each optional typed param it was tried against. The words each type accepts and the values they give are unchanged, so there is nothing to update.
