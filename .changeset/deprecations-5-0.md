---
'meocord': minor
---

`ReactionEvent` names the second argument a `@ReactionHandler` method receives, `{ user, action }`. `ReactionHandlerOptions` stays as a deprecated alias of it: every other `…Options` type is something you pass in, to a decorator, a function or a constructor.

These are deprecated, and removed in the next major version (5.0). Each still works in 4.x, and its JSDoc names what to use instead:

- `ReactionHandlerOptions`: use `ReactionEvent`. See [the upgrade guide](https://meocord.dev/docs/4.1/migrating#reactionhandleroptions-is-now-reactionevent).
- `SetMetadata`: use `createMetadata`. It logs a warning once.
- `ExecutionContext.get(key)` and `getAll(key)` with a string or symbol key: pass a decorator made by `createMetadata`. They log a warning once. See [the upgrade guide](https://meocord.dev/docs/4.1/migrating#setmetadata-and-string-metadata-keys-are-deprecated).
- `respond()`'s `ephemeral` option: use `flags: MessageFlags.Ephemeral`. It logs a warning once.
- `Theme` and its colours: read `useTheme().colors`, and set the colours in `@MeoCord({ theme })`. Reading a `Theme` colour now logs a warning once too, as assigning one already did. See [the upgrade guide](https://meocord.dev/docs/4.1/migrating#theme-is-deprecated-and-its-colours-changed).
- `MetadataKey`, `CommandMetadata` and `AutocompleteMetadata`: internal names with nothing to use instead. In the next major version (5.0) they are no longer exported. See [the upgrade guide](https://meocord.dev/docs/4.1/migrating#metadatakey-commandmetadata-and-autocompletemetadata-are-deprecated).

Run ESLint with `@typescript-eslint/no-deprecated`, as a new app's config does, to find every use in your code.
