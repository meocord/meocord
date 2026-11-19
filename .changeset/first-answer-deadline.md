---
'meocord': patch
---

An interaction Discord has been told nothing of no longer misses its 3 seconds waiting for its themes. Its wait for `themeFor` and, under `waitForReady`, for the `onReady` hooks now share one deadline, 2 seconds after the interaction was created (1 second for an autocomplete). Once it passes, the call goes on in its handler's theme and keeps it to its end. The lookup goes on within `themeForTimeoutMs`, and its result is kept for later calls.

- Before, a command without `@Defer` whose hook was still running and whose resolver didn't answer started its handler 3 seconds after the interaction was created, or 7 with a `themeForTimeoutMs` of 5000. An autocomplete waited its 1 second for the hooks, then the whole lookup. Without `waitForReady`, a `themeForTimeoutMs` of 3 seconds or more missed the window by itself.
- The deadline covers the hooks and the themes together, leaving the handler the last second for its answer. So with a hook that runs past the deadline, a resolver the hook holds back now misses the call even when it answers quickly: a resolver answering within a second of being asked used to give a themed first answer 2.5 to 3 seconds after creation, and now the answer goes out at 2 seconds in the handler's theme. The next call reads the theme from the cache.
- A cut is not a failure: it starts no backoff. One warning names each lookup in flight, the server or user and the first call cut, and says the lookup goes on. A call whose hook was also late logs the hook's warning alone.
- With `@Defer`, nothing changes while the acknowledgement goes through. If it fails after the deadline, the call goes on at once: a `@Defer({ mode: 'auto' })` acknowledgement failing at its latest, 2.5 seconds after creation, leaves the first answer that late.
- When a bot's stop or a testing module's close ends its shutdown, the lookups still in flight end with it. A call still waiting on one goes on in its handler's theme, and whatever the lookup gives later is not logged, counted or kept.
- Messages, reactions and events have no deadline. See https://meocord.dev/docs/4.3/theming and https://meocord.dev/docs/4.3/lifecycle-hooks.
