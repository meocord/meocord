---
'meocord': patch
---

A `bundleDependencies` build starts under Bun, and under any devtool.

- **Bun.** A bundled ES module that probes for CommonJS, as lodash-es does with `typeof exports`, left `module` and `exports` in the bundle's top scope. Bun then read the whole bundle as CommonJS and stopped at startup with `Cannot use import statement with CommonJS-only features`, while Node ran it. Those probes now see `undefined`, as they do in any ES module, so `bun dist/main.js` starts. CommonJS dependencies keep their own `module` and `exports`. Rebuild to pick this up; nothing else changes.
- **Eval devtools.** An `eval-*` devtool, set through `output.sourceMap` or `tools.rspack` in the `rsbuild` hook, is built as its non-eval equivalent (`eval-source-map` as `source-map`, plain `eval` as no source map), with a warning at build time. A module evaluated from a string cannot read `import.meta`, so with `bundleDependencies` such a bundle stopped at startup with `SyntaxError: import.meta is only valid inside modules`. To silence the warning, set `output.sourceMap.js` to the non-eval devtool yourself.
- Development builds emit `cheap-module-source-map` rather than `eval-source-map`. See [Smaller changes](https://meocord.dev/docs/4.1/migrating#smaller-changes) in the upgrade guide.
