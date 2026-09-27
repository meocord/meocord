---
'meocord': patch
---

`module.invoke()` checks an interaction's customId against every handler of the testing module, ranked as dispatch ranks them, as it already did for a message. A customId dispatch gives to another handler, such as `card/summary` beside `card/{id}`, rejects naming the handler that runs, where it ran the named handler anyway. A handler declared under two patterns gets the params of the one dispatch picks, so `card/5` gives `{ id: 5 }` for `card/{id:int}` beside `card/{id}`, where it could give the text `'5'`. Handlers of sibling subclasses that share an inherited pattern, which the bot refuses beside each other, can each still be invoked in one module.
