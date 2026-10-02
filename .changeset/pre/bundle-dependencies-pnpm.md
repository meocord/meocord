---
'meocord': patch
---

`bundleDependencies` packs every package a bot needs into `dist/node_modules`, each with the dependency versions it was installed with, from a pnpm project as from npm, yarn and bun.

- A package listed in `externals` or `optionalExternals` was packed without the packages it depends on, in a pnpm project. pnpm keeps those beside the package in its store, not in your project's `node_modules`, so they were left out, and the bot failed at startup with "Cannot find module". They're packed now.
- A native package that ships its binary as a per-platform package, as napi-rs packages do, is recognised as native in a pnpm project and packed with that binary, whether you list it in `externals` or the bot imports it. Before, a listed one was packed without its binary, and an imported one stopped the build, asking for it in `externals`.
- Each packed package loads the version of each dependency it was installed with. When packages need different versions of one package, the first stays at the top of `dist/node_modules`, and each other version is nested where Node, resolving from the package that needs it, finds it first. Before, every package got the first.
- A package npm nested under another, because another version of it holds the top of `node_modules`, is packed with the packages it needs from the top. Before, they were left out, and the bot failed at startup with "Cannot find module".

Rebuild to pick these up.
