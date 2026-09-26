---
'meocord': minor
---

`UserError` in `meocord/common` is for a mistake the user can fix, such as too few coins or an account that does not exist, rather than a fault in the bot. Throw it from a handler, a pipe, a service or a guard: the built-in fallback shows its message privately for an interaction, even after `@Defer`, and as a reply to a message, without pinging its author, and logs it only at debug level.

```typescript
throw new UserError(`You need ${missing} more coins.`, { code: 'shop.poor', context: { missing } })
```

- `code` and `context` let an exception filter or a presenter phrase it otherwise, such as in the user's language; a presenter's `error()` receives the error with the interaction.
- `respond(interaction).error(userError)` shows its message privately by default.
- Observers see the new outcome `'refused'`, with `handled` set, apart from `'error'`, so metrics tell the user's mistakes from the bot's faults. An observer that switches over every `DispatchOutcome` gains a case to handle.
