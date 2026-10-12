---
'meocord': patch
---

When the compiled config fails to load, the bot's message tells a config that can't be parsed from one whose own code threw as it ran, on Node and Bun alike. On Node, a config that throws a `SyntaxError` as it runs, such as `JSON.parse` or `new RegExp` on an environment value, was told to fix `meocord.config.ts` and rebuild, which can't help; it's now told to check the environment it reads. On Bun, a config that can't be parsed was told to check its environment; it's now told to fix `meocord.config.ts` and rebuild.
