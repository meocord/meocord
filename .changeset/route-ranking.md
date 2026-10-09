---
'meocord': patch
---

Component customId patterns now rank segment by segment, left to right, the way most routers rank paths. When several patterns match an id, the first segment where one pattern spells out literal text and the other leaves a param decides it: the literal one runs, whatever order the controllers are listed in. So `profile/me/{section}` takes `profile/me/edit` from `profile/{userId}/edit`, while `profile/123/edit` still goes to `{userId}`. If that leaves a pair tied, the narrower type at the first param where they differ runs, the same type order as before: words to choose from, then `bool`, `int`, `number`, then text.

4.1 ranked by how much literal text a whole pattern had. Only these overlapping pairs change handler, and 4.1 named every one of them in its startup warning:

- A pattern with more literal text, or more literal segments, now loses to one that spells out an earlier segment. For example, `a/{x}` now runs for `a/abcd` instead of `{x}/abcd`.
- Pairs 4.1 left to listing order, such as `a/{x}/c` and `a/b/{y}`, now go to the earlier literal whatever the listing, which is the handler 4.1's warning said would run in 5.0.
- Typed params are compared position by position instead of summed. For example, `{n:int}/{s}` now runs for `7/7` instead of the one listed first among it and `{s}/{n:int}`.

Two patterns that the ranking still can't tell apart log a warning at startup, with an id both match. Such a pair has the same literals and equally narrow params at every position, such as `t/{a:on|off}` and `t/{b:off|no}`, which both take `t/off`, and the one listed first runs. Pairs the ranking decides log no warning.

`findRouteConflicts` lists only those tied pairs. A test asserting `toEqual([])` passes for every app whose patterns the ranking tells apart. A test expecting a pair the ranking now decides, such as `profile/summary/{uid}` and `profile/{ownerId}/{uid}`, gets `[]` instead.

The internal `CommandMetadata`'s `specificity` still holds the value 4.1 gave, but routing no longer reads it. It's deprecated and goes in the next major version (5.0).

See https://meocord.dev/docs/4.2/components.
