---
'meocord': patch
---

A subclass that re-declares `@On` or `@Once` for the same event on a method it overrides runs that method once per event. It ran twice, with or without `@Controller({ inheritedRoutes: 'replace' })`, as the inherited entry stayed beside the new one. Under `inheritedRoutes: 'replace'`, a method the subclass re-decorates with `@On` or `@Once` now answers only the events it declares there, as for every other kind of route. A method overridden without decorators keeps its inherited events.
