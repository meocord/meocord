---
'meocord': patch
---

A mock channel's `messages.fetch(id)` in `meocord/testing` now resolves to the message made in that channel with that id, in both modes. Before, it resolved to a new, empty message under the same id.

Under `useStrictMocks()`, a mock channel also caches each message made in it, and each one sent there through `channel.send()` or `message.reply()`, as discord.js caches messages as they arrive. In default mode a channel's `messages.cache` stays as it was, and a test's first read of it warns once while it lacks a message made in that channel. A test that pins the cache's size sees the difference under strict mocks only.
