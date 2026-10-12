---
'meocord': patch
---

A `tsconfig.json` the CLI can't read, such as one whose `extends` names a package that isn't installed, is now reported as `tsconfig.json could not be read`, with the reason. It was reported as `meocord.config.ts could not be loaded`, which pointed at the wrong file. Watch mode reports it the same way and keeps watching.
