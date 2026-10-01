---
'meocord': minor
---

`@MeoCord`'s options and `@Validate`'s pipes have names you can import:

- **`MeoCordOptions`**, from `meocord/decorator`, is what `@MeoCord` takes, each option documented where your editor shows it as you write the object. Name a base two app classes share with it; its guard, interceptor and filter lists are still checked against the classes they hold.
- **`ValidatePipes<S>`**, from `meocord/interface`, is the pipes `@Validate` takes for schema `S`, so a decorator of your own that wraps `@Validate` checks the pipes it passes on against the schema, as `@Validate` does.

A misused decorator's message names it more exactly: `@Command` called with the wrong interaction names the builder it was declared with, as `@Command('stats', StatsBuilder)`, and puts the right article before the class, `an AutocompleteInteraction`; a stage entry that is a string is quoted, `"Allow" is not a class`, and one that is a list, as `guards: [[StaffGuard]]` writes, is named as one, `an array is not a class`, rather than `{ provide } does not name a class`.
