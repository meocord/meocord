---
'meocord': minor
---

`ReactionEvent` names the second argument a `@ReactionHandler` method receives, `{ user, action }`. `ReactionHandlerOptions` stays as a deprecated alias of it: every other `…Options` type is what a decorator takes.

These are deprecated, and removed in the next major version (5.0). Each still works in 4.x, and its JSDoc names what to use instead:

- `ReactionHandlerOptions`: use `ReactionEvent`.
- `SetMetadata`: use `createMetadata`. It logs a warning once.
- `ExecutionContext.get(key)` and `getAll(key)` with a string or symbol key: pass a decorator made by `createMetadata`. They log a warning once.
- `respond()`'s `ephemeral` option: use `flags: MessageFlags.Ephemeral`. It logs a warning once.
- `Theme` and its colours: read `useTheme().colors`, and set the colours in `@MeoCord({ theme })`. Reading a `Theme` colour now logs a warning once too, as assigning one already did.
- `MetadataKey`, `CommandMetadata` and `AutocompleteMetadata`: internal names with nothing to use instead. In 5.0 they are no longer exported.

Run ESLint with `@typescript-eslint/no-deprecated`, as a new app's config does, to find every use in your code.
