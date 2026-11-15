---
'meocord': patch
---

A production build made on a fresh install starts again. `@rspack/core` 2.3.2 minifies a class that names itself in a static field, such as `static instance = new Registry()`, into code that stops at startup with `ReferenceError: Cannot access '…' before initialization`. discord.js has such classes, so every self-contained build (`bundleDependencies`) stopped there, and so did an ordinary build of an app with such a class of its own. Every `@rsbuild/core` 2.3 release installs that `@rspack/core`, so MeoCord now asks for `@rsbuild/core` 2.2. Upgrading and installing is enough: the package manager moves the bundler back to 2.2 by itself.
