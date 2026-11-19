---
'meocord': minor
---

A testing module's `dispatch()`, `invoke()` or `emit()` made while `init()` is still running, which a `close()` then ends, no longer starts. Before, such a call went on once `init()` resolved: it ran its handler against the closed module, on classes `close()` had already shut down, logged nothing and resolved as a call that ran, with `ran: true`, or `ran: 1` for `emit()`. Now it settles as a call the bot drops at a stop: no handler runs, nothing is made for it, and it reports the error "The bot stopped before this call started.". `dispatch()` resolves with `ran: false`, that error and no handlers, and `invoke()` with `ran: false` and that error. `EmitResult` gains an optional `error`, so a dropped event resolves with `ran: 0` and that error. `error` is set only for a dropped event, so every other `emit()` still resolves with `{ ran: n }`. A call made after `close()` is unchanged: it warns and runs. See https://meocord.dev/docs/4.3/testing.
