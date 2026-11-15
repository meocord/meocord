---
'meocord': patch
---

A self-contained build (`bundleDependencies`) made on a fresh install starts again. `@rspack/core` 2.3.2 minifies the bundled discord.js into code that stops at startup with `ReferenceError: Cannot access '…' before initialization`, and every `@rsbuild/core` 2.3 release installs it, so MeoCord now asks for `@rsbuild/core` 2.2. Upgrading and installing is enough: the package manager moves the bundler back to 2.2 by itself.
