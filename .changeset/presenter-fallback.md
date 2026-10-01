---
'meocord': patch
---

A presenter that fails to draw a view no longer leaves the user without an answer:

- **An error view** whose `error()` throws or rejects, or returns a view MeoCord cannot render, such as a colour that is no colour or an empty text, is answered with MeoCord's own error view. The failure is still logged as the call's fault, and a testing module's `dispatch` still rejects with it. An asynchronous `error()` was the only one answered this way before.
- **A loading view** whose `loading()` fails the same way, or takes longer than a second to draw, is replaced by MeoCord's own loading view, with a warning naming the presenter, so the click is still locked and the handler still runs. A drawing that comes later is left unused.
- **A message command's reply or direct message** whose `messageError()` fails the same way is sent as MeoCord's own plain text, as without `messageError`. The failure is then logged as the call's fault, as for an error view, so a testing module's `dispatch` rejects with it.
