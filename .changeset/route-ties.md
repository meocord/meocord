---
'meocord': minor
---

`@MeoCord({ routeTies: 'literalFirst' })` changes which of two equally specific customId patterns runs when both match an id. Instead of the one listed first, the one that spells out as literal text the first segment where the two differ runs, such as `a/b/{y}` over `a/{x}/c` for `a/b/c`, whatever the listing. What that leaves tied keeps its listing order, and a more specific pattern still runs first. `'listed'`, the default, ranks as before; the next major version (5.0) ranks `'literalFirst'` by default.

Things that help without changing what a bot does:

- The warning about such a pair now names the option.
- With the option on, only pairs still left to listing order are warned about.
- `findRouteConflicts` reports, for each pair, the pattern that `runs` and what it was `decidedBy`.
- `resolveRoute` lists, in `alsoMatches`, the other patterns that match the id and lost to it.

See https://meocord.dev/docs/4.2/components.
