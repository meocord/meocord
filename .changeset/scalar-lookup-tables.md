---
'meocord': patch
---

Message command params, flags and customId segments look up param types and booleans in tables with no inherited keys. A word such as `constructor` or `toString` is now an invalid `bool` value, answered with the usage like any other wrong word. A `{name:type}` whose type is such a name is refused at startup as naming no type, whether or not the app adds its own `messages.types`. An app type is matched only by a name the app gave it.
