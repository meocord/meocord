---
'meocord': patch
---

An answer an observer's `onStart` sends through `respond()`, including an error or a component's loading view, now has the server's and user's themes from `@MeoCord({ themeFor })`, as the handler's answers do; it went out in the handler's theme alone. It waits for those themes to be found, so with a slow resolver it goes out later than before, still ahead of the handler's answers; under `@Defer` the acknowledgement does not wait for it and goes first. The resolver is asked where it was, after `onStart` has started; a value it returns, rather than a promise, is applied as soon as it returns instead of a few ticks later, as a theme already cached is, so nothing waits and the calls Discord gets are the same as before. A test asserting the order of what runs after the lookup may notice the earlier settling. `useTheme()` in `onStart` reads the handler's theme until they are found, as the JSDoc of `DispatchObserver.onStart` now says.
