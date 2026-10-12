---
'meocord': patch
---

A bot built with `bundleDependencies` now registers its commands in the mode the `meocord` command runs in. The bundle has `process.env.NODE_ENV` written in as the mode it was built in, MeoCord's own reads included, so after `meocord build --prod`, `meocord register --dev` registered every command globally instead of to `commands.developmentGuild`, and after `build --dev` a plain `meocord register` or `start --prod` registered to the development guild. The CLI now tells the bot the mode in a variable of its own. A bot started without the CLI registers as before.
