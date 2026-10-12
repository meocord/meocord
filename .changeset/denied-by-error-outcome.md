---
'meocord': patch
---

`DispatchResult.deniedBy`'s documentation now says it also comes with the outcome `'error'`. When a guard throws `GuardDeniedError` and the answer to that denial fails to build, for example because the app's presenter throws, observers are told `outcome: 'error'` with that failure as `error`, `handled: false`, and `deniedBy` naming the guard. The behaviour is unchanged; an observer that counts denials by `deniedBy` alone should also check `outcome` to tell these calls apart from ordinary denials.
