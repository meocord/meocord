---
'meocord': patch
---

Message command params, flags and customId segments look up param types and booleans in tables with no inherited keys. A word such as `constructor` or `toString` is now an invalid `bool` value, answered with the usage like any other wrong word. A `{name:type}` whose type is such a name is refused at startup as naming no type, whether or not the app adds its own `messages.types`. An app type is matched only by a name the app gave it.

`route().build()` reads a param's value and type by the param's own name, so a param named `constructor` or `toString` builds from the value given, and asks for one when none is.
