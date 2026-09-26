---
'meocord': patch
---

Stack traces name your source files, lines and columns on Node and Bun, in development and production. `meocord start` runs node with `--enable-source-maps`, and its shard processes inherit it. A bundle started any other way, such as `node dist/main.js` in a Docker `CMD` or under Bun, which applies no source map to a bundle, maps its stacks from `dist/main.js.map` through `Error.prepareStackTrace`.

- The map is read the first time a stack needs it. Each frame keeps the runtime's format, `at fn (/abs/path/src/file.ts:line:col)`.
- A hook already set on `Error.prepareStackTrace` receives the mapped call sites.
- On minified Bun builds, a frame for a call can land one line above it.

Under Bun, development traces had pointed into `dist/main.js` since 4.1.0-beta.4 dropped the eval devtool, and production traces always did without the Node flag.

Set `sourceMappedStacks: false` in `meocord.config.ts` for an error tracker that applies uploaded source maps to the bundle's positions. See [Stack traces](https://github.com/meocord/meocord/blob/main/README.md#stack-traces).
