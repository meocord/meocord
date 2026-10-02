---
'meocord': patch
---

- **A bot that imports two or more WebAssembly modules builds again.** Each imported module is written to `dist/assets` under a content hash, as `<hash>.module.wasm`. A wasm file read through `new URL('./file.wasm', import.meta.url)` keeps its own name.
- **`new URL('./file', import.meta.url)` for a bundled file gives a `file:` URL on Windows.** It was built on the bundle's directory as a disk path, which a URL reads as scheme `c:`, so `fileURLToPath` threw `ERR_INVALID_URL_SCHEME`. The URL is now relative to the bundle on every platform.
