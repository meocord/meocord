### Deprecations

- **Names removed in 5.0.** Each still works and its JSDoc names the replacement; `@typescript-eslint/no-deprecated` finds them outside specs.
  - `Theme`: use `useTheme().colors` and `@MeoCord({ theme })`; reading or setting a colour warns once ([guide](https://meocord.dev/docs/4.1/migrating#theme-is-deprecated-and-its-colours-changed)).
  - `SetMetadata` and string metadata keys: use `createMetadata` and `ExecutionContext.get(decorator)`; each warns once ([guide](https://meocord.dev/docs/4.1/migrating#setmetadata-and-string-metadata-keys-are-deprecated)).
  - `ReactionHandlerOptions`: renamed `ReactionEvent` ([guide](https://meocord.dev/docs/4.1/migrating#reactionhandleroptions-is-now-reactionevent)).
  - `MetadataKey`, `CommandMetadata`, `AutocompleteMetadata`: internal; drop the import ([guide](https://meocord.dev/docs/4.1/migrating#metadatakey-commandmetadata-and-autocompletemetadata-are-deprecated)).
- **`@Autocomplete<void>` loses its type parameter in 5.0.** Lint misses it: search for `@Autocomplete<` and write `@Autocomplete(…)`.
- **Retrying `start()` after a failed login warns,** logging in again with its handlers, and rejects in 5.0. Make a new app with `MeoCordFactory.create` per attempt; retrying after a provider failure stays supported ([guide](https://meocord.dev/docs/4.1/migrating#retrying-start-after-a-failed-login-is-deprecated)).
- **`@MessageHandler('')` warns,** and 5.0 refuses it. Write `@MessageHandler()` ([guide](https://meocord.dev/docs/4.1/migrating#messagehandler-logs-a-warning)).
- **Handlers that never run warn at startup,** and 5.0 refuses to start:
  - a command or autocomplete handler Discord never sends, such as an unregistered subcommand path, a renamed builder or an option without autocomplete ([guide](https://meocord.dev/docs/4.1/migrating#a-command-handler-discord-never-sends-logs-a-warning));
  - a second `@Autocomplete` for one option ([guide](https://meocord.dev/docs/4.1/migrating#a-second-autocomplete-for-one-option-logs-a-warning));
  - a handler on a class that isn't a controller ([guide](https://meocord.dev/docs/4.1/migrating#a-handler-on-a-class-that-isnt-a-controller-logs-a-warning)).
- **Changes in 5.0, warned now:**
  - a re-declared handler on another route still answers its inherited one; in 5.0 its own routes replace it ([guide](https://meocord.dev/docs/4.1/migrating#a-re-declared-handler-that-keeps-its-inherited-route-logs-a-warning));
  - between equally specific overlapping patterns, the first listed runs; in 5.0, the more spelled-out one does ([guide](https://meocord.dev/docs/4.1/migrating#overlapping-component-patterns-meocord-5-prefers-the-one-that-spells-out-more)).
