---
'meocord': patch
---

`meocord.config.ts` and the build read `tsconfig.json`'s `paths` as `tsc` does, with the project's own TypeScript: paths inherited through `extends`, paths relative to `baseUrl`, and `${configDir}` in `paths`, `include`, `exclude` and `files`. A config that imports through such a path now loads, rather than failing with "Cannot find module", and a `${configDir}` path no longer breaks the build. A project without `typescript` installed keeps reading the paths its own `tsconfig.json` declares.
