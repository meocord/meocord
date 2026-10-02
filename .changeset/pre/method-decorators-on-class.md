---
'meocord': patch
---

A decorator applied where it can't work is now named where it applies, directly or inside an `applyDecorators` composite:

- **A decorator that goes only on a method, on a class,** stops the bot as the class loads, with one line naming the class: `Shop: @Defer goes on a method, not on a class.` This covers `@Command`, `@Autocomplete`, `@MessageHandler`, `@ReactionHandler`, `@On`, `@Once`, `@Validate`, `@UsePipe` and `@Defer`, and `@Inject`, which goes on a constructor parameter or a property. `@Defer`, `@Validate`, `@UsePipe`, `@On` and `@Once` did nothing there, and the handler decorators failed with a `TypeError`.
- **`@Interceptor`, `@Catch`, `@Pipe` and `@Observer` on a method** stop the bot the same way: `Shop.buy: @Interceptor goes on a class, not on a method.`
- **`@Controller`, `@Service`, `@Guard`, `@CommandBuilder` and `@MeoCord` on a method** still apply nothing, as in 4.0, and now log a warning once: `@Guard on the method Shop.buy is deprecated; in the next major version (5.0) it is refused. Use @Guard on a class instead.` Move the decorator to the class.

Decorators that go on a class or a method, such as `@UseGuard`, `@Cooldown`, `@UseTheme` and those `createMetadata` makes, apply as before. See [Custom decorators](https://meocord.dev/docs/4.1/custom-decorators).
