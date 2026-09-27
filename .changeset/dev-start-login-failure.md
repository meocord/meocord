---
'meocord': patch
---

`meocord start --dev` exits 1 when the bot cannot log in, as `meocord start --prod` does, instead of watching on with the bot offline: a missing or refused token, refused intents, or Discord being unreachable is not something a code change fixes. It says so in one line, after the reason the bot gave. After any other exit, such as an error at startup or a crash once online, it keeps watching and says `The application exited with code N; waiting for changes.`, then starts the bot again on the next rebuild. With `sharding`, the shard manager ends the session the same way.
