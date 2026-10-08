---
'meocord': patch
---

`testCooldownStore` no longer fails a correct store on a slow CI runner. Its sliding-window and `retryAfterMs` cases measured elapsed time against their nominal waits, with margins of tens of milliseconds, so a timer that fired a few hundred milliseconds late failed them. They now check against the times measured around each call, in a 2-second window with a second between calls, and still fail a store that resets fixed buckets or counts from the newest call. The suite takes about 2 seconds longer.
