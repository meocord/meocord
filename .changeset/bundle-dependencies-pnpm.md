---
'meocord': patch
---

`bundleDependencies` packs a pnpm project correctly. Before, a pnpm project using `bundleDependencies` was missing its dependencies' dependencies in `dist`.

- A package listed in `externals` or `optionalExternals` was packed without the packages it depends on. pnpm keeps those beside the package in its store, not in your project's `node_modules`, so they were left out. The bot then failed at startup with "Cannot find module". They're packed now.
- A native package that ships its binary as a per-platform package, as napi-rs packages do, was missing that binary, and wasn't recognised as native. Both are fixed.
- When two packed packages depend on different versions of one package, each gets the version it was installed with. The first stays at the top of `dist/node_modules`, and the other is nested under the package that needs it. Before, both got the first.

Rebuild to pick these up. npm, yarn and bun layouts pack as before.
