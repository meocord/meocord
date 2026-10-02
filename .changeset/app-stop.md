---
'meocord': minor
---

Stop a bot from code with `app.stop()`. It runs the `onShutdown` hooks under your `shutdownTimeout` and closes the client, without ending the process, so an owner-only shutdown command, a graceful restart or an integration test needs no signal. With process sharding it asks every shard to shut down and waits for it, and called in a shard, it asks the manager to stop every shard, so it stops the bot whichever process calls it. A stop while the bot logs in ends that login, so its `start()` rejects. Calls after the first wait for it, and a stopped app does not start again: use `MeoCordFactory.create` to make a new one. A client that fails to close sets `process.exitCode` to 1, unless another code is set, so the process exits as a signal's shutdown would. A signal, or a shard manager's request, that comes while `stop()` runs waits for its hooks to finish rather than exiting at once.

```ts
const app = MeoCordFactory.create(App)
await app.start()
// later
await app.stop()
```

A SIGINT or SIGTERM after a failed login now exits with the code the failed login set, 1, where 4.0 exited 0, so a process supervisor no longer reads a bot that never came online as a clean stop. See [the upgrade guide](https://meocord.dev/docs/4.1/migrating#smaller-changes).
