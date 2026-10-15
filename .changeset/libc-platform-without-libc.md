---
'meocord': patch
---

A build with `bundleDependencies` on macOS or Windows no longer packs an installed package that declares a `libc` field. npm skips such a package on a platform with no C library to choose, and so does MeoCord now, whatever the field names. On Linux, a runtime that can't report its C library still keeps the package.
