---
'meocord': minor
---

`meocord/eslint` turns on `@typescript-eslint/no-floating-promises`. A promise nothing awaits, such as `respond(interaction).send()` or a database write left without `await`, rejects outside every handler MeoCord runs, so its error reaches no exception filter and can end the bot. An interceptor's `next.handle()` left that way runs the code after it before the handler starts, so that code never sees the handler's result or error.

After upgrading, `bun run lint` may report calls like these in your code. Each one is a promise that runs on its own:

- `await` it, or `return` it, where the code after it should wait, as an interceptor's `next.handle()` always should;
- or write `void` before it where it is meant to run on its own, and handle its failure with `.catch()`.

To keep the previous behaviour, set the rule to `'off'` in your `eslint.config.ts`.
