---
'meocord': patch
---

`warnUnanswered` now names an `@Autocomplete` handler that returns without calling `interaction.respond()`, as it names any other handler that leaves its interaction unanswered. The user sees the autocomplete options fail to load in that case. The warning is shown once per handler: under `meocord start --dev`, and in tests whose app sets `warnUnanswered: true`. `@MeoCord({ warnUnanswered: false })` turns it off. Nothing about the answer itself changes.
