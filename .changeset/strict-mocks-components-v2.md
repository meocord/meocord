---
'meocord': patch
---

Under `useStrictMocks()`, the mocks now handle Components V2 messages as Discord does. An edit changes only the flags Discord lets it change: `SuppressEmbeds`, and `IsComponentsV2`, which it can set but never clear. So a private deferral edited into a V2 message stays private, where it read back as public, and an edit with `flags: 0` leaves a V2 message V2. A reply, follow-up, edit or update that leaves a V2 message holding `content` or `embeds` is refused with a 400 (`createDiscordError(50035)`), as Discord refuses it: sent so, or made V2 by an edit that doesn't clear them with `content: null` and `embeds: []`. The same applies to a mock message's own `edit()` and `reply()`, and to a channel's, user's or member's `send()`.

In default mode the mocks behave as before: an edit's flags replace the message's, and such a message is sent. Each logs one warning where strict mocks differ. A test that sends `content` or `embeds` with `IsComponentsV2` under strict mocks now fails as it would against Discord; drop them, or clear them in the edit that makes the message V2.
