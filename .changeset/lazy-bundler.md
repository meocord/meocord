---
'meocord': patch
---

`meocord start --prod` and `meocord register` no longer load the bundler. A production install without optional dependencies, such as `npm ci --omit=dev --omit=optional`, can start the bot with `meocord start --prod`; before, it stopped with "Cannot find native binding". Without the bundler, `start --prod` also starts a little sooner and uses less memory, about 13 MB less on our test machine. The commands that build (`build`, `start` without `--prod`, `start --build`, `register --build`) still need the bundler and its native binding. See [Deployment](https://meocord.dev/docs/4.3/deployment#example).
