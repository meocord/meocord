---
'meocord': patch
---

`module.invoke()` now checks an autocomplete against the `@Autocomplete` handler it names, as it checks a command or a `customId`. Dispatch picks an autocomplete's handler by its command path and its focused option. When it would give the autocomplete to another handler, or to none, `invoke` rejects under `useStrictMocks()`, naming what dispatch does. Without strict mocks, it warns once for each handler and route and runs the handler as before. Three things that used to pass silently are caught this way: a misspelled command name, a focused option the handler doesn't take, and an option's handler invoked with a mock that has no focused option.

A test that hits one of these under strict mocks needs a mock with the command and focused option the handler declares, such as `options: createChatInputOptions({ focused: 'query' })`. A mock built without a command name is not checked.
