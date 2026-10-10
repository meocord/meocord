---
'meocord': patch
---

A mock message's `components` and `embeds` are discord.js's classes, as a real message holds them. `createMockMessage({ components, embeds })`, and the messages `editReply()` and `fetchReply()` return, used to keep each one as a bare `{ toJSON }`, so `message.components[0].type` and `message.embeds[0].title` read `undefined`.

Each one is now built from its JSON at the time of the call, whether it was given as a builder or as API JSON:

- an action row is an `ActionRow` holding a `ButtonComponent`, a select menu component, and so on;
- Components V2 are `ContainerComponent`, `TextDisplayComponent` and the rest;
- an embed is an `Embed`;
- a type discord.js doesn't know is a plain `Component`, as discord.js builds it.

A discord.js instance you give is kept as it is. `toJSON()` still returns the same JSON, so no passing test changes.
