---
'meocord': patch
---

In a process that loads both builds of meocord, an app that logs in now clears the exit code an earlier failed login set, whichever build started each app, and `meocord start --dev` is told the bot is online again.
