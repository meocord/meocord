---
'meocord': minor
---

MeoCord asks for `discord.js` 14.27.0 or later and `dotenv` 18.0.5 or later as peers. A bot on an older `discord.js` 14 or `dotenv` 18 upgrades them with MeoCord: `npm install discord.js@^14.27.0 dotenv@^18.0.5`, or the same with your package manager.

MeoCord's own dependencies move to their latest stable releases, and `meocord create` makes the new app's first commit by running `git` directly, so installing MeoCord no longer pulls in `simple-git`. A new app starts on the latest stable releases of its tools, with TypeScript held at 6.0.3.
