---
'meocord': patch
---

`bun run lint` in an application prints nothing when the code is clean: `meocord/eslint` gave its import resolver the application's three tsconfigs, and the resolver printed `Multiple projects found, consider using a single tsconfig with references…` on every run. It now reads `tsconfig.json`, which the other two extend, for the `@src/*` alias every file uses, specs included. Existing applications get it by updating meocord; nothing in them changes.
