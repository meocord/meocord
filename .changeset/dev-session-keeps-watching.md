---
'meocord': patch
---

`meocord start --dev` keeps watching when the bot cannot log in, such as with a wrong token or an intent Discord refuses. It says so, and starts the bot again on the next change, whether to your code or to `.env`.

`start --dev` also watches `.env`: saving it restarts the bot with the new values, without a rebuild.

When watch mode cannot start, for example because an `rsbuild` hook in `meocord.config.ts` throws, `start --dev` exits with code 1, as `meocord build` does, so a script or process manager around it sees the failure.
