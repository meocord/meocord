---
'meocord': patch
---

A mock still reads some values discord.js computes as a truthy placeholder: a message's `editable`, `deletable`, `pinnable`, `crosspostable`, `bulkDeletable`, `hasThread` and `partial`, a member's `manageable`, `kickable`, `bannable` and `moderatable`, a role's `editable`, a channel's `viewable`, `manageable` and `deletable` and its thread and voice counterparts, and `partial` on users, channels and reactions. A test that reads one now gets a warning, once per run, that 5.0 computes it as discord.js does, and how to set it on the mock, such as `message.editable = false`, to test either way. A value the test sets is read without a warning.

`message.thread` is the thread the message's channel caches under the message's id, as discord.js reads it. Without one it is still a placeholder thread, with a warning that 5.0 gives `null` there.
