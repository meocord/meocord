### Responses and presenters

- **`respond(interaction)`** from `meocord/common` is one place to answer an interaction: `acknowledge()`, `send()`, `edit()`, `followUp()`, `delete()`, `modal()` and `error()`. Each picks the call the interaction's state allows, a reply, an update or an edit, and answers asked for at once run in the order made. It answers through the interaction itself, so it works where a user installed the app, and `error()` never throws. See [Responses](https://meocord.dev/docs/4.1/responses).
- **`@Defer()`** acknowledges an interaction before its guards run, so slow stages and handlers never miss Discord's three seconds. Once the call is allowed, it locks the clicked message's controls under a loading view, and puts them back once the handler answers. `mode: 'auto'` acknowledges only when the handler hasn't answered in time. See [@Defer](https://meocord.dev/docs/4.1/defer).
- **Presenters** draw MeoCord's own answers. `@MeoCord({ presenter })` takes a `ResponsePresenter` whose `loading()` and `error()` return a view, synchronously or not; a view can carry files and show one as its image or thumbnail. An optional `messageError()` and `messageHelp()` draw a message command's error replies and the built-in help. A presenter that fails still leaves the user answered. See [Presenters](https://meocord.dev/docs/4.1/presenters).
- **An unanswered handler is named** in a warning in development, once, so "The application did not respond" has a cause to look for. `@MeoCord({ warnUnanswered })` turns it on or off.

### Handlers and the call pipeline

- **One pipeline** runs every handler, in a fixed order: guards, then interceptors around validation, pipes, cooldowns and the handler, with exception filters around all of it. See [How a call runs](https://meocord.dev/docs/4.1/how-a-call-runs).
- **Guards** can be global, in `@MeoCord({ guards })`. A guard reads typed facts about its handler through `ExecutionContext` and decorators made by `createMetadata`, and throws `GuardDeniedError` to tell the user why. See [Guards](https://meocord.dev/docs/4.1/guards).
- **Interceptors** run around a handler, for timing, logging, caching or mapping errors. See [Interceptors](https://meocord.dev/docs/4.1/interceptors).
- **Exception filters** decide what the user is told when a call throws, and **`UserError`** tells the user about their own mistake: privately for an interaction, in a reply that doesn't ping for a message. See [Exception filters](https://meocord.dev/docs/4.1/exception-filters).
- **`@Validate`** checks a handler's input with any Standard Schema library, such as zod or valibot, and **pipes** turn it into what the handler works with. See [Validation](https://meocord.dev/docs/4.1/validation).
- **Typed options**: a guard, interceptor, filter or pipe declares the params it takes, and every `{ provide, params }` for it is checked against them when the code compiles. `MeoCordOptions` from `meocord/decorator` names what `@MeoCord` takes, for a base two app classes share.
- **Observers** are told as each call starts and once it settles, with how it ended and how long it took, for metrics, audit logs and tracing. See [Observers](https://meocord.dev/docs/4.1/observers).
- **Gateway events**: `@On` and `@Once` handle any discord.js client event, on a controller or a service, through the same pipeline. See [Gateway events](https://meocord.dev/docs/4.1/gateway-events).
- **`HandlerRegistry`** lists every handler with its metadata, for a help command or generated docs. See [Handler discovery](https://meocord.dev/docs/4.1/handler-discovery).
- **Startup checks** name, before the bot logs in, a handler Discord never sends an interaction to, two handlers or builders of which only one could ever run, and a message, reaction or `@On` handler whose intents or partials `clientOptions` lacks, with what to add. A mistake MeoCord refuses as the app loads is reported in one line naming the class and method, and the bot exits 1.

### Theming

- **Themes** name the colours, emojis and button styles MeoCord's answers use by role, such as `primary`, `danger` and the loading emoji. Set them for the app with `@MeoCord({ theme })`, for a controller or handler with `@UseTheme`, and per server or user with `@MeoCord({ themeFor })`, cached and cleared with `ThemeCache`. `useTheme()` reads the call's theme wherever it runs, and an app adds roles of its own to `ThemeColors`, `ThemeEmojis` or `ThemeButtons`. See [Theming](https://meocord.dev/docs/4.1/theming).
- **`respond()` fills in colour**: an answer that sets none takes the theme's `primary`, and MeoCord's error view takes `warning` for the user's own outcome and `danger` for a fault in the bot. `{ fill: false }` sends a message as written.

### Cooldowns

- **`@Cooldown({ seconds, uses, per, by, bypass })`** limits how often a handler runs, per user, channel, server or everyone, or per a value of the call with `by`, such as the account a button acts on. Stack several for layered limits. A call is counted after its guards and validation, so a denied call or bad input spends nothing, and a refusal shows when the next call is allowed as a Discord timestamp. See [Cooldowns](https://meocord.dev/docs/4.1/cooldowns).
- **Stores**: calls are counted in memory by default. `ShardedCooldownStore` counts them in the shard manager, `RedisCooldownStore` on Redis, Valkey and compatible servers, and a store of your own extends `CooldownStore`, which `testCooldownStore` checks against the built-in behaviour. `@MeoCord({ cooldownStoreFailure })` decides whether a call is refused or allowed while the store is down. See [Cooldown stores](https://meocord.dev/docs/4.1/recipes/cooldown-stores).

### Message commands

- **Patterns**: `@MessageHandler('roll {sides:int} {note...?}')` matches a message word by word after a prefix or a mention of the bot. A param can be typed as `int`, `number`, `bool`, `duration`, `member`, `user`, `role` or `channel`, words to choose from such as `{mode:on|off}`, or a type of the app's own, and a pattern takes flags such as `{--bots}` and typed lists. The handler's params are checked against its pattern when the code compiles. See [Message params](https://meocord.dev/docs/4.1/message-params).
- **Starts**: `@MeoCord({ messages: { prefix, mention, caseSensitive } })` sets how commands start, for the app or one handler. With `mention: 'only'`, commands start with a mention of the bot, so the bot needs no privileged MessageContent intent.
- **Answers**: a message that names a command but doesn't fit it gets the command's usage in a reply. `aliases`, `description` and `scope` describe a command; `messages.help` adds a built-in `!help`; `messages.dmOnError` and `messages.dmOnCooldown` tell an author privately what the channel doesn't show. See [Message commands](https://meocord.dev/docs/4.1/message-commands).
- **Fetching**: a member, user, role or channel a message names is fetched only once the handler's guards let the call through, and the uncached members a message names are fetched together.

### Components and routing

- **Typed customId params**: a button's, select menu's or modal's pattern can type a param, as in `@Command('counter/{count:int}', CommandType.BUTTON)`, and the handler receives the value. **`route()`** builds the ids a pattern matches, `route('ticket/{id}').build({ id })`, checked when the code compiles. See [Buttons, selects and modals](https://meocord.dev/docs/4.1/components).
- **Choices and fields arrive in the handler's params**, beside the customId's: a select menu's chosen values and the users, members, roles or channels discord.js resolves for them, and a modal's fields, a file upload's as `Attachment`s.
- **Context menus** give their handler the interaction of the kind the builder's `setType()` names. See [Context menus](https://meocord.dev/docs/4.1/context-menus).
- **Reactions** match a custom emoji by its id as well as its name. See [Reactions](https://meocord.dev/docs/4.1/reactions).

### Sharding

- **`sharding`** in `meocord.config.ts` runs every shard in one process, or each shard in a process of its own with `mode: 'process'`. The shard manager registers the commands once, restarts a shard that exits, stops the bot when every shard would fail alike, and shuts every shard down through its hooks. See [Sharding](https://meocord.dev/docs/4.1/sharding).
- **`ShardContext.call(Service, 'method', ...args)`** runs a service method in every shard and gives each result, typed as the JSON it arrives as. Values pass through JSON in every mode, so a test sees what production gets.

### Providers and lifecycle

- **Providers**: `@MeoCord({ providers })` supplies values, classes and sync or async factories under a class, string, symbol or `createToken` token, injected with `@Inject(token)`. `factoryProvider` types a factory from its `inject` list. See [Services and providers](https://meocord.dev/docs/4.1/services).
- **Lifecycle hooks**: a controller, service, provider or cooldown store that implements `OnReady` or `OnShutdown` runs it once the bot is ready or as it shuts down, in dependency order, within `shutdownTimeout`. See [Lifecycle hooks](https://meocord.dev/docs/4.1/lifecycle-hooks).
- **`app.stop()`** stops the bot from code, through the same shutdown as a signal, for an owner-only shutdown command, a graceful restart or an integration test.

### Testing

- **`invoke` and `dispatch`** run a handler, or route an interaction, a message or a reaction, through everything the bot runs around it, and **`getResponse`** reports what the user was sent. See [Invoke and dispatch](https://meocord.dev/docs/4.1/invoke-and-dispatch).
- **`MeoCordTestingModule.fromApp(App)`** builds a module from the whole app, wired as the bot wires it, with `override*()` to replace a part. `init({ ready: true })`, `close()` and `emit()` run the lifecycle hooks and gateway events. See [Testing](https://meocord.dev/docs/4.1/testing).
- **Mocks** answer as discord.js does, with members, roles, permissions, channels and locales, and `createMockMember`, `createMockUser` and `createMockChannel` take values for their properties. See [Mocks](https://meocord.dev/docs/4.1/mocks).
- **Checks**: `inspectHandler` lists the stages a handler runs, in order, and `resolveRoute` the handler an interaction or a message reaches. `expectCompleteCatalog` checks a translation catalog, and `testCooldownStore` a cooldown store. `resetAllMocks()` resets every mock MeoCord made.

### Localisation

- **`createTranslator`** builds a translator from one catalog per locale, with keys, `{params}` and plural forms checked against the default catalog when the code compiles. `t.localizations(key)` fills a command builder, and `t.for(interaction)` and `t.forGuild(guild)` translate replies. `@MeoCord({ i18n })` makes it injectable as `Translator`. See [Localisation](https://meocord.dev/docs/4.1/localisation).
- **MeoCord's own texts**, such as a usage reply, the built-in help and a cooldown refusal, go through the app's translator: add a `meocord` group to a catalog to translate them.

### The CLI and builds

- **Command registration**: `commands` in `meocord.config.ts` registers globally or to servers, to a development server under `--dev`, at startup or only with `meocord register`, which registers over REST without logging in. In development, commands unchanged since the last start aren't sent again; `meocord start --dev --force-register` sends them anyway. See [Registering commands](https://meocord.dev/docs/4.1/slash-commands#registering-commands).
- **`meocord create`** commits the app's lockfile with it, and the app starts with `npm start`. Its samples use 4.1's patterns, and their specs test what each handler answers.
- **`meocord generate`** writes observers, exception filters, interceptors and pipes, and gives each component a customId from its name. A controller's spec tests what its handler answers.
- **`meocord start --dev`** rebuilds and restarts the bot on changes to the source, `meocord.config.ts`, `tsconfig.json` and the development `.env` files, one bot at a time, through the bot's own shutdown, and keeps the last good build running while the code doesn't compile. See [The CLI](https://meocord.dev/docs/4.1/cli).
- **`.env` files**: a new app reads `.env.<mode>.local`, `.env.local`, `.env.<mode>` and `.env` on every runtime, however it is started.
- **Self-contained builds** pack native addons into `dist`, from npm, Yarn, pnpm and Bun projects alike, and run on Bun as on Node.js. `optionalExternals` covers a package a dependency tries to load and runs without. See [Self-contained builds](https://meocord.dev/docs/4.1/self-contained-builds).
- **Logs and stack traces**: stack traces name your source files and lines on Node.js and Bun, in development and production, and `logLevel`, or `MEOCORD_LOG_LEVEL` for one run, sets which lines the logger prints. See [Configuration](https://meocord.dev/docs/4.1/configuration).
- **`dist/cli.json`** in the package describes every CLI command and option as data, for a tool that reads them.
