---
'meocord': minor
---

Under `useStrictMocks()`, a mock answers a property its discord.js class does not have as discord.js does: it reads `undefined` and is not `in` the mock, so `message.isRepliable?.()` gives `undefined` and `if (value.guild)` is false for a class without a `guild`, as on a bot. `in` is true for a field the class sets on its instances, such as `'content' in message`; the fields are read from the source of the discord.js the application installed. A property a test gives or assigns, one the class has, and a mock of an app's own subclass answer as before. Without `useStrictMocks()` a mock keeps its placeholder, and the first read of such a property by an app's or a test's code logs one warning for the run, naming the property, its class and what strict mocks answer; MeoCord's own reads and the discord.js code a mock runs stay quiet. The next major version (5.0) answers `undefined` without the call. See [Mocks](https://meocord.dev/docs/4.3/mocks).
