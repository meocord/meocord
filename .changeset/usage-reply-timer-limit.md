---
'meocord': patch
---

A `messages.deleteUsageRepliesAfter` longer than a timer can wait, 2147483 seconds (about 24.8 days), keeps usage replies, and startup warns about it. The reply was deleted at once before, as the runtime fires an overlong timer immediately. The next major version (5.0) refuses such a value.
