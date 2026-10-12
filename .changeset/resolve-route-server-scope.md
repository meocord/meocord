---
'meocord': patch
---

`resolveRoute` warns when a message given without `dm` reaches a handler that works only in a DM, where dispatch, reading a message sent in a server, runs another handler or none: pass `dm: true` for a DM. Under `useStrictMocks()`, it reads such a message as sent in a server, as dispatch does: with a server-only and a DM-only handler on one pattern it names the server one whatever the controllers' order, and a handler that works only in a DM, alone on its pattern, resolves to `undefined`. Without strict mocks, it resolves as before, by the controllers' order, and warns.
