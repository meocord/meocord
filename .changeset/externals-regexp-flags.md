---
'meocord': patch
---

An `externals` pattern with the `g` or `y` flag, such as `/^@aws-sdk\//g`, now keeps every matching import out of the bundle. A flagged pattern's `test` resumes from where its last match ended, so every other request for a matching package was bundled after all, and `meocord build`'s warning about an `optionalExternals` entry also listed in `externals` missed every other name. MeoCord now tests a pattern through a copy of its own, from the start of each request, so a `y` pattern still matches only at the start of a request, as Rsbuild tests it.
