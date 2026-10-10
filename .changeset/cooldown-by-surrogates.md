---
'meocord': patch
---

A cooldown's `by` may return any string, one holding half of an emoji included, such as text cut short with `slice`. Such a value made the call fail with "URIError: URI malformed" before the handler ran; it now counts under a key of its own. Every value that worked before keeps its key, so running cooldowns carry on across the upgrade.
