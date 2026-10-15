---
'meocord': patch
---

The startup warning about a re-declared handler that still answers routes it inherits now names an inherited `@On` or `@Once` event as well. A subclass that re-decorates an event handler with another event, such as `@On('guildDelete')` over an inherited `@On('guildCreate')`, still answers the inherited event, and nothing said so. `@Controller({ inheritedRoutes: 'replace' })` drops it, as the next major version (5.0) does by default.
