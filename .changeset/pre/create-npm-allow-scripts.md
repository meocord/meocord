---
'meocord': patch
---

`meocord create --use-npm` makes an app that npm 11.16 and later install without the `allow-scripts` warning. Those versions list every dependency install script your `package.json` neither allows nor denies, and a new app listed `@swc/core`, `unrs-resolver` and, on macOS, `fsevents`. An app created for npm now denies all three under `allowScripts`:

- `@swc/core` and `unrs-resolver` load the native binding npm installs for your platform. Their scripts check that binding and, only where it fails to load, fetch a fallback: `@swc/core`'s installs `@swc/wasm`, which `@swc/core` itself does not load, and `unrs-resolver`'s downloads the binding npm installs anyway.
- `fsevents` ships its binary prebuilt. Its script rebuilds it from source, which fails because the package has no build files, so npm left the optional `fsevents` out. Denied, it is installed with its prebuilt binary.

npm before 11.16 ignores the field. An app created with pnpm, yarn or bun gets no `allowScripts`.

An app created for npm before this gets the same by adding to its `package.json`:

```json
"allowScripts": {
  "@swc/core": false,
  "fsevents": false,
  "unrs-resolver": false
}
```
