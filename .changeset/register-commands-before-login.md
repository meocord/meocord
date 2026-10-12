---
'meocord': patch
---

`app.registerCommands()` called before the bot is online now logs a warning instead of resolving silently: `registerCommands() registers nothing before the bot is online, as Discord names the application at login. The bot registers once it is online; to register without logging in, run `meocord register`.` It still registers nothing and never throws, so code that calls it keeps working. The bot registers its commands on its own once it is online; to push them from a script without logging in, run `meocord register`. With process sharding, the manager's `registerCommands()` registers over REST before or after `start()`, as before.
