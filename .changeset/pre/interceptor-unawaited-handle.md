---
'meocord': patch
---

An interceptor that calls `next.handle()` without returning or awaiting it no longer crashes the bot when the handler throws. The handler's error was an unhandled rejection, which ends the process, and the filters, the fallback and the user never saw it, while observers reported the call as `'ran'` and `@Defer()` released the message before the handler finished. Now, when an interceptor returns and leaves what `next.handle()` returns, or a `then` or `finally` chain from it, without a rejection handler, as `next.handle().then(log)` does, the call ends when the handler does and fails with what it throws: its filters and the fallback answer it as they would any handler error. An interceptor that awaits, returns or catches the promise, or races it against a timeout, behaves as before. A promise handed to something else, such as `Promise.all`, is still that one's to handle.

A handler that an interceptor took on, such as by racing it against a timeout, and that throws after the interceptor has returned is now logged as a warning naming the interceptor, the handler and the error, unless a handler of the interceptor's own, in a chain from `next.handle()`, disposes of it; one that rethrows it, or wraps it in an error of the app's, still leaves it to the warning. The call has ended by then, so nothing else reports it.
