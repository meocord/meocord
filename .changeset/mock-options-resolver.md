---
'meocord': patch
---

A mock options resolver from `createChatInputOptions()` now reads two kinds of option as discord.js does, under `useStrictMocks()`:

- **`getMentionable()` on a user option** returns the user's member in a server, as discord.js reads `member ?? user`, and the user in a direct message. In default mode it still returns the user, with a warning once.
- **An autocomplete's focused option** is read by name from the option Discord sent, as `getFocused()` already reads it. Before anything is typed, `getString()` reads `''`, and `get()` returns that option, marked `focused`. A typed number reads as its digits through `getInteger()`, and `getString()` on it throws discord.js's type error. An option given no value takes any of the string, integer and number getters, since the mock doesn't know which type it was declared as. In default mode these getters read as before (`null` for an option given no value), with a warning once.
