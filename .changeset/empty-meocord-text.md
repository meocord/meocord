---
'meocord': patch
---

An empty translation of one of MeoCord's own texts reads as missing, as an empty translation of the app's own message already does: the text falls back down the locale's chain to MeoCord's English. With `meocord.fallback.error` left empty in a locale, as translation tools export a string nobody has translated yet, a failing command in that locale went unanswered, and `translateError` returned `""`; it is now answered in English.
