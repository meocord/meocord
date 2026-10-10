---
'meocord': patch
---

Under `useStrictMocks()`, a mock interaction is in the place its `message`, `guild`, `member` or `guildId` gives it, as Discord sends it:

- An interaction given a `message` is in the message's channel and server. A button built on a default `createMockMessage()` is in that message's server, no longer a DM. When the test also gives the interaction a `channel`, `guild` or `guildId`, a message whose server `createMockMessage()` made itself moves to that place instead.
- An interaction given a `guild`, or a `member` of a server, is in that server, with its `guildId`.
- An interaction given a `guildId` alone is in a server the bot isn't in. Its `guild` and `channel` are `null`, and its `member` is a raw member for its user.
- A `channel`, `guild` or `guildId` that is somewhere other than a message the test placed, by giving it a `channel` or `guild`, is refused, naming both.

In default mode, placement is unchanged. Where strict mocks would place the interaction elsewhere, reading its `guildId`, `guild`, `channelId`, `channel` or `member` warns once, saying what to give or to call `useStrictMocks()`. The next major version (5.0) places interactions this way without the call.
