---
'meocord': patch
---

An asset import resolves beside the bundle, wherever `dist` is run from. `import logo from './logo.png'` gave the absolute path of the folder the build ran in. So a `dist` built in CI, on a laptop and then copied to a server, or in an image stage with another `WORKDIR`, read its assets from a path that wasn't there, and failed with ENOENT at the first attachment. The path is now set when the bot starts, from the bundle's own location. It's still an absolute path on disk, now the right one. Rebuild to pick this up.
