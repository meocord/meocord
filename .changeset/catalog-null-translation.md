---
'meocord': patch
---

`expectCompleteCatalog` now reports a translation that is `null`, as tools export an untranslated string, as missing, where it threw `TypeError: Cannot convert undefined or null to object`. The translator already reads such a message as missing and falls back, so the check now agrees with it, for a message and for a whole group given as `null`. A `null` translation the default catalog lacks is reported as not in the default catalog, as an empty one is. Numbers and flags in a catalog are read as before.
