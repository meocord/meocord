---
'meocord': patch
---

`respond().original.components` is typed as the message's top-level components, `readonly APIMessageTopLevelComponent[]`, rather than `readonly unknown[]`, so a handler can hand them back to `send()`, `editReply()` or a builder without a cast, as it already can the `embeds` beside them. Reading them compiles as before. A cast to an unrelated type, such as `Record<string, unknown>[]`, now fails to compile; drop it. Code that builds its own `ResponseState`, such as a test double, with `unknown[]` components in `original` must type them as Discord's `APIMessageTopLevelComponent[]`.
