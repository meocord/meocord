---
'meocord': patch
---

The CLI clears the screen only where it helps: as `meocord start --dev` begins, in a terminal. `meocord build` and `meocord start --prod` no longer clear it, so the output of the commands before them, such as a failing test run, stays on screen. No command writes escape codes into piped output any more, such as CI logs, `docker logs`, pm2 or systemd. When `start --dev` clears, it keeps your scrollback.

A build's output no longer lists the temporary folder the config is compiled in. The line after it still says where the config went.
