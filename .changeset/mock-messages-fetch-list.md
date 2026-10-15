---
'meocord': patch
---

Under `useStrictMocks()`, a mock channel's `messages.fetch()` given no id now lists the messages its cache holds, which are those made or sent in the channel, newest first, as discord.js lists a channel's recent messages. It honours `limit`, 50 by default, and `before`, `after` and `around`. It resolved to an empty collection, though `messages.cache` held them. Default mode still resolves to an empty collection, and warns once for a channel that holds messages made, sent or cached in it, which strict mocks would list.
