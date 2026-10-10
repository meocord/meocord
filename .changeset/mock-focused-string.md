---
'meocord': patch
---

A mock autocomplete's focused option reads as Discord sends it: a string. `getFocused()`, `getFocused(true).value` and the option's entry in `options.data` now agree, and `data` marks it `focused`.

- With no value given, as before anything is typed, the focused option reads `''` instead of `null`, in both modes. A test that checked for `null` changes; discord.js's types rule `null` out.
- The focused option is now in `options.data`, as Discord sends it, so with no value given an autocomplete handler's params are `{ query: '' }` rather than `{}`, in both modes. A test asserting `toEqual({})` there changes.
- A number given for it reads as its digits under `useStrictMocks()`, keeping its option type. In default mode it stays the number and warns once when read. The next major version (5.0) gives the string without the call.
