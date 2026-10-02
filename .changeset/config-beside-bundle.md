---
'meocord': patch
---

A built bot finds its config beside its bundle, wherever it's started from. Before, it looked in `dist` under the working directory, so a bot started from elsewhere failed with "MeoCord config not found … Run `meocord build`", even with a fresh build. That covered pm2 without `cwd`, a systemd unit without `WorkingDirectory`, and `cd dist && node main.js`.

When the config really is missing, the message names the file it looked for and the working directory. When the file is there but fails to load, the message says so, gives the reason and says what to do: install the package it names when one is missing, naming the installed package that imports it if the config does not import it itself, or fix `meocord.config.ts`, then run `meocord build`.

`.env` is still read from the working directory, through `dotenv` in your `meocord.config.ts`. If you start the bot from elsewhere, set its environment there or point `dotenv` at the file.

The check that refuses a build made for another platform also reads its record beside the bundle. It now applies when a process manager's wrapper starts the bot.

A development build (`meocord build --dev`) does the same, also when a process manager such as pm2 starts it through its own wrapper: its config, its asset imports and the script its shards start from are all found beside its bundle.

Rebuild to pick these up.
