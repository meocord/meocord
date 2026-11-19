---
'meocord': patch
---

A testing module's `emit()` made after a `close()` that ended `init()` now runs its handlers, as `dispatch()` and `invoke()` made at that point already did. Before, it warned that the module was closed, then ran no handler and resolved with `ran: 0`, because the ended `init()` never listed the event sources. Now the first such `emit()` lists them, from the classes and the provided values `init()` made, and the handler registry and the themes get the same listing. The listing runs no factory; a handler that runs resolves its class as `dispatch()` does. An `emit()` made before the `close()`, while `init()` still ran, still doesn't start. See https://meocord.dev/docs/4.3/testing.
