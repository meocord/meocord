---
'meocord': minor
---

A testing module can answer an event handler's refusals as the bot does. With `eventFallback: true` in `MeoCordTestingModule.create()` or `fromApp()`, `emit` runs the bot's own event fallback: a guard's `GuardDeniedError` skips the event and the handler isn't counted as run, and a `UserError` is answered as a reply to the newest message among the event's arguments, with the app's presenter and `replyEmoji`. Neither rejects `emit`; any other error still does. The option applies to `emit` alone, not to `invoke` of an `@On` handler. With the option, `emit` gives each event argument's client the module's presenter, theme and translator without strict mocks too, so the reply is drawn as the bot draws it. A test can now check the reply a member gets:

```ts
const module = MeoCordTestingModule.fromApp(App, { eventFallback: true }).compile()
const message = createMockMessage({ content: 'hello' })
await module.emit('messageCreate', message)
expect(message.reply).toHaveBeenCalled()
```

Without the option `emit` rejects with both errors as before, and the first time it does, it logs one warning for the run: the next major version (5.0) answers them as the bot does ([#964](https://github.com/meocord/meocord/issues/964)). Set `eventFallback: false` to keep the rejection without the warning. See [Invoke and dispatch](https://meocord.dev/docs/4.3/invoke-and-dispatch).
