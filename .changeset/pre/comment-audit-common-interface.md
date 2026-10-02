---
'meocord': patch
---

The editor documentation of `meocord/common` and `meocord/interface` matches what the code does:

- **`respond()`'s state.** `message` is the last reply, update or edit, never a follow-up. `lock()` with `disable: 'none'` leaves the message alone. `error()` puts a locked message back as it was before it follows up.
- **Errors.** `GuardDeniedError`, `ValidationError`, `CooldownError` and `CooldownStoreError` say how a message command is answered. A message command gets a reply in the channel for a denial or invalid input. For a cooldown or a store outage it gets nothing, or a direct message under `messages.dmOnCooldown` or `messages.dmOnError`. `CooldownStoreError` also says that the recovery is logged once the store has answered for 30 seconds without failing. The constructors and helpers have their `@param` and `@returns`.
- **`ExecutionContext`.** `getController()` is the class the handler runs on, the subclass for an inherited one. `getParams()` covers pipes too.
- **Cooldown stores.** `MemoryCooldownStore`, `RedisCooldownStore.using` and the Redis constructor document all their parameters, `hashTag` included. On Redis Cluster, a refused call counts against no key unless giving a use back fails.
- **`route().build()`** also throws a `TypeError` for a value that is not of its param's type.
- **Localisation.**
  - `createTranslator` documents `options` and what it returns.
  - `defineCatalog` says which catalogs need it.
  - `LocaleCatalog` says where a locale's `{params}` are checked.
  - A plural needs its `other` form to be read as one.
- **`createToken`** names what its type checks: `TestingModule.get` and a provider's `useValue` or `useFactory`.
- **`Logger`.** A string prints in its tag's colour. Each method documents `args`.
- **App options.**
  - `caseSensitive` covers choice words and flag names.
  - `deleteUsageRepliesAfter` covers a guard's or validation's reason.
  - `replyEmoji` notes that help begins with the info emoji.
  - `help` and `MessageHelp` say that `!help` leaves out hidden and guarded commands.
  - `scope: 'dm'` with a server-only param is refused.
- **`OnShutdown`** runs on `app.stop()` too.
- **Examples.** The examples for a param type's and a theme's `declare module` import what they use.
