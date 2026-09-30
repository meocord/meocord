---
'meocord': patch
---

More mistakes MeoCord refuses as the bot loads are reported as one line, naming what to change first, instead of `Error during startup:` and a stack. This covers two classes of one name when either uses `@Cooldown` or `@Once`, `@Validate`, `@UsePipe` or `@Cooldown` on a handler they don't apply to, two component `customId` patterns that match the same ids, `sharding` settings in `meocord.config.ts` that `clientOptions` contradicts, and a self-contained build started on a platform its native addons weren't built for.

- Two component patterns that match the same ids, and the warning about two that can, are now reported by `MeoCordFactory.create()`, before `start()` attaches anything, and `meocord register` reports them too.
- The messages lead with the class, handler or file they are about, such as `Shop: two classes have this name; …`. A test that matches the old wording needs updating.
