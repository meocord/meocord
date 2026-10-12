---
'meocord': patch
---

The CLI reads a `tsconfig.json` or `package.json` saved with a UTF-8 byte order mark, as Windows editors and PowerShell's `-Encoding UTF8` write one, and as Node, npm and tsc already read. `meocord build` stopped with "Could not parse tsconfig.json", and `build`, `start` and `register` exited 1 on such a `package.json`. A native addon's platform package whose `package.json` has one is now judged by its `os`, `cpu` and `libc` fields when `bundleDependencies` packs it, rather than kept whatever its platform.
