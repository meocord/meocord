---
'meocord': patch
---

`emit`'s JSDoc, and `EmitResult.ran`'s, now say what a test sees from a guard's `GuardDeniedError` and a handler's `UserError`: they reject `emit` as any error does, because the bot's event fallback, which skips a refused event and answers a `UserError`, doesn't run in a testing module. Check them with `rejects`. See [Invoke and dispatch](https://meocord.dev/docs/4.2/invoke-and-dispatch).
