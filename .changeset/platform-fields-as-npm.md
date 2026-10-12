---
'meocord': patch
---

With `bundleDependencies`, a dependency's `os`, `cpu` and `libc` fields are read as npm reads them when MeoCord decides which platform builds to pack into `dist`. A field written as a string, such as `"os": "win32"`, admitted every platform, so a Windows-only build was packed on Linux; and `["any"]` admitted none, so a package declaring `"cpu": ["any"]` was left out of `dist` and missing when the bot started.
