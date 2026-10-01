---
'meocord': patch
---

`meocord start --dev` restarts the bot through the bot's own stop, the one SIGINT and SIGTERM run, on every platform. On Windows, a restart used to end the bot outright, so its `onShutdown` hooks never ran on a save, and whatever they release or flush was left as it was. The dev runner now asks the bot to stop over the channel it already gives it, and the bot shuts down as it does on Ctrl+C, before the new build starts. A bot that doesn't exit within its `shutdownTimeout` and a short grace period is still killed, as before. Rebuild to pick this up.
