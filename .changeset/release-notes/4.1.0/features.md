### Responses and presenters

- **`respond(interaction)` answers any interaction**: acknowledge, send, edit, follow up or report an error as its state allows, in user-installed apps too ([docs](https://meocord.dev/docs/4.1/responses)).
- **`@Defer()` acknowledges before guards run**, then locks the clicked message's controls under a loading view until the handler answers; `mode: 'auto'` defers only when needed ([docs](https://meocord.dev/docs/4.1/defer)).
- **Presenters draw MeoCord's own answers**: `@MeoCord({ presenter })` styles loading, error and help views, for messages too, async or not, with files; a failed drawing still answers ([docs](https://meocord.dev/docs/4.1/presenters)).
- **Unanswered handlers are named** in a development warning, which `@MeoCord({ warnUnanswered })` toggles.

### Handlers and the call pipeline

- **One fixed pipeline** runs every handler: guards, then interceptors around validation, pipes, cooldowns and the handler, inside exception filters ([docs](https://meocord.dev/docs/4.1/how-a-call-runs)).
- **Guards** can be global, in `@MeoCord({ guards })`; they read typed facts through `ExecutionContext` and `createMetadata`, and throw `GuardDeniedError` to say why ([docs](https://meocord.dev/docs/4.1/guards)).
- **Interceptors** wrap a handler, for timing, logging, caching or mapping errors ([docs](https://meocord.dev/docs/4.1/interceptors)).
- **Exception filters and `UserError`** decide what the user sees when a call throws; a `UserError` answers privately, or in a reply that doesn't ping ([docs](https://meocord.dev/docs/4.1/exception-filters)).
- **`@Validate` and pipes** check input with any Standard Schema library and reshape it ([docs](https://meocord.dev/docs/4.1/validation)).
- **Typed options**: each `{ provide, params }` is checked against the params its stage declares, and `MeoCordOptions` names what `@MeoCord` takes.
- **Observers** hear each call start and settle, with its outcome and duration ([docs](https://meocord.dev/docs/4.1/observers)).
- **`@On` and `@Once`** handle any discord.js event, on a controller or a service, through the same pipeline ([docs](https://meocord.dev/docs/4.1/gateway-events)).
- **`HandlerRegistry`** lists every handler with its metadata ([docs](https://meocord.dev/docs/4.1/handler-discovery)).
- **Startup checks** name dead handlers, shadowing handlers or builders, and missing intents or partials before login; a refused app gets one line naming `Class.method` and exits 1.

### Theming

- **Themes** name colours, emojis and button styles by role, set with `@MeoCord({ theme })`, `@UseTheme` or per server and user with `themeFor` and `ThemeCache`; `useTheme()` reads them, and apps add roles ([docs](https://meocord.dev/docs/4.1/theming)).
- **`ThemeResolver` classes** look themes up with the app's services: `themeFor` takes one, resolved from the container, cached as the functions are ([docs](https://meocord.dev/docs/4.1/theming)).
- **`respond()` fills in colour**: an answer without one takes `primary`, error views take `warning` or `danger`, and `{ fill: false }` sends as written.

### Cooldowns

- **`@Cooldown`** limits a handler per user, channel, server, everyone or a `by` value; cooldowns stack, count only calls that pass guards and validation, and show the wait as a Discord timestamp ([docs](https://meocord.dev/docs/4.1/cooldowns)).
- **Cooldown stores**: memory by default, `ShardedCooldownStore` across shards, `RedisCooldownStore` on Redis or Valkey, or your own, checked with `testCooldownStore`; `cooldownStoreFailure` decides calls while one is down ([docs](https://meocord.dev/docs/4.1/recipes/cooldown-stores)).

### Message commands

- **Patterns**: `@MessageHandler('roll {sides:int} {note...?}')` matches after a prefix or mention, with typed params such as `int`, `member` or the app's own, flags and lists, checked at compile time ([docs](https://meocord.dev/docs/4.1/message-params)).
- **Starts**: `messages: { prefix, mention, caseSensitive }` sets how commands start; `mention: 'only'` needs no MessageContent intent.
- **Answers**: a misfit gets its usage; `aliases`, `description` and `scope` describe a command, `help` adds `!help`, and `dmOnError` and `dmOnCooldown` DM the author ([docs](https://meocord.dev/docs/4.1/message-commands)).
- **Fetched after guards**: named members, users and channels are fetched only once guards pass, uncached members together; a role is read from the cache.

### Components and routing

- **Typed customId params** such as `{count:int}` arrive as values, and `route()` builds matching ids, checked at compile time ([docs](https://meocord.dev/docs/4.1/components)).
- **Select choices and modal fields arrive in params**, with resolved users, members, roles and channels, and file uploads as `Attachment`s.
- **Context menu handlers are typed** from the builder's `setType()` ([docs](https://meocord.dev/docs/4.1/context-menus)).
- **Reactions match a custom emoji by id** as well as by name ([docs](https://meocord.dev/docs/4.1/reactions)).

### Sharding

- **`sharding`** runs shards in one process or, with `mode: 'process'`, one each; the manager registers once, restarts exited shards, stops when all would fail, and shuts shards down through their hooks ([docs](https://meocord.dev/docs/4.1/sharding)).
- **`ShardContext.call`** runs a service method in every shard, each result typed as the JSON it arrives as, in tests too.

### Providers and lifecycle

- **Providers** supply values, classes and async factories under any token, `createToken` included, injected with `@Inject`; `factoryProvider` types a factory ([docs](https://meocord.dev/docs/4.1/services)).
- **`OnReady` and `OnShutdown`** run in dependency order on controllers, services, providers and the cooldown store, within `shutdownTimeout` ([docs](https://meocord.dev/docs/4.1/lifecycle-hooks)).
- **`app.stop()`** shuts the bot down from code, as a signal does.

### Testing

- **`invoke` and `dispatch`** run a handler, or route an interaction, message or reaction, through the pipeline; `getResponse` shows what was sent ([docs](https://meocord.dev/docs/4.1/invoke-and-dispatch)).
- **`MeoCordTestingModule.fromApp(App)`** wires the whole app as the bot does, with `override*()`; `init({ ready: true })`, `close()` and `emit()` run hooks and events ([docs](https://meocord.dev/docs/4.1/testing)).
- **Mocks behave like discord.js**, with members, roles, permissions, channels and locales; `createMockMember`, `createMockMessage` and the rest take properties, a message its `author`, and `createMockInteraction` Discord's `authorizingIntegrationOwners` map ([docs](https://meocord.dev/docs/4.1/mocks)).
- **Checks**: `inspectHandler`, `resolveRoute`, `expectCompleteCatalog`, `testCooldownStore` and `resetAllMocks()`.

### Localisation

- **`createTranslator`** checks keys, `{params}` and plurals against the default catalog at compile time; `t.localizations()` fills builders, `t.for()` translates replies, and `@MeoCord({ i18n })` injects it ([docs](https://meocord.dev/docs/4.1/localisation)).
- **MeoCord's own texts** translate through a `meocord` group in the app's catalog.

### The CLI and builds

- **Command registration** goes global, per server or to a dev server, at startup or with `meocord register` over REST; unchanged dev commands skip resending unless `--force-register` ([docs](https://meocord.dev/docs/4.1/slash-commands#registering-commands)).
- **`meocord create`** commits the lockfile, adds `npm start`, and writes samples whose specs test what they answer.
- **`meocord generate`** adds observers, filters, interceptors and pipes, a customId per component, and specs that test the answer.
- **`meocord start --dev`** restarts on source, config, `tsconfig.json` and dev `.env` changes, one bot at a time, keeping the last good build while code doesn't compile ([docs](https://meocord.dev/docs/4.1/cli)).
- **`.env` files**: a new app reads `.env.<mode>.local`, `.env.local`, `.env.<mode>` and `.env` on every runtime.
- **Self-contained builds** pack native addons from any package manager and run on Bun too; `optionalExternals` covers optional packages ([docs](https://meocord.dev/docs/4.1/self-contained-builds)).
- **Source-mapped stacks and `logLevel`**: traces name your source lines in production too, and `logLevel` or `MEOCORD_LOG_LEVEL` sets what prints ([docs](https://meocord.dev/docs/4.1/configuration)).
- **`dist/cli.json`** describes every CLI command and option as data.
