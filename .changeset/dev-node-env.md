---
'meocord': patch
---

`meocord start --dev`, `register --dev` and `build --dev` run as development whatever `NODE_ENV` the shell holds, as their help and the [CLI guide](https://meocord.dev/docs/4.2/cli) say. With `NODE_ENV=production` set in the shell, `start --dev` loaded the config from the production `.env` files, so a token kept only in `.env.development` was reported missing, and `register --dev` registered the commands as production does rather than to `commands.developmentGuild`. `--prod` still keeps a `NODE_ENV` the shell sets.
