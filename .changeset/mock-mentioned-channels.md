---
'meocord': patch
---

The channels and roles a mock message's content mentions are now full mocks of the message's server, as the gateway delivers them. A mentioned channel's `permissionsFor()` threw, and under strict mocks so did its `viewable`; its `messages` and `permissionOverwrites` were placeholders rather than managers. A mentioned role is a `Role` mock in the server, as a role of `createMockGuild` is.
