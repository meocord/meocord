---
'meocord': patch
---

`meocord start --dev` runs one bot at a time. A build that finished while the previous bot was still shutting down, which happens when the watcher reports one change twice or a file changes again during a slow `onShutdown`, started a second bot at once, alongside the one stopping. Once that one exited, a third started. The second was left running and connected to Discord, and a restart or Ctrl+C no longer reached it. Now builds that finish during a restart start a single bot from the latest build, once the previous one has exited, and a Ctrl+C during a restart waits for the stopping bot and starts nothing.
