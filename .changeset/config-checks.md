---
'meocord': patch
---

`meocord start --dev` checks a saved `meocord.config.ts` as startup does: a config with options of the wrong type, or one that fails to load, is reported once, with every problem, and the running bot is left as it is, rather than starting with that config and failing later. A config that exports only named values is refused with "it must export an object as its default export", naming what it exports, instead of a warning for each export. A config that throws as it loads, such as for a variable it requires, is reported with the line in `meocord.config.ts` it threw at, and a built bot whose config throws says to check the environment it reads, rather than to rebuild.
