---
'meocord': minor
---

A self-contained build (`bundleDependencies`) packs every installed copy of a native addon that bundled code imports, and each importer loads its own. With `natpkg@1` at the top of `node_modules` and `natpkg@2` nested under `wrap`, which needs it, `wrap` now runs against `natpkg@2` from `dist` alone, where the build packed only `natpkg@1` for everyone and warned.

The copy your project's root resolves to keeps its place at the top of `dist/node_modules`; under npm, that is the copy npm hoisted to the top of `node_modules`. With none there, the copy your project's dependencies reach in the fewest steps takes it, the first by name on a tie, so the order the bundler meets imports in doesn't change which. Each other copy is packed with its own dependencies under `dist/node_modules/.meocord/<name>-<version>-<hash>/`, the hash taken from the chain of dependencies that reaches it from your project, such as `wrap>natpkg`, so the same installed tree, as a lockfile fixes it, builds the same `dist` on any machine, and under pnpm the same with its store inside the project or outside it. Its importers load its entry file from there, picked by the bundler as it resolved the import, the `exports` conditions of an `import` or a `require` and subpaths included. pnpm's links to one store copy count as one copy. When the other copy has no file for the request, for example an `exports` with no entry for `require`, the build stops and names the copy and the request.

A project with one copy of each native addon builds exactly as before. See [Self-contained builds](https://meocord.dev/docs/4.3/self-contained-builds).
