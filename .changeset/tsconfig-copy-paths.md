---
'meocord': patch
---

`meocord build` and `start` now read the project's `tsconfig.json` as `tsc` does, so a project `tsc` compiles builds too:

- **On Windows, a `tsconfig.json` with `extends` builds.** Any `extends`, a file beside it or a package, failed with `Tsconfig not found`. The copy of the tsconfig MeoCord hands the bundler now has the files it extends merged in, and names none.
- **`extends` naming a package**, such as `"@tsconfig/node22"`, finds the package's `tsconfig.json`, or the file its `package.json`'s `tsconfig` names, rather than the file its `main` names; `"pkg/strict"` finds `strict.json`, and a subpath the package's `exports` maps, as `@total-typescript/tsconfig` does, finds the file it maps to. A package with no `main` failed with `Tsconfig not found`.
- **`${configDir}`** in `baseUrl`, the project's own or one an extended config declares, stands for the project. Only `include`, `exclude` and `files` read it, so an import through a `"${configDir}/src"` `baseUrl` couldn't be resolved.
- **`references`** name their projects from the project, as `tsc` does. They pointed beside the copy MeoCord writes in the temp directory, and the build failed with `Tsconfig not found`.

The build no longer resolves imports through a referenced project's own tsconfig: with references on, Rspack resolves the root project's files without its `paths` and `baseUrl`, so a bot that references another project couldn't build at all. A file inside a referenced project now resolves through the root `tsconfig.json`'s `paths`, not its own.
