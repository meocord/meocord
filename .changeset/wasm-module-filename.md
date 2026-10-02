---
'meocord': patch
---

A bot that imports two or more WebAssembly modules builds again. Each imported module is written to `dist/assets` under a content hash, as `<hash>.module.wasm`. A wasm file read through `new URL('./file.wasm', import.meta.url)` keeps its own name.
