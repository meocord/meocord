---
'meocord': patch
---

An interaction Discord has been told nothing of no longer misses its 3 seconds waiting for its themes. Its wait for `themeFor` now ends 2 seconds after the interaction was created (1 second for an autocomplete). Once it passes, the call goes on in its handler's theme and keeps it to its end. The lookup goes on within `themeForTimeoutMs`, and its result is kept for later calls.

- Before, a command without `@Defer` waited for the whole lookup, up to `themeForTimeoutMs`, so a `themeForTimeoutMs` of 3 seconds or more missed the window by itself.
- A cut is not a failure: it starts no backoff. One warning names each lookup in flight, the server or user and the first call cut, and says the lookup goes on.
- With `@Defer`, nothing changes while the acknowledgement goes through. If it fails after the deadline, the call goes on at once: a `@Defer({ mode: 'auto' })` acknowledgement failing at its latest, 2.5 seconds after creation, leaves the first answer that late.
- When a bot's stop or a testing module's close ends its shutdown, the lookups still in flight end with it. A call still waiting on one goes on in its handler's theme, and whatever the lookup gives later is not logged, counted or kept.
- Messages, reactions and events have no deadline. See https://meocord.dev/docs/4.3/theming and https://meocord.dev/docs/4.3/lifecycle-hooks.
