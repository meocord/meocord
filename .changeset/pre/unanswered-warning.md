---
'meocord': minor
---

In development, MeoCord warns once per handler that finishes without answering its interaction, which leaves the user with "The application did not respond", or that defers it and never follows up, which leaves them watching it think until Discord gives up. The warning names the handler and what to call. A call a guard denied, or one that failed, is answered by the fallback and never warned about. It is on while `NODE_ENV` is `development`, as under `meocord start --dev`, and off in production; `@MeoCord({ warnUnanswered })` turns it on or off regardless.
