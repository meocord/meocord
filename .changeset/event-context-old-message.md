---
'meocord': patch
---

`ExecutionContext.getMessage()`'s documentation now says that for `@On('messageUpdate')` it returns the message as it was before the edit, which may be partial. The edited message is the event's second argument, read with `getArgs()`.
