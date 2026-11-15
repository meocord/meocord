---
'meocord': minor
---

A new app from `meocord create` sends without pings: its `clientOptions` sets `allowedMentions: { parse: [] }`, the default discord.js gives every message the client sends, `respond()`'s replies and your own `message.reply` and `channel.send` alike. A reply that echoes a member's text no longer pings whoever that text mentions, `@everyone` and roles included; one that should ping passes its own `allowedMentions`, such as `{ users: [id] }`, and a `message.reply` that should ping its author adds `repliedUser: true`.

An existing app whose `clientOptions.allowedMentions` is unset logs one warning at startup, since the next major version (5.0) makes `{ parse: [] }` the default ([#501](https://github.com/meocord/meocord/issues/501)). Set it to `{ parse: [] }` to have that now, or to `{ parse: ['users', 'roles', 'everyone'], repliedUser: true }` to keep every mention; setting it to anything silences the warning. Nothing else changes. See [Security](https://meocord.dev/docs/4.3/security).
