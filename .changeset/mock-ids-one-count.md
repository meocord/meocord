---
'meocord': patch
---

Every id a mock generates comes from one count, so a test run gives the same ids each time. A server's `ownerId`, a role made without an id, an interaction's `commandId` and `applicationId`, a thread's `ownerId` and a channel's `guildId` fallback were time-based snowflakes, which differed between runs and sorted apart from every other mock id. A test that matched one of them against a time-based snowflake reads a counter id instead.

A role made with `createMockInteraction(Role)` and no id gets its id when it is made, as a user does. Its `createdTimestamp` follows the same rule as a user's: under `useStrictMocks()` it is the time the mock was made, and in default mode it is the generated id's time, with a warning once.

In default mode, a reply read again, through `fetchReply()` or as `editReply()` resolves it, has the same author, server and channel each time, where each read made new ones. A test comparing two reads of the same reply sees the same objects, and reading it again uses up no ids.
