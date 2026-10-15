---
'meocord': patch
---

A Ctrl+C or SIGTERM while the bot starts exits 0, as one once it is online does, whichever step of the startup it comes in. A built bot also exits 1 when `MeoCordFactory.create` refuses its app, whatever `main.ts` does with the error.

The process exits with the code set when the shutdown began, so a code your `main.ts` sets as `start()` rejects for the stop no longer counts. It still exits 1 when a client fails to close, or when a provider's factory fails while the shutdown waits for it.

New apps get a `main.ts` whose catch sets the exit code only for an error MeoCord didn't explain. In an existing app, `app.stop()` from your own code during startup still ends with the code your catch sets; to have it exit 0, change the catch in `src/main.ts` to:

```ts
bootstrap().catch(error => {
  if (isExplainedError(error)) return
  logger.error('Error during startup:', error)
  process.exitCode = 1
})
```
