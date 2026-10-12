---
'meocord': patch
---

A mock user's DM channel in `meocord/testing` is the user's own, and a mock client's `users.createDM()` and `users.send()` reach the user they name under `useStrictMocks()`:

- **A user's DM channel** has the user as its `recipient` and is the user's `dmChannel` once made, in both modes. Before, both were placeholders.
- **`users.createDM(user)`**, under `useStrictMocks()`, resolves to that user's one DM channel, the same one `user.createDM()` and `user.dmChannel` give. A user named by id is the client's cached one, or one made and cached there. In default mode every user still gets the same channel, with a warning once.
- **`users.send(user, options)`**, under `useStrictMocks()`, sends through that DM channel's `send()`, as discord.js does, and resolves to a message holding what was sent, in the DM channel. In default mode it still resolves to an empty message, with a warning once.
- **A DM channel's `client`**, under `useStrictMocks()`, is the user's, so `channel.client.users.cache` holds the user. In default mode it is still a client of its own, with a warning once.
