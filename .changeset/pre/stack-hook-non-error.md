---
'meocord': patch
---

Source-mapped stacks leave alone what a bot's dependencies do with `Error.captureStackTrace`. Some packages give it an object built by a function rather than an `Error`: follow-redirects, which axios loads, and node-fetch 2 both do. Bun's own stack hook refuses such an object, so MeoCord no longer hands it one, and that stack reads as it does with no hook set. A stack hook set before MeoCord's that throws no longer fails the code reading the stack; MeoCord writes the stack itself.
