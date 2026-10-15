---
'meocord': patch
---

One method with `@Command`s of two interaction types, such as a slash command and a button, runs for each of its routes with that route's interaction. Each `@Command` checked the interaction against its own type alone, so the method threw on every route and never ran. A direct call with an interaction of none of its types still throws, now naming every type its routes take.
