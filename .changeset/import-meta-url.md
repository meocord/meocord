---
'meocord': patch
---

In a built bot, `import.meta.url` names the running bundle in `dist`, as `import.meta.dirname` and `import.meta.filename` already do. It named the source file on the machine that built the bot, so code finding its files from it worked only there, and the bundle carried the build machine's source path. `new URL('./file', import.meta.url)` assets keep resolving beside the bundle, and `import.meta.env.MODE` is still written in.
