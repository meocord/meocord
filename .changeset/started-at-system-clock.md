---
'meocord': patch
---

An observer's `DispatchResult.startedAt` follows the system clock, as its documentation says. It was read from the monotonic clock offset by the process's start, which drifts from the system clock by about half a second a day, and by more after the host sleeps, so a bot that had run for a week reported calls several seconds early. `durationMs` is still measured with `performance.now()`. Nothing to change in your code.
