---
'meocord': patch
---

A mistake MeoCord refuses as the bot loads is reported as one line, and the bot exits 1. This covers an invalid customId pattern, a builder that fails, a `@Cooldown` it cannot count, and what `MeoCordFactory.create()` refuses, such as a message pattern or two handlers for one command. Before, each came out as Node's uncaught-exception report: MeoCord's own source line, a stack through its bundle, and often none of it pointing at your file. Now the line names the handler, and the source file where the stack shows it. Under `start --dev` the watch session keeps running, so the next edit rebuilds. Any other error keeps the runtime's own report.

- `@Cooldown`, `@Validate` given something that isn't a Standard Schema, and `SetMetadata` with a key MeoCord reserves now throw where they are applied, rather than where they are called, so the message can name `Class.method`. Written as decorators, both happen in the same statement. A composite made with `applyDecorators` that includes one of them throws where it is applied; one that is defined but never applied no longer throws.
- New projects' `src/main.ts` calls `MeoCordFactory.create()` inside `bootstrap()`, and sets exit code 1 for any startup error. An existing `main.ts` needs no change: `create()` reports what it refuses itself, and marks it so `isExplainedError()` returns `true`.
