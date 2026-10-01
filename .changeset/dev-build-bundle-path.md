---
'meocord': patch
---

A development build (`meocord build --dev`) started by a process manager such as pm2 now finds what sits beside its bundle: its compiled `meocord.config.mjs`, its asset imports, and the script its shards start from. It looked for them beside the script the process was started with, which under pm2 is pm2's own wrapper, so the config read `undefined`, asset paths pointed into pm2's directory, and process sharding spawned the wrapper. A production build already went by the bundle itself; a development build now does too.
