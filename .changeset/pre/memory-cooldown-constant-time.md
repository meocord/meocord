---
'meocord': patch
---

`MemoryCooldownStore`, the default, spends the same time on a call however many calls its key holds. It filtered every call time of a key on each call, so a busy cooldown with a large `uses`, such as a `'global'` one, slowed dispatch as calls built up: at 20,000 calls a second with `uses: 1_000_000`, about 45 µs a call. Each key's times are now trimmed from the front as they leave the window, which costs about 0.12 µs a call there, and decisions are unchanged.
