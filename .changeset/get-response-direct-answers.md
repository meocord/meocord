---
'meocord': minor
---

`getResponse(interaction)` reports every answer a mock interaction got, whether the handler made it through `respond()` or with discord.js directly, such as `interaction.reply()` or `interaction.followUp()`. Before, it reported only what `respond()` made, so a handler written with discord.js's own methods showed `sent: true` with no `calls`, and a test had to read the mock's methods instead. Each call appears once, in the order made, with what it sent, without `withResponse`, and the `error` of one Discord refused. A test asserting the old `calls` of a handler that mixes the two now sees the direct calls too.
