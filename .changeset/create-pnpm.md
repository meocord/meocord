---
'meocord': patch
---

`meocord create --use-pnpm` makes an app that installs and passes its own checks on pnpm, 10 and later.

- pnpm 11 and later refuse to install while a dependency's build script is neither allowed nor denied, so `create` stopped at "Failed to install dependencies" with `ERR_PNPM_IGNORED_BUILDS` for `@swc/core` and `unrs-resolver`. An app created for pnpm now has a `pnpm-workspace.yaml` that leaves both scripts off under `allowBuilds`: each only checks the native binding pnpm installs for your platform, and fetches a fallback without it. An app created with npm, yarn or bun gets no such file.
- The app declares `reflect-metadata` and `@types/node`, which its test setup imports and its tsconfig names. npm and bun hoist them from other packages, but pnpm links only what `package.json` declares, so on pnpm 10 the app's `lint` and `test` failed.

An app created for pnpm before this gets the same fix by adding both packages to its `devDependencies`, and on pnpm 11 or later this `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  '@swc/core': false
  unrs-resolver: false
```
