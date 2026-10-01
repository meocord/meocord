---
'meocord': patch
---

Process sharding now handles a shard whose start fails:

- **A failed start ends the shard, so its manager restarts it.** The failure might be a network error at login, a provider factory that rejects, or Discord being briefly unavailable. Before, the shard set exit code 1 and kept running without logging in, so the manager never restarted it and its servers stayed offline until the whole bot was restarted. The shard now exits 1 once `main.ts` has handled the rejection, and the manager restarts it with the usual backoff.
- **An app MeoCord refuses stops the bot.** Examples are two services with one name, a provider of the wrong shape, or native addons built for another platform. Every shard would refuse it alike, so the shard tells its manager, which logs "Shard N cannot start; stopping every shard." with the reason, and where it is, on lines of its own, stops every shard and exits 1. `meocord start --dev` is not told the bot could not log in, since it didn't fail to. Before, the manager restarted the shard about once a minute, forever, while a process supervisor saw a healthy process.
- **A shard listens to its manager from the start.** A stop request, or the manager going away, while the shard's providers are still being made now stops the shard before it logs in. Before, the shard went on to log in with no manager, and a restarted manager then ran a second copy of it.

Outside process sharding, a failed `start()` still leaves the process to `main.ts`.
