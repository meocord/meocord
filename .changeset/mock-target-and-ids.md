---
'meocord': patch
---

A mock message context menu's target is its `targetMessage`, and `targetId` reads that message's id. Without a `targetMessage`, the menu gets a generated id and a message made for it, as a user context menu already did. That message is in the menu's channel and its server, or in the user's DM channel for a menu used in a DM. Setting `targetMessage` after the mock is made moves `targetId` with it, and setting `targetId` makes a message for the new id. A `targetMessage` with no id gets a generated one. If a `targetId` is given that differs from the `targetMessage`'s id, `useStrictMocks()` refuses it, naming both. In default mode it warns once and reads the message's id.

A user or an attachment made with `createMockInteraction(User)` or `createMockInteraction(Attachment)` has a snowflake `id`, from the same count as every other mock's. Before, the id was a stub that stringified to `[object Object]` for every one of them: two users shared a cooldown key, a mention read `<@[object Object]>`, and `createModalFields` keyed uploads by a stub. A user made this way gets its creation time the same way `createMockUser()`'s does: the time the mock was made under `useStrictMocks()`, and its id's time, with a warning, in default mode.
