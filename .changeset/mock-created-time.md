---
'meocord': patch
---

A mock thread's `createdTimestamp` and `createdAt` are read from its id, as another channel's are, in both modes. `createdTimestamp` read a stub and `createdAt` an Invalid Date.

Under `useStrictMocks()`, a user, server or channel made with a generated id was created when the mock was made, as a message and an interaction already were. That covers `createMockUser()`, `createMockGuild()`, `createMockChannel()` and an interaction's own user, so a test of an account-age check gets a new account. `SnowflakeUtil.timestampFrom(id)` still reads the id's own time.

In default mode their creation time is still their generated id's, a fixed day in 2025. Reading it warns once, saying to give the mock an id or a `createdTimestamp`, or to call `useStrictMocks()`. An id the test gives decides the time in both modes. The next major version (5.0) reads the time the mock was made without the call.
