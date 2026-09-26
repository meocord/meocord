---
'meocord': patch
---

A `UserError` thrown from an `@On` handler of an event that carries a message, such as `messageCreate`, now answers that message as a message handler's does: a reply with its message, without pinging, the edited message for `messageUpdate`. It was logged as an error and answered nothing. From any other event it is logged at debug level, not as an error, since it is the user's outcome rather than a fault.
