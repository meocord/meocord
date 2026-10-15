---
'meocord': patch
---

`TestingModule.invoke` on an `@On` or `@Once` handler runs it as the bot and `emit` do under `useStrictMocks()`: as an `'event'`, with the arguments you give. A guard or interceptor declared for messages or reactions is skipped, an `@On('interactionCreate')` handler gets no params argument, and a denial acknowledges nothing. Without strict mocks `invoke` runs such a handler as before, as its first argument's type, and warns once per handler where that differs from the bot; turn on `useStrictMocks()` to have tests run it as the bot does. A method a command, message or reaction route also reaches keeps running as that route's input gives.
