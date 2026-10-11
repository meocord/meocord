---
'meocord': patch
---

`module.invoke()`'s JSDoc now says what it does with a message whose content is empty. It used to say that a message without content gets `{}`, which holds only for a mock made without `useStrictMocks()`, whose `content` isn't a string. Under strict mocks a message has empty `content`, and a patterned `@MessageHandler` rejects it, as dispatch runs no handler for a message with no text.

That rejection now says what to do: `message has no text, so dispatch runs no handler for it: give the mock the content Dice.roll's pattern 'roll {sides:int}' takes.` A message of only whitespace gets the same. A test under strict mocks that matched the old text, `message '' does not match …`, sees the new wording. Nothing else changes.
