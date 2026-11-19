---
'meocord': patch
---

A production build made on a fresh install starts again. `@rspack/core` 2.3.2 minifies a class that names itself in a static field, such as `static instance = new Registry()`, into code that stops at startup with `ReferenceError: Cannot access '…' before initialization`. discord.js has such classes, so every self-contained build (`bundleDependencies`) stopped there, and so did an ordinary build of an app with such a class of its own. An app installed while `@rspack/core` 2.3.2 was current may hold it in its lockfile beside `@rsbuild/core` 2.3.0 to 2.3.2, so MeoCord now asks for `@rsbuild/core` 2.2, or 2.3.3 and later, which needs `@rspack/core` 2.3.3 or later, where the minifier keeps such a class working. Upgrading and installing is enough: the package manager moves both packages off the broken releases by itself.
