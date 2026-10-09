---
'meocord': patch
---

A new app from `meocord create` turns on strict mocks in its `vitest.setup.ts`, with `useStrictMocks()`, so its mocks compute what discord.js computes, such as a message's `editable` or a member's `kickable`, rather than placeholders. Its sample button and `OwnerGuard` read the owner's id as `{ownerId:snowflake}`, so a customId that isn't a Discord id matches nothing. An existing app can add `useStrictMocks()` to its own setup file, before any mock is made ([docs](https://meocord.dev/docs/4.2/mocks)).
