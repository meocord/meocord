---
'meocord': patch
---

`invoke` checks a handler gets the arguments it declares when it builds none for it, as for a reaction handler given its reaction without its `ReactionEvent`. The call used to reach the handler and fail inside it, with `Cannot destructure property 'user' of 'undefined'`. Now:

- under `useStrictMocks()`, `invoke` refuses the call before the handler runs, naming the fix: `Stars.star takes 2 arguments, and invoke was given 1: pass its ReactionEvent after the reaction, as { user, action }.`
- by default, `invoke` warns once with the same words and calls the handler as before, so a handler that never reads its second argument keeps running.

A handler behind `@UseGuard`, or behind `@Command`'s check, keeps the `length` and `name` it was declared with. See [Testing](https://meocord.dev/docs/4.2/testing).
