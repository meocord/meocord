---
'meocord': patch
---

A mock message context menu's `targetId` is its `targetMessage`'s id. Without a `targetMessage`, it gets a generated id and a message made for it, as a user context menu already did. A user or an attachment made with `createMockInteraction(User)` or `createMockInteraction(Attachment)` has a snowflake `id` of its own. Before, the id was a stub that stringified to `[object Object]` for every one of them: two users shared a cooldown key, a mention read `<@[object Object]>`, and `createModalFields` keyed uploads by a stub. A user made this way gets its creation time the same way `createMockUser()`'s does: the time the mock was made under `useStrictMocks()`, and its id's time, with a warning, in default mode.
