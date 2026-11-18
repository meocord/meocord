---
'meocord': patch
---

A test using fake timers, such as Vitest's `vi.useFakeTimers()`, now draws the loading view of a `lock()` that is pending when `@Defer({ mode: 'auto' })`'s timer fires in the handler's theme: its `@UseTheme` layers and the server's and user's themes from `themeFor`. Before, fake timers ran the timer outside the call, so the view showed the app's theme. Nothing changes in a running bot, where the timer already ran inside the call. A timer your own handler arms still runs outside the call under fake timers; wrap its callback in `bindTheme()` to keep the handler's theme.
