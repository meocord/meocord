---
'meocord': patch
---

A controller whose constructor throws, such as one missing a config value, now fails only its own handlers. Every other controller's reaction handlers run for a reaction, including when the broken controller has none, and a message's other handlers and listeners run, in turn and with `messages: { handlers: 'concurrent' }`. The error goes to the global filters, then the fallback, as it does for an interaction, instead of being logged as an unhandled error. With `handlers: 'concurrent'`, the call settles only once every handler has, so shutdown waits for them. In the testing module, `dispatch` of such a message or reaction still rejects with the error, after the other handlers have run. Nothing to change in your code.
