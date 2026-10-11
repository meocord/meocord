---
'meocord': patch
---

A mock guild's `emojis`, `stickers`, `scheduledEvents`, `autoModerationRules` and `invites` are managers, in both modes, as on a message's guild. Before, calling `create()`, `fetch()` or `cache.get()` on one threw a `TypeError`.

- `create()` resolves to a mock emoji, sticker, scheduled event or AutoMod rule in the guild, and caches it, as discord.js does.
- `invites.create(channel)` resolves to an invite for that channel in the guild, keyed by its `code`, and caches nothing, as discord.js does.
- `fetch(id)` resolves to the cached item, or makes and caches one; a list fetch resolves to an empty collection.
