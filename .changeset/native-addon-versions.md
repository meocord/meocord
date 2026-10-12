---
'meocord': patch
---

With `bundleDependencies`, a native addon that bundled code imports from two installed copies, such as `natpkg@1` at the top of `node_modules` and `natpkg@2` nested under a package that needs it, is now named in a build warning: each copy's version and place, the one that is packed, and how to install one version. A self-contained build packs one copy of a native package, and every importer loads it, so code that needs the other version silently got this one. The build still succeeds; the next major version (5.0) stops it here.
