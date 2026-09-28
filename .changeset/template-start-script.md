---
'meocord': patch
---

A new app's `package.json` has a `start` script, `meocord start --prod`, so `npm start`, `bun run start` and a host that runs `npm start` for you, as many Node hosts do by default, start the production build. `start:prod` is unchanged, and building stays its own step: run `build:prod` before `start`. An existing app can add the line to its `scripts` to get the same.
