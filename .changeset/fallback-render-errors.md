---
'meocord': patch
---

An answer MeoCord fails to build is reported as a fault, not passed off as Discord refusing it. When the text of a usage reply, a `UserError` reply or the answer to an interaction's error cannot be written, or a presenter throws while building an error view, the bot logs an error naming the call, and observers are told the call ended in `'error'` with that fault. Before, it was logged only at debug level as "Could not reply", and the message went unanswered with no trace at the default log level. A send that fails is logged at debug level only when Discord refused it, a `DiscordAPIError` such as a missing permission; any other failure is logged as an error. In a testing module, such a fault rejects `dispatch()`. `respond(interaction).error()` still never throws, and logs a presenter that fails as an error.
