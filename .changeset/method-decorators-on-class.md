---
'meocord': patch
---

A decorator that goes only on a method stops the bot as the class loads when it is applied to a class, directly or inside an `applyDecorators` composite, with one line naming the class: `Shop: @Defer goes on a method, not on a class.` This covers `@Command`, `@Autocomplete`, `@MessageHandler`, `@ReactionHandler`, `@On`, `@Once`, `@Validate`, `@UsePipe` and `@Defer`, and `@Inject`, which goes on a constructor parameter or a property. `@Defer`, `@Validate`, `@UsePipe`, `@On` and `@Once` did nothing there, and the handler decorators failed with a `TypeError`. Decorators that go on a class or a method, such as `@UseGuard`, `@Cooldown`, `@UseTheme` and those `createMetadata` makes, apply to a controller as before. See [Custom decorators](https://meocord.dev/docs/4.1/custom-decorators).
