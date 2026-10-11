---
'meocord': patch
---

In an autocomplete, Discord sends a user, member, role, channel, mentionable or attachment option as its id alone, and the handler's params hold that id. `createChatInputOptions` gave an autocomplete handler the resolved object instead, so a test could pass on a `User` that the bot never gets.

- **Under `useStrictMocks()`**, options given to an `AutocompleteInteraction` read as Discord sends them. Each entity option is its id, in `options.data`, in `options.get()` and in the handler's params, and the entity getters, such as `getUser()`, return `null`.
- **By default**, the objects are kept, with a warning that names the options once.

A command's options are unchanged. To test an autocomplete as a bot runs it, call `useStrictMocks()`: an entity option given as an object then reads as its id, as Discord sends it. A bare id string reads as a string option.
