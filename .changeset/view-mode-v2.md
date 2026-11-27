---
'meocord': minor
---

New `@MeoCord({ viewMode: 'v2' })` sends MeoCord's own answers to commands, components and modals as Components V2 containers in the messages it starts, for a bot whose own messages are V2:

```ts
@MeoCord({ controllers: [PingController], viewMode: 'v2' })
class App {}
```

With `'v2'`, a guard's refusal, `respond(interaction).error()`, the unexpected-error reply, a cooldown's answer and "command not found" are sent as a container with `IsComponentsV2`. That covers the private reply to an interaction not yet answered, error follow-ups, the private follow-up that replaces a public deferral, and the edit of a deferred reply nothing was sent into, MeoCord's own or the app's `deferReply()`. A message that already exists keeps its form, since Discord can't turn a V2 message back: the loading view `@Defer` adds to a component's message, its restore, and an error added to a private component message stay as that message is. The presenter is told the form in `context.mode`, as before. Message commands' replies and direct messages stay embeds. The default, `'embed'`, sends every answer as before.
