---
'meocord': patch
---

A bot without `activities` keeps the presence it sets. MeoCord rotated through `activities` every 10 seconds whether or not any were set, and with none it cleared the bot's activity each time, so a status set in `onReady`, in `clientOptions.presence` or by a command disappeared 10 seconds after ready, and an empty presence update was sent every 10 seconds. Now MeoCord touches the presence only when `activities` lists some, and shows one as soon as the bot is ready rather than 10 seconds later.
