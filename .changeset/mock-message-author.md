---
'meocord': minor
---

`createMockMessage` takes an `author`, so a test can send several messages as one user. Before, every mock message came from a new person, so a per-user `@Cooldown` or a check on who sent a message couldn't be tested through `dispatch()` without assigning `message.author` by hand.

```ts
const author = createMockUser()
await module.dispatch(createMockMessage({ author, content: '!daily' }))
await module.dispatch(createMockMessage({ author, content: '!daily' })) // refused by the cooldown
```

- The author is cached on the message's client, so a mention of it resolves to the same user.
- In a server, the message's `member` is the guild's cached member for that user, such as one given to `createMockGuild({ members })`, or a new member with the author's id, which is then cached. Every message from that author has the same member.
- `author: client.user` gives a message the bot itself sent.
- An interaction's `member` works the same way: for a `user` the test gives, it is the `guild`'s cached member for that user, or a new member with its id, user and guild, which is then cached. A message and an interaction from one user in one server share the member, whichever is made first.
- A message built without `author` is unchanged.
