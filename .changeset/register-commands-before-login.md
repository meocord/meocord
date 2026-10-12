---
'meocord': patch
---

`app.registerCommands()` called before the bot is online now logs a warning saying why it registers nothing, where it resolved silently. It still registers nothing and never throws, so code that calls it keeps working. The bot registers its commands on its own once it is online; to push them from a script without logging in, run `meocord register`. With process sharding, the manager's `registerCommands()` registers over REST before or after `start()`, as before.
