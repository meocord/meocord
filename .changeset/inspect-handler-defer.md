---
'meocord': minor
---

`inspectHandler()` reports a handler's `@Defer` as `defer`: the options it runs with, with their defaults filled in (`ephemeral: false`, `suppressNotifications: false`, `disable: 'all'`, `mode: 'eager'`, and `after: 1500` for `mode: 'auto'`), or `undefined` without one. A `@Defer` inherited from the method a handler overrides is reported as the bot applies it. A test can check that a command defers privately without dispatching it:

```ts
expect(inspectHandler(PingController, 'ping').defer).toEqual({
  ephemeral: true,
  suppressNotifications: false,
  disable: 'all',
  mode: 'eager',
})
```

`toEqual` on a whole inspection doesn't compare `defer`, so existing assertions hold. See [Invoke and dispatch](https://meocord.dev/docs/4.3/invoke-and-dispatch).
