---
'meocord': patch
---

A message command that a guard denies with a `GuardDeniedError`, or that `@Validate` refuses, now gets a reply with the reason, without pinging, deleted after `@MeoCord({ messages: { deleteUsageRepliesAfter } })` seconds as a usage reply is, and is logged at debug level. It was answered with nothing and logged as an error, though an interaction gets the same reason and neither is a fault. A guard denying a listener, an unpatterned `@MessageHandler()` or an `@On` handler, still gets no reply, since it only filters what the listener takes, and is now logged at debug level rather than as an error.
