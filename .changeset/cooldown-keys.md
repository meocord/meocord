---
'meocord': patch
---

A cooldown's count is kept under a key named for its limit (`uses` and window), not its position among the handler's cooldowns. A release that added, removed or reordered a `@Cooldown` moved the counts a persistent store such as Redis kept to other cooldowns: adding a short cooldown above a daily one reset the daily for everyone, and a short one could inherit a long one's history. Now each cooldown keeps its own count across such a deploy, and changing a cooldown's limit starts a new count for it. Counts kept under the old keys are not carried over, so every cooldown's count starts afresh once, on the upgrade.
