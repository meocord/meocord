---
'meocord': patch
---

`testCooldownStore` no longer fails a correct store when the store and the suite come from different builds, as with a store package published as CommonJS tested in an ES module project. It told a store's own `consumeMany` and `peekMany` from the defaults by comparing them with its own build's `CooldownStore`, so a store extending the other build's class failed four cases, expecting batches counted at once and real peeks. The defaults now carry a mark both builds share, which the suite checks.
