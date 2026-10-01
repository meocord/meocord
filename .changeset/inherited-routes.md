---
'meocord': patch
---

A handler that a subclass declares on another route, while it still answers the route it inherits, now logs a warning. For example, a subclass overrides `page()`, which its base declares as `@Command('page/{n}', …)`, with `@Command('shop/page/{n}', …)`. As in 4.0, the subclass keeps answering `page/{n}` as well as `shop/page/{n}`, and the same holds for `@MessageHandler`. The warning names both. In the next major version (5.0), the subclass's own routes replace the inherited ones; to keep both, declare both on the subclass's method. A subclass that declares every route itself, or none, gets no warning.
