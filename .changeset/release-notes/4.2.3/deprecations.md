### Deprecations

- **Warned now, refused in 5.0.** Each runs as before with a warning at startup or when the class is decorated; 5.0 stops the bot or the command there. Fix the setup the warning names:
  - a handler decorator such as `@Command`, `@MessageHandler` or `@On` on a static method, or `@Inject` on a static property, which never runs: move it to an instance member;
  - a pattern of spaces alone, `@MessageHandler('   ')`, which runs for every message as `@MessageHandler('')` does: write `@MessageHandler()`;
  - two message patterns that differ only in which params are optional: the one with required params ahead answers, and startup names both;
  - two flags whose names differ only in case on a command that reads flags in any case, such as `{--v}` and `{--V}`: rename one, or set `caseSensitive: true`;
  - on a class the app only makes (one only a stage or the presenter injects, or a provider's `useClass`, `useValue` or `useFactory` instance), a handler a listed service's would be refused for, such as `@Cooldown` on an `@On`, or an `@Once` on a class that shares another's name; and an `@On` on a class made for each call because it injects `ExecutionContext`: move it to a service;
  - `messages.deleteUsageRepliesAfter` over 2,147,483 seconds (about 24.8 days), which now keeps usage replies;
  - with `bundleDependencies`, two installed copies of one native addon that bundled code imports, of which one is packed: install one version ([docs](https://meocord.dev/docs/4.2/self-contained-builds)).
- **Changing in 5.0, warned now:**
  - a static `prefix: []` takes messages with no prefix; in 5.0 it starts no command. Write `''` for no prefix;
  - a `@CommandBuilder` subclass that gives no `guilds` inherits its base's; in 5.0 it registers in the configured scope. Declare `guilds` on the subclass to keep them;
  - a subclass that re-decorates an inherited handler keeps the routes and `@On`/`@Once` events it inherits, and startup names them; in 5.0, `inheritedRoutes: 'replace'` is the default and drops them. Set it now to see that;
  - a builder whose `guilds` holds no id, such as an unset environment variable, isn't registered, and `meocord register` still exits 0; in 5.0 it exits 1 ([docs](https://meocord.dev/docs/4.2/slash-commands)).
