---
'meocord': minor
---

The built-in help reads what joins its lists from two new MeoCord texts: `meocord.help.listJoiner`, a comma and a space, joins a command's aliases, and `meocord.help.paramJoiner`, a middle dot with a space on each side, its params. A catalog that translates `meocord.help` can write them as its language writes a list, such as `、` in Chinese or Japanese. A catalog without them shows the help as before. `expectCompleteCatalog(t, { meocord: true })` lists both as missing in a locale that doesn't translate them. See [Localisation](https://meocord.dev/docs/4.3/localisation).
