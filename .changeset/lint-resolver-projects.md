---
'meocord': patch
---

`bun run lint` in an application prints nothing when the code is clean. `meocord/eslint` gives its import resolver the application's three tsconfigs, so each file resolves aliases through the tsconfig that includes it, and the resolver printed `Multiple projects found, consider using a single tsconfig with references…` on every run. It now sets the resolver's `noWarnOnMultipleProjects`, since several projects are the intended setup. Existing applications get it by updating meocord; nothing in them changes.
