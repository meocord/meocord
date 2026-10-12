---
'meocord': patch
---

Two fixes to how `meocord start` and `meocord register` treat the bot process:

- A runtime that can't be started, such as a `MEOCORD_RUNTIME` path that isn't there, is now reported as `Failed to start: <runtime> could not be run: <reason>`, and the CLI exits 1. It crashed with an unhandled error instead. A signal or message the running bot couldn't be sent is logged as `Could not signal or message the running application (process <pid>): <reason>`, and the bot's exit decides the code.
- When the bot is killed by a signal the CLI didn't pass on, such as SIGKILL from an out-of-memory killer, `meocord start --prod` and `meocord register` now exit 128 plus the signal's number, 137 for SIGKILL, as a shell reports it. `start --prod` exited 0, which a process supervisor reads as a clean stop. A stop you send the CLI, which it passes on to the bot, still exits as before. With process sharding, a shard a signal ended is logged as `exited on SIGKILL` rather than `exited with code unknown`.
