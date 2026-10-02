---
'meocord': patch
---

`MeoCordTestingModule.create({ app })` counts cooldowns in the app's `cooldownStore`, as `fromApp` and the bot do. It counted them in a store of its own in memory, so a test of a cooldown never reached the app's store. A `CooldownStore` in the module's `providers` still takes the app's place, and the app's own store is then never built, so what it injects needs no provider. A store of the app's that injects something the test doesn't list needs it in `providers`, or a `CooldownStore` provider in its place.
