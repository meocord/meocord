---
'meocord': patch
---

`meocord.config.ts` and the build read `tsconfig.json`'s `paths` as `tsc` does, whatever TypeScript version the project uses: paths inherited through `extends`, paths relative to `baseUrl`, and `${configDir}` in `paths`, `include`, `exclude` and `files`. A config that imports through such a path now loads, rather than failing with "Cannot find module", and a `${configDir}` path no longer breaks the build.
