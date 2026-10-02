---
'meocord': patch
---

Corrected the editor documentation of several public APIs to match what they do:

- `HandlerRegistry`: `list()` gives the handlers in the order the app makes its classes, not the order they were bound. `messageHelp()` lists by where the message was sent, not by its author, and an entry's `hidden` leaves a command out of help's lists while `!help <command>` still shows it.
- `useTheme()`: outside a call it reads the app's theme from when its start begins until its shutdown begins. The chain of `@UseTheme` stops where `inheritStages: false` does, and only the theme's plain objects and arrays are frozen.
- `MeoCordFactory.create`: with process sharding, the manager logs an error a shard throws.
- `ShardContext`: `runHere` takes a service's class in a bot of one process, and its name with process sharding.
