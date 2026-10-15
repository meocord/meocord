---
'meocord': patch
---

A testing module sets its own presenter, theme and translator on the client of each call, in `invoke`, `dispatch` and `emit` alike, as the bot sets them on its own client:

- **A module without a presenter**, dispatching on a client another module with a presenter has used, answers with MeoCord's default presenter under `useStrictMocks()`. In default mode it still answers with the other module's presenter, so the result can depend on the order tests run in, and a warning says so once. Give each test its own client, or call `useStrictMocks()`, to keep modules apart.
- **`emit()`** sets the module's presenter, theme and translator on the client of each event argument under `useStrictMocks()`, so an event handler's `respond()` draws as the bot draws it. In default mode the client is left as it was, with a warning once when the module has a presenter, a theme or a translator of its own.
