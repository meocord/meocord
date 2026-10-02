---
'meocord': patch
---

A cooldown store that fails some calls and answers others, as a Redis Cluster with one node down does, is now logged as one outage. Any answer ended the outage and the next failure began a new one, so each failing call logged an error with its stack and then a recovery line. An outage now ends when the store answers 30 seconds or more after its last failure, and the recovery line counts every call that failed in it.
