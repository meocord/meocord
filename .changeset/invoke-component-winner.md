---
'meocord': patch
---

`module.invoke()` checks an interaction's customId against every handler of the testing module, ranked as dispatch ranks them, as it already did for a message. A customId dispatch gives to another handler, such as `card/summary` beside `card/{id}`, rejects naming the handler that runs, where it ran the named handler anyway. A handler declared under two patterns gets the params of the one dispatch picks, so `card/5` gives `{ id: 5 }` for `card/{id:int}` beside `card/{id}`, where it could give the text `'5'`. A testing module whose controllers would stop the bot, such as two whose patterns match the same customIds, now makes `invoke` throw the same startup error with a customId, as `dispatch` already did; give each such controller its own module.
