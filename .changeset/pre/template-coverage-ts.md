---
'meocord': patch
---

A new app's `test:coverage` reads files no spec imports. Coverage counts them as untested, and gets them as `file.ts?cache=…&vitest-uncovered-coverage=true`. The template's SWC plugin matched files by extension only, so it skipped those, and istanbul stopped with a syntax error on the first type annotation or decorator in one. The template now passes SWC an `include` that allows that query. For an existing app, see [Smaller changes](https://github.com/meocord/meocord/blob/main/docs/MIGRATING.md#smaller-changes).
