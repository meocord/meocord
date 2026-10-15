---
'meocord': patch
---

`inspectHandler()`'s `inheritedRoutes` in `meocord/testing` names an `@On` or `@Once` event a handler inherits, such as `event "guildCreate"`, under `useStrictMocks()`. A subclass that re-decorates the handler with another event, or overrides it without decorators, still answers the inherited event, and a test couldn't see it. Default mode keeps the list as it was and warns once for each such handler.
