---
'meocord': patch
---

The JSDoc of `ContextMenuCommandBuilder.setType`, as MeoCord types it, says to leave a context menu builder's `build()` return type inferred. Written out as `ContextMenuCommandBuilder`, it drops the kind `setType()` gave, so a handler of the other kind compiles and is caught only as the bot starts.
