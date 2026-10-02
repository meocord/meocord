---
'meocord': patch
---

`require('meocord/common')`, and every other entry point a CommonJS project loads with `require()`, logs again: `Logger`'s `log()`, `info()`, `verbose()` and `debug()` threw `TypeError` there, as the CommonJS build read `chalk`, a package that ships only as an ES module, without its default export. A bot built with `meocord build` was not affected, since its bundle loads the ES module build.
