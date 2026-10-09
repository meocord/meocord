---
'meocord': minor
---

`useStrictMocks()`, called once in a test setup file, has every mock from `meocord/testing` compute the values discord.js computes, where it reads a truthy placeholder otherwise. Those values include:

- a message's `editable`, `deletable`, `pinnable`, `crosspostable`, `bulkDeletable`, `hasThread` and `partial`;
- a member's `manageable`, `kickable`, `bannable` and `moderatable`;
- a role's `editable`;
- a channel's and a thread's `viewable`, `manageable`, `deletable` and `joinable`;
- `partial` on users, channels and reactions.

`message.thread` is `null` unless the channel caches a thread under the message's id, and no placeholder warning is logged.

To give those values what Discord would, strict mocks:

- cache the bot's member in its server from the start;
- give @everyone the permissions Discord gives it in a new server;
- give a channel or thread made without a server one of its own.

So a default message from another user is not `editable` or `deletable`, and a member is not `kickable` until the bot's member has a role above theirs with the permission. A value a test sets on a mock still wins. The next major version (5.0) computes these values by default. See https://meocord.dev/docs/4.2/mocks.

Without the call, mocks read as before. A voice channel's `joinable` and `speakable` and a DM channel's `partial`, which read a placeholder without the warning, now give it too. Every placeholder warning now ends ", or call useStrictMocks() to have the mock compute it now.", so a test that matches a warning's whole text needs the new ending.
