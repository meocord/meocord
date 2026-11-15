---
'meocord': patch
---

The JSDoc of `createMockInteraction()` and `useStrictMocks()` now says that a mock interaction's `fetchReply()`, `editReply()` and `followUp()` each resolve to a new message object, the message as it stands then, never one an earlier call gave, with or without strict mocks. discord.js does the same: `fetchReply()` and `followUp()` return a copy or a new object, never its cached `Message`, and `editReply()` returns a copy of a message it has cached. So two `fetchReply()` calls are not `===`, and a message held from before an edit keeps its old content. Compare messages by `id`, and tell two edits apart by `editedTimestamp`. Nothing the mocks return changes. See [Mocks](https://meocord.dev/docs/4.3/mocks).
