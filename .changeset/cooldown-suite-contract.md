---
'meocord': patch
---

`testCooldownStore` now catches three ways a store can break the cooldown contract:

- a `release` that frees the key's other calls too, which resets a user's cooldown whenever `@Cooldown` gives back a call;
- a batch refusal that names the first cooldown to refuse rather than the longest wait, which tells users to retry too soon;
- a wait counted from the oldest call in the window, rather than from the oldest of the newest `uses` calls, after a limit is lowered.

A store that keeps the contract passes as before. A store that gets one of these wrong now fails its own suite run, naming the case. See [Cooldown stores](https://meocord.dev/docs/4.2/recipes/cooldown-stores).
