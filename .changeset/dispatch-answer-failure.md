---
'meocord': patch
---

Under `useStrictMocks()`, a testing module's `dispatch()` reports a call whose answer MeoCord fails to build once, as a bot does, such as when an app presenter's error view throws. Its observers hear one `'error'` result, with the guard in `deniedBy` when a guard refused the call, and the failure is logged once. In default mode an interaction's observers still hear the call twice, first with its own outcome and then as an error, and a message command's hear its own outcome; a warning says so once. `dispatch()` rejects with that failure in both modes, and two dispatches running at once on one module each reject only with their own.
