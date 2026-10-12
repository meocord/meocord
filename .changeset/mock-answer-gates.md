---
'meocord': patch
---

Mock interactions in `meocord/testing` now treat four more answers as discord.js does under `useStrictMocks()`. Default mode reads them as before, and warns at a call where strict mocks answer otherwise.

- **An autocomplete's `respond()`** keeps its state when a test sets what it does.
  - Under `useStrictMocks()`, a `respond()` given `mockResolvedValue` marks the autocomplete `responded` once it resolves, so dispatch no longer closes the menu a second time after a handler that responded and then threw.
  - Under strict mocks, a second `respond()` is refused, as discord.js refuses it.
  - Under strict mocks, `getResponse()` reports each `respond()` call, and a responded autocomplete's `state` is `'replied'`.
  - In default mode, a `respond()` a test set leaves `responded` as it was, with a warning, and `getResponse()` reports no `respond()`.
- **`launchActivity()` and `sendPremiumRequired()`** are first answers under `useStrictMocks()`, as in discord.js.
  - Each marks the interaction `replied`, and `getResponse()` reports it.
  - A `reply()` or `update()` after one of them is refused, and so is either one after a `reply()`.
  - In default mode they leave the interaction as it was, with a warning.
  - In both modes, a `followUp()` after one of them is sent, where it threw `InteractionNotReplied`.
- **`update()` on a modal submitted from a command** is refused under `useStrictMocks()`, since Discord updates only the message a component opened the modal from. Default mode runs it with a warning. A modal a button or menu opened updates as before.
- **Under `useStrictMocks()`, `followUp()` and `editReply()`** mark the interaction `replied` once they resolve, as discord.js does, rather than at the call.

`ResponseCall['method']`, the `method` of each call `getResponse()` reports, gains `'respond'`, `'launchActivity'` and `'sendPremiumRequired'`. Code that switches over it exhaustively gains those cases.
