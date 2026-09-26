---
'meocord': patch
---

A message naming more than 100 uncached members, as a `member` list can, has them fetched 100 at a time. Discord's gateway request for members takes at most 100 IDs, and a larger one was sent whole.
