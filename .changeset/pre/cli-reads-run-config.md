---
'meocord': patch
---

The CLI reads the config the bot it runs reads. `meocord start --dev` uses the `shutdownTimeout` and `sourceMappedStacks` of the config it last compiled, so an edit to `meocord.config.ts` applies from the next restart. Before, it kept the ones from whatever `dist` held when the session began, and waited a shorter `shutdownTimeout` than the bot's own, killing it before its `onShutdown` hooks finished. The token check follows the same rule. `start` and `register` check the source config when they build first. Otherwise they check the compiled config the bundle runs, so `meocord register` without `--build` now stops at a compiled config that fails to load, as `start --prod` does.
