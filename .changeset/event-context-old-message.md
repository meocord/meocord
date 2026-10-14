---
'meocord': patch
---

`ExecutionContext.getMessage()`'s documentation now says it reads an event's first argument when that is a message. For `@On('messageUpdate')` it returns the message as it was before the edit, which may be partial; the edited message is the event's second argument, read with `getArgs()`. For a reaction event it returns `undefined`; the message is on the reaction.
