# meocord

## 4.1.0-beta.8

### Minor Changes

- [#273](https://github.com/meocord/meocord/pull/273) [`ebd546e`](https://github.com/meocord/meocord/commit/ebd546efe1327d1a4353ea014875ba87aad956a7) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A message command can tell its author, in a direct message, what the channel doesn't show. Without a filter, a message command's unexpected error is only logged and a cooldown refusal is skipped silently, since a reply in the channel can't be private. Two options turn on a direct message instead, both off by default:

  - `@MeoCord({ messages: { dmOnError: true } })` tells the author the command failed, naming the command, the channel and the server. The error is still logged.
  - `@MeoCord({ messages: { dmOnCooldown: true } })` tells the author how long to wait, once per wait: retries before it ends send nothing more. The notice is counted in the app's cooldown store, so it holds across shards with a shared store.

  Only patterned message handlers are answered, and only when no filter handled the error. A command sent in a direct message is answered there. A member whose direct messages are closed is not told, at debug level. Guard, validation, usage and `UserError` replies are unchanged. The texts are `meocord.dm.error` and `meocord.dm.cooldown`, translatable like MeoCord's other texts, in the server's language.

- [#269](https://github.com/meocord/meocord/pull/269) [`a18e948`](https://github.com/meocord/meocord/commit/a18e9482ca6423bb588d967010bb4125126b351b) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `meocord/testing`: `createMockUser(props?)` and `createMockChannel(Class, props?)` take values for the mock's properties, as `createMockInteraction` does, so `createMockUser({ bot: true })` makes a bot and `createMockChannel(TextChannel, { name: 'general' })` a named channel. Neither took any before, so a bot user took `Object.assign`. The managers of a mock channel, `messages`, `threads` and a thread's `members`, and a mock guild's `bans`, have a real, empty `cache`, as a guild's `members`, `roles` and `channels` do, where reading `cache.size` gave a stub object.

### Patch Changes

- [#274](https://github.com/meocord/meocord/pull/274) [`4827e0f`](https://github.com/meocord/meocord/commit/4827e0f81536816df741af2ef25e430fc19c7292) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `meocord start --dev` runs one bot at a time. A build that finished while the previous bot was still shutting down, which happens when the watcher reports one change twice or a file changes again during a slow `onShutdown`, started a second bot at once, alongside the one stopping. Once that one exited, a third started. The second was left running and connected to Discord, and a restart or Ctrl+C no longer reached it. Now builds that finish during a restart start a single bot from the latest build, once the previous one has exited, and a Ctrl+C during a restart waits for the stopping bot and starts nothing.

- [#266](https://github.com/meocord/meocord/pull/266) [`6be7120`](https://github.com/meocord/meocord/commit/6be71205ec145a730137135dc92b76bd70a30cf6) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `meocord start --dev` restarts the bot once per change, and the new bot always starts. The watcher took the tsconfig copy MeoCord writes for each build for a change of its own and rebuilt right after the first build, restarting the bot while it was still logging in. A stop that lands during login also left the old process running: discord.js's `destroy()` does not settle while the gateway waits for READY, so the bot came online after "Shutting down bot..." and the replacement never started.

  - A stop during login now ends the start at once, and ends with "Bot has shut down" as any other stop does: no `onReady` hook runs, `start()` rejects with an error `isExplainedError()` recognises, and the process exits 0. The client is closed once its login completes. This also fixes a Ctrl+C during login in production, which did nothing until a second one forced exit 1.
  - Edits to `tsconfig.json` now rebuild and restart the bot under `start --dev`, as edits to `meocord.config.ts` do. A changed `meocord.config.ts` is compiled again before the rebuild, and one that does not compile, such as a file saved mid-edit, is reported and leaves the running bot in place instead of ending the session.
  - If an application still has not exited after its `shutdownTimeout` and a short grace period, `start --dev` kills it with a warning and starts the new build.

- [#265](https://github.com/meocord/meocord/pull/265) [`2d1ca03`](https://github.com/meocord/meocord/commit/2d1ca03384306a45ae34912652738a3eae80d5a2) Thanks [@l7aromeo](https://github.com/l7aromeo)! - An answer MeoCord fails to build is reported as a fault, not passed off as Discord refusing it. When the text of a usage reply, a `UserError` reply or the answer to an interaction's error cannot be written, or a presenter throws while building an error view, the bot logs an error naming the call, and observers are told the call ended in `'error'` with that fault. Before, it was logged only at debug level as "Could not reply", and the message went unanswered with no trace at the default log level. A send that fails is logged at debug level only when Discord refused it, a `DiscordAPIError` such as a missing permission; any other failure is logged as an error. In a testing module, such a fault rejects `dispatch()`. `respond(interaction).error()` still never throws, and logs a presenter that fails as an error.

- [#275](https://github.com/meocord/meocord/pull/275) [`7d70abf`](https://github.com/meocord/meocord/commit/7d70abfbc1b1687ef6ea7d97167be26d7ee08fa4) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Two JSDoc corrections. `@On` and `@Once` said an event handler runs with the app's global guards, interceptors and filters; its class's and its own run too, as they always have. `MeoCordTestingModule.fromApp`'s remarks now say plainly that `compile()` runs no factory and `init()` runs each one the module provides, so a factory the test replaces never runs, and one it keeps runs at `init()`.

- [#270](https://github.com/meocord/meocord/pull/270) [`9cb86a4`](https://github.com/meocord/meocord/commit/9cb86a4db294fe31cb0cfbbc47daa8a627e5ef25) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A mistake MeoCord refuses as the bot loads is reported as one line, and the bot exits 1. This covers an invalid customId pattern, a builder that fails, a `@Cooldown` it cannot count, and what `MeoCordFactory.create()` refuses, such as a message pattern or two handlers for one command. Before, each came out as Node's uncaught-exception report: MeoCord's own source line, a stack through its bundle, and often none of it pointing at your file. Now the line names the handler, and the source file where the stack shows it. Under `start --dev` the watch session keeps running, so the next edit rebuilds. Any other error keeps the runtime's own report.

  - Every refusal begins with what it is on, `Class.method:`, `Class:` or `App:` for `@MeoCord` options, followed by the decorator and the problem, such as `SampleButtonController.handleButtonWithId: Invalid pattern …` or `App: @MeoCord({ guards }): null is not a class.` A test that matches a refusal's whole text may need its expected message updated.
  - `@Cooldown`, `@Validate` given something that isn't a Standard Schema, and `SetMetadata` with a key MeoCord reserves now throw where they are applied, rather than where they are called, so the message can name `Class.method`. Written as decorators, both happen in the same statement. A composite made with `applyDecorators` that includes one of them throws where it is applied; one that is defined but never applied no longer throws.
  - New projects' `src/main.ts` calls `MeoCordFactory.create()` inside `bootstrap()`, and sets exit code 1 for any startup error. An existing `main.ts` needs no change: `create()` reports what it refuses itself, and marks it so `isExplainedError()` returns `true`.

- [#268](https://github.com/meocord/meocord/pull/268) [`5a69c71`](https://github.com/meocord/meocord/commit/5a69c710522fed8dfdb46f8e1f436fc68ee8632e) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `meocord/testing`: mocks read the data Discord always sends as Discord sends it. A mock guild's `preferredLocale` was an empty stub object, so `t.forGuild(createMockGuild())`, and a message command's usage reply on a mock message, came out in the translator's default language whatever the test meant. It is now `'en-US'`, and a guild's `name`, a user's `username`, a message's `pinned`, a channel's `type` and the rest have Discord's values: `false` for a flag, `null` for what may be absent, and snowflake ids. `tag`, `displayName`, `createdAt` and `url` are computed from them as discord.js does. `createMockGuild` takes `name` and `preferredLocale`, so `createMockGuild({ preferredLocale: Locale.Indonesian })` gives a server that speaks Indonesian.

  An interaction with a `guildId` has its user as its `member`, and its `guildLocale` is the `preferredLocale` of the `guild` it is given, as Discord sends it, where it was always `'en-US'`. A mock message has its author as its `member` in a server, and `null` in a direct message, and its `inGuild()` answers as discord.js's does, where it returned `undefined`. A test that reads a property a mock has no value for now gets that value instead of a stub object; one that relied on the stub there sets the property itself. `commandName`, `customId` and a message's `content` stay the test's to give.

- [#272](https://github.com/meocord/meocord/pull/272) [`a8f454d`](https://github.com/meocord/meocord/commit/a8f454d20a3f8dc141e90f9aafae5a39caa8761f) Thanks [@l7aromeo](https://github.com/l7aromeo)! - The JSDoc says where every pipeline stage runs, so the API reference can show it on each entry. `@Guard`, `@Interceptor`, `@Catch` and `@Pipe` gain the `@pipeline` tag their `@UseGuard`, `@UseInterceptor`, `@UseFilter` and `@UsePipe` counterparts already had, and so do `GuardInterface`, `InterceptorInterface`, `ExceptionFilter`, `PipeInterface` and `DispatchObserver`. The stage names are those of the pipeline figure on meocord.dev: `@Observer` runs at `observers-start` and `observers-settled`, and `@Defer`'s second step at `defer-lock`.

- [#263](https://github.com/meocord/meocord/pull/263) [`925225d`](https://github.com/meocord/meocord/commit/925225de08e6a25d55760af6cb9501dc27854b0e) Thanks [@l7aromeo](https://github.com/l7aromeo)! - The JSDoc of `ContextMenuCommandBuilder.setType`, as MeoCord types it, says to leave a context menu builder's `build()` return type inferred. Written out as `ContextMenuCommandBuilder`, it drops the kind `setType()` gave, so a handler of the other kind compiles and is caught only as the bot starts.

- [#271](https://github.com/meocord/meocord/pull/271) [`8b1d9db`](https://github.com/meocord/meocord/commit/8b1d9db951b6c89225734c82336a3dba3b672c9c) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A new app's `package.json` has a `start` script, `meocord start --prod`, so `npm start`, `bun run start` and a host that runs `npm start` for you, as many Node hosts do by default, start the production build. `start:prod` is unchanged, and building stays its own step: run `build:prod` before `start`. An existing app can add the line to its `scripts` to get the same.

## 4.1.0-beta.7

### Minor Changes

- [#257](https://github.com/meocord/meocord/pull/257) [`afa139d`](https://github.com/meocord/meocord/commit/afa139debcc8e4accfe3f5c2a8997dbe9d0fb4d3) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `MeoCordTestingModule.fromApp(App, options?)` builds a testing module from a whole `@MeoCord` app, wired as the bot wires it: its controllers, services, providers and cooldown store, with its stages, translator, presenter, message options, theme and observers. A test no longer lists the app's controllers and providers again. `options.providers` replaces the app's by token, before anything is made, so a database factory the test replaces never runs; `options.controllers` and `options.observers` add a test's own; the `override*()` methods still apply. The app's services are made at `init()`, as the bot makes them before it logs in.

  A class that injects the Discord `Client` in a testing module that was given none is now refused with what to do, `{ provide: Client, useValue: createMockClient() }`, where it read `No bindings found for service: "Client"`.

- [#258](https://github.com/meocord/meocord/pull/258) [`f9189b9`](https://github.com/meocord/meocord/commit/f9189b9b1008a9fee97ede546466b302afe71e92) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A context menu handler is typed with the kind its builder's `setType()` names. With `.setType(ApplicationCommandType.User)`, `@Command('Report user', ReportUserBuilder)` gives the handler a `UserContextMenuCommandInteraction`, and a handler declaring `MessageContextMenuCommandInteraction` no longer compiles. It is caught however the interaction is imported, an `import { type … }` included, where the check as the bot starts needed it imported as a value. Such a handler was broken anyway: dispatch sends a builder's command only to a handler of its kind, so its first click already failed. Declare the kind the builder's `setType()` names.

  Nothing new is needed: MeoCord adds the kind to discord.js's `ContextMenuCommandBuilder.setType` for the compiler alone, and nothing changes at runtime. A builder whose kind the compiler can't tell, one that never calls `setType()` or picks the kind at runtime, gives either kind as before, and is still checked as the bot starts.

### Patch Changes

- [#260](https://github.com/meocord/meocord/pull/260) [`18334ec`](https://github.com/meocord/meocord/commit/18334ecb55c1301586606e4c8d7a9a6ddf4173a1) Thanks [@l7aromeo](https://github.com/l7aromeo)! - The package includes `dist/cli.json`, which describes the `meocord` CLI: every command and subcommand, with its aliases, arguments, options, defaults, choices and descriptions, in the order `meocord --help` lists them. The build writes it from the program the CLI runs, so it always matches the installed version, and a tool can read it as data, without running the CLI. `schemaVersion` changes only when a change to the shape would break a reader.

- [#261](https://github.com/meocord/meocord/pull/261) [`701890b`](https://github.com/meocord/meocord/commit/701890b82e7edad7fa020cc4764f4fd7c5fdfb51) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A message `@Defer` locked is put back when its handler answers only with a follow-up, returns without answering, or throws. On a message with an uploaded file, such as an image in a Components V2 card, a click soon after the message was sent could leave it locked instead: its buttons and selects disabled under the loading view, for good. The lock's edit has Discord process the uploaded file again, and MeoCord, seeing the message change from what its edit returned, took it for someone else's edit and left it alone. It now keeps the time Discord stamps on its own edit, and leaves a message as it is only when it shows a later edit. The file stays attached, and a select that was clicked comes back with its options and defaults as the message had them, not the user's pick.

  `meocord/testing`: a mock interaction's `editReply()` and `fetchReply()` now keep its message as Discord does. Components get their ids, media resolves, a file uploaded with the message comes back loading from the first edit that keeps it, and each edit is stamped with its time. `createMockMessage` takes `editedTimestamp`.

- [#259](https://github.com/meocord/meocord/pull/259) [`01f11d4`](https://github.com/meocord/meocord/commit/01f11d4a0b024ce5a1fd5b83acea5476ae58ca56) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A bot whose commands only one handler or one builder could ever take stops when it is created, as `meocord start`, `meocord register`, a shard manager and a testing module build it, naming both:

  - two handlers of one slash command name or subcommand path, or of one context menu name and kind, where only the first ever ran: `StatsController.stats and AdminController.adminStats both handle the slash command "stats", so only StatsController.stats would ever run.`;
  - two builder classes that build one application command, where only the first was registered, with a warning: `StatsBuilder on StatsController.stats and CopiedStatsBuilder on StatsController.statistics both build the slash command "stats"…`.

  One builder on a command and its own subcommand paths is still one command, and a user and a message context menu may still share a name. See [Upgrading to 4.1](https://meocord.dev/docs/4.1/migrating#two-handlers-of-one-command-stop-the-bot).

- [#254](https://github.com/meocord/meocord/pull/254) [`2b02b0e`](https://github.com/meocord/meocord/commit/2b02b0ea9e8ad9f8e594ae14e32ba76400ee3275) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A slash command builder given on a subcommand path, such as `@Command('settings notify email', SettingsCommandBuilder)`, is named for what it is. A builder that builds its name from the path fails as before, now with a message naming the handler: `SettingsSlashController.notifyEmail declares the builder SettingsCommandBuilder on "settings notify email", which is a subcommand path: the builder of its command, "settings", describes it`, with what to declare instead, where it said "Invalid string format" and advised checking name lengths. A builder that names its command itself keeps working, and is warned about once as the bot starts, with the same advice: declare the handler with `@Command('settings notify email', CommandType.SLASH)`, and give the builder to `@Command('settings')`.

- [#255](https://github.com/meocord/meocord/pull/255) [`2852892`](https://github.com/meocord/meocord/commit/2852892922694fb883c8244b9469781e152468c1) Thanks [@l7aromeo](https://github.com/l7aromeo)! - An observer is told a message command's usage error as `'invalid'`, the user's input that doesn't fit, as it is told a `ValidationError`. It was told `'error'`, so metrics counted a user's typo as a fault of the bot. This covers a word of the wrong type, a param left out, a flag the command lacks, a command sent where it doesn't work, and a parent's words alone, answered with its subcommands. A dashboard that counts `'error'` sees these under `'invalid'` from this release.

## 4.1.0-beta.6

### Minor Changes

- [#228](https://github.com/meocord/meocord/pull/228) [`8e1b936`](https://github.com/meocord/meocord/commit/8e1b9368772588f2a5a3269dd2aff8da1a9878c1) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `@MeoCord({ messages: { mention: 'only' } })` starts every message command in a server with a mention of the bot and nothing else, neither a prefix nor the message as plain text, while a direct message starts as usual, after the prefix or as it is; `@MessageHandler(pattern, { mention: 'only' })` does the same for one command beside the app's prefix. Discord sends a message's text without the privileged MessageContent intent when the message mentions the bot, and in direct messages, so such commands, and commands with `scope: 'dm'`, no longer need it: MeoCord's startup warning about MessageContent names only a `@MessageHandler()` listener and commands a prefix or plain text starts in a server, and says what still arrives without it. A mention-only bot can run without the intent, and without applying for it once verified. In a test, `resolveRoute(App, { content, dm: true })` reads a message as a direct message.

- [#252](https://github.com/meocord/meocord/pull/252) [`2d0575f`](https://github.com/meocord/meocord/commit/2d0575faba17cc4d458a6da20bb189dfa9506942) Thanks [@l7aromeo](https://github.com/l7aromeo)! - MeoCord's own texts for users go through the app's translator: a message command's usage and each thing wrong with it, the built-in `!help` and the labels of `HandlerRegistry.messageHelp`, cooldown and cooldown store refusals, "Command not found!", the generic error, and the default presenter's "Working on it…" and "Oops!". Add a `meocord` group to any catalog given to `@MeoCord({ i18n })`, all of it or part, such as `meocord: { usage: { heading: 'Cara pakai: {usage}' } }`; a text a locale leaves out stays in English, line by line. Answers to an interaction are in the user's language, replies to a message in the server's preferred language, or the default locale's in a DM. MeoCord's English stands as the English catalog, so an English-speaking user or server gets it even under a default locale in another language, unless the app's own `en-US` or `en-GB` catalog words the text. The keys and their English are in the new `MeoCordMessages` type from `meocord/interface`, and a key MeoCord lacks, or a `{param}` its English text lacks, fails to compile. Without `i18n`, every text is the English one it is today.

  - `translateError(error, t, target)` from `meocord/common` returns the text the fallback answers an error with, in the language of an interaction, a message or a locale, for an exception filter that answers MeoCord's errors its own way.
  - A message param type takes `labelKey`, a message key of the app's catalog, for a label in each server's language. `@MeoCord` refuses one without `i18n`, or one the default catalog has no message for.
  - `expectCompleteCatalog(t, { meocord: true })` requires every locale that is not English to translate each of MeoCord's texts. Without the option it reports only a `meocord` key MeoCord lacks.

  See [Localisation](https://meocord.dev/docs/4.1/localisation).

- [#251](https://github.com/meocord/meocord/pull/251) [`b4a9e58`](https://github.com/meocord/meocord/commit/b4a9e5841427c47322621be289e0d0ca8c1b0ee2) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Message commands have a built-in help command, off unless asked for: `@MeoCord({ messages: { prefix: '!', help: true } })` answers `!help` with the commands the caller can use where they asked, one line each with its handler's `description`, and `!help <command>` with one command's usage, params, aliases and where it works. `help: { command, aliases }` names other words. The list leaves out a handler with a guard on its method or controller, since it runs no guards, and one whose new `hidden: true` option asks to be left out; named, either is shown. `!help` for words with no handler of their own lists their subcommands, and an unknown name or nothing to list gets a line saying so. It answers only after a prefix or mention, and an app's own `help` handler always runs instead, with a warning at startup. With `replyEmoji` the reply begins with the theme's `emojis.info`.

  The reply follows the app's translations, `meocord.help.*` in its catalog with `@MeoCord({ i18n })`, in the server's language, and is English otherwise; see [MeoCord's own texts](https://meocord.dev/docs/4.1/localisation). A presenter's new optional `messageHelp(help, message)` method writes it instead, from `MessageHelp`, what the built-in found. `HandlerRegistry.messageHelp(message, query?)` gives the same model to a help command of the app's own, with help on or off, and `MessageHandlerEntry.hidden` says whether a handler asked to be left out. `hidden` also leaves a subcommand out of the usage listing a message naming only a parent gets.

- [#246](https://github.com/meocord/meocord/pull/246) [`6c46b07`](https://github.com/meocord/meocord/commit/6c46b07b19dff7fde4614e7d80e0ff3e4ddfe8d0) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A message that names only a command's leading words, such as `!config` when `config set …` and `config get …` exist, or an unknown subcommand, such as `!config reset`, gets the usage of each subcommand in reply, under a `Usage:` heading, one line per handler by its own pattern, where it got no reply. A handler whose pattern matches the message still runs, so a `config` or `config {key}` handler takes it as before. A subcommand with a guard, on its method or its controller, inherited ones included, is left out of the listing on purpose, since the listing runs no guards and must not name what a caller may be refused; it still answers its own usage when named, and a parent with nothing left to list gets no reply. App-wide guards do not filter the listing, as they do not filter a usage reply. The reply is a `MessageUsageError`, answered through the app's global filters and then the fallback, like any usage reply.

- [#231](https://github.com/meocord/meocord/pull/231) [`8395b05`](https://github.com/meocord/meocord/commit/8395b056427c22caaf65afc16522ffc0d2b336aa) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A button's, select menu's or modal's customId pattern can type a param, `{name:type}`, with `int`, `number`, `bool` or words to choose from such as `{order:asc|desc}`, read by the parsers message commands use. The handler receives the value, such as a number for `@Command('counter/{count:int}', CommandType.BUTTON)`, and its params are checked against the pattern when the code compiles; `route(pattern).build()` takes values of those types. A segment that is not a value of its type matches no route. Such a pattern used to be read as literal text, so it silently never matched; a type a customId cannot hold, such as `{target:member}`, now stops the bot where it is declared. Beside a text param in the same place, a typed one is tried first, and of two types the narrower (words to choose from, then `bool`, `int`, `number`), whatever order they are declared in; and patterns whose typed segments take no value in common are different routes. For a route with a typed param, `resolveRoute` adds `values`, the params as the handler receives them, beside `params`, which stays their text; every other result is as it was. From `meocord/common`, `RouteValues<Pattern>` now gives each typed param the value of its type, such as `number` for `{count:int}`, and an untyped param takes any `RouteValue`, a string, number or bigint, as before; `RouteParams<Pattern>` names each param without its type.

- [#239](https://github.com/meocord/meocord/pull/239) [`a5868f4`](https://github.com/meocord/meocord/commit/a5868f4feb33197c0d88a4254f8ab50c28b7f690) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A context menu handler can declare the kind of interaction its builder registers: `UserContextMenuCommandInteraction` for a builder that calls `setType(ApplicationCommandType.User)`, or `MessageContextMenuCommandInteraction` for `Message`. It had to take the union of both, since declaring one failed to compile with "Unable to resolve signature of method decorator". The union still works. A builder's kind is a value TypeScript cannot read, so the bot checks it as it starts: a handler that declares the other kind stops it, naming both.

  `meocord g co context-menu <name>` generates a user context menu command with its handler typed to match, and `--message` generates a message one. The context menu controller in a new project is typed the same way.

### Patch Changes

- [#229](https://github.com/meocord/meocord/pull/229) [`551c0eb`](https://github.com/meocord/meocord/commit/551c0ebc6c1f6a544702ade824c1410007449c5c) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A user context menu command and a message context menu command with the same name, which Discord allows, each reach their own `@Command` handler. The first handler declared under the name took both, so a message command could run the user command's handler. `TestingModule.invoke` refuses the other kind's interaction the same way, naming both kinds.

- [#243](https://github.com/meocord/meocord/pull/243) [`68638ab`](https://github.com/meocord/meocord/commit/68638abbe22544542808ae68332ce089a6c238bc) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `meocord start --dev` exits 1 when the bot cannot log in, as `meocord start --prod` does, instead of watching on with the bot offline: a missing or refused token, refused intents, or Discord being unreachable is not something a code change fixes. It says so in one line, after the reason the bot gave. After any other exit, such as an error at startup or a crash once online, it keeps watching and says `The application exited with code N; waiting for changes.`, then starts the bot again on the next rebuild. With `sharding`, the shard manager ends the session the same way.

- [#249](https://github.com/meocord/meocord/pull/249) [`4af6d70`](https://github.com/meocord/meocord/commit/4af6d70fb37bbc5fc2a8f28778156beeda3d00ee) Thanks [@l7aromeo](https://github.com/l7aromeo)! - The package's homepage is https://meocord.dev, the documentation site, where npm links it, and a new application's README links MeoCord there.

- [#240](https://github.com/meocord/meocord/pull/240) [`b462777`](https://github.com/meocord/meocord/commit/b462777be7fa16d17113d061f9e7e815725ca230) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `module.invoke()` checks an interaction's customId against every handler of the testing module, ranked as dispatch ranks them, as it already did for a message. A customId dispatch gives to another handler, such as `card/summary` beside `card/{id}`, rejects naming the handler that runs, where it ran the named handler anyway. A handler declared under two patterns gets the params of the one dispatch picks, typed values included. A testing module whose controllers would stop the bot, such as two whose patterns match the same customIds, now makes `invoke` throw the same startup error with a customId, as `dispatch` already did; give each such controller its own module.

- [#244](https://github.com/meocord/meocord/pull/244) [`eef71c7`](https://github.com/meocord/meocord/commit/eef71c79adebc5ee37a9637cc52a8fde38d9111d) Thanks [@l7aromeo](https://github.com/l7aromeo)! - The editor documentation of the application, the config file and the remaining public helpers says what each is for, with examples that compile, and links the guide: `MeoCordFactory`, `MeoCordApplication`, `@MeoCord`, `HandlerRegistry` and its entry types, `ShardContext`, `MeoCordConfig`, `ShardingConfig`, `CommandRegistrationConfig`, `RsbuildConfig`, the providers and `createToken`/`factoryProvider`, `Logger`, `OnReady`/`OnShutdown`, `CommandType`, `DeepPartial`/`DeepReadonly` and the `meocord/eslint` config. `MetadataKey` is marked internal: it holds MeoCord's own reflect keys and is not part of the documented API.

- [#226](https://github.com/meocord/meocord/pull/226) [`5c14933`](https://github.com/meocord/meocord/commit/5c1493377b616cfb474cb300144b922f99342f81) Thanks [@l7aromeo](https://github.com/l7aromeo)! - The JSDoc of every decorator in `meocord/decorator`, and of `CooldownOptions`, `DeferOptions` and `CommandBuilderOptions`, is rewritten for the hover in your editor: a one-line summary, when to use it and what to use instead, how it works, where it runs in a call, and an example that compiles against the published types. The options of `@Guard`, `@Interceptor`, `@Observer`, `@Validate`, `@Cooldown` and `@Defer` are documented on each option, with its default.

- [#236](https://github.com/meocord/meocord/pull/236) [`01d92f6`](https://github.com/meocord/meocord/commit/01d92f634ecbfe4925f8779ebc64f2363e642043) Thanks [@l7aromeo](https://github.com/l7aromeo)! - The guide links in the JSDoc of the decorators and the pipeline types point to the 4.1 documentation, the version you installed, and to its pages as they are named: slash commands, buttons, selects and modals, and how a call runs.

- [#241](https://github.com/meocord/meocord/pull/241) [`51282fe`](https://github.com/meocord/meocord/commit/51282fe4386c3e83013eff5be719cd001e8422b7) Thanks [@l7aromeo](https://github.com/l7aromeo)! - The editor documentation of `MessageCommandOptions`, `MessageHandlerOptions`, `route`, `Route`, `RouteParams`, `RouteValue` and `RouteValues` says what each is for, with an example that compiles, and links the guide.

- [#234](https://github.com/meocord/meocord/pull/234) [`4c9c1dc`](https://github.com/meocord/meocord/commit/4c9c1dc20180f8002cba7983b9c3dd47de59887e) Thanks [@l7aromeo](https://github.com/l7aromeo)! - The editor hover for `@MessageHandler`, `@ReactionHandler`, `ReactionHandlerAction`, `CommandNotFoundError`, `MessageUsageError` and the message param types (`ParamsOf`, `ParamRefsOf`, `EntityRef`, `MessageParamType`, `MessageParamTypes`, `CheckedParams`, `MessageScope`, `MessagePrefix`, `ReactionHandlerOptions`, `ReactionHandlerSettings`, `MessageUsageIssue`, `MessageParams`) now says in a sentence what each is, when to use it and what to use instead, with an example that compiles against the published types.

- [#230](https://github.com/meocord/meocord/pull/230) [`1004d7b`](https://github.com/meocord/meocord/commit/1004d7be4cc3782ebdd741e2b83d779731ff7785) Thanks [@l7aromeo](https://github.com/l7aromeo)! - The JSDoc of the types and helpers a guard, interceptor, filter, pipe or observer works with is rewritten for the hover in your editor: `ExecutionContext`, `GuardDeniedError`, `ValidationError`, `createMetadata`, `SetMetadata`, `applyDecorators`, `StageParams`, `Piped`, the stage interfaces, the observer types, the Standard Schema types and the command builder types. Each has a one-line summary and when to use it, and each example compiles against the published types.

- [#232](https://github.com/meocord/meocord/pull/232) [`fcd3457`](https://github.com/meocord/meocord/commit/fcd3457492b5915ec99b75748b7181a6135dc128) Thanks [@l7aromeo](https://github.com/l7aromeo)! - The JSDoc of `respond`, the theme API (`useTheme`, `bindTheme`, `UseTheme`, `ThemeCache`, `Theme` and the theme types), the errors a user is shown (`UserError`, `CooldownError`, `CooldownStoreError`), the presenter types, the translator and the cooldown stores now follows the JSDoc standard, for the hover in your editor and the API reference. Every example among them compiles against the published types: those that read an `interaction`, a database or an app they did not declare are now complete, and `MemoryCooldownStore`, `Theme`, `cooldownMessage` and `cooldownStoreMessage` gain one.

- [#235](https://github.com/meocord/meocord/pull/235) [`ee38bcb`](https://github.com/meocord/meocord/commit/ee38bcb6834033c77e11830fdded5480719b8b06) Thanks [@l7aromeo](https://github.com/l7aromeo)! - The JSDoc of `meocord/testing`'s mocks follows the standard in CONTRIBUTING.md: `createMockInteraction`, `createMock`, `createMockUser`, `createMockClient`, `createMockGuild`, `createMockChannel`, `createMockMessage`, `createChatInputOptions`, `createModalFields`, `createDiscordError`, `createMockTheme`, `withTheme`, `createMockFn`, `isMockFunction`, `clearAllMocks` and `resetAllMocks`, with the types they take and return. Each has a one-line summary, when to use it, and an example that compiles against the published package, and declares everything it uses. `MockInstance`'s methods describe themselves on hover.

- [#233](https://github.com/meocord/meocord/pull/233) [`5f42ad2`](https://github.com/meocord/meocord/commit/5f42ad2fa683d03531e93b79a5ee558d8e88f518) Thanks [@l7aromeo](https://github.com/l7aromeo)! - The JSDoc of `meocord/testing`'s module and inspection helpers follows the standard in CONTRIBUTING.md: `MeoCordTestingModule`, `TestingModuleBuilder`, `TestingModule` and their options and results, `getResponse`, `inspectHandler`, `createExecutionContext`, `resolveRoute`, `findRouteConflicts`, `expectCompleteCatalog` and `testCooldownStore`. Each has a one-line summary, when to use it, and an example that compiles against the published package, and every option documents itself, so the hover in your editor and the API reference say the same thing.

- [#247](https://github.com/meocord/meocord/pull/247) [`b31f281`](https://github.com/meocord/meocord/commit/b31f281fc85692414718dbddd12404034b5ed337) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `bun run lint` in an application prints nothing when the code is clean. `meocord/eslint` gives its import resolver the application's three tsconfigs, so each file resolves aliases through the tsconfig that includes it, and the resolver printed `Multiple projects found, consider using a single tsconfig with references…` on every run. It now sets the resolver's `noWarnOnMultipleProjects`, since several projects are the intended setup. Existing applications get it by updating meocord; nothing in them changes.

- [#238](https://github.com/meocord/meocord/pull/238) [`dba5def`](https://github.com/meocord/meocord/commit/dba5def4f87aeef879e7ca62050ac821b4d23480) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A message command's usage reply reads right for every param type: a word of the wrong type is now `"lots" is not a valid whole number`, so an app's own type labelled with a noun such as `emoji` reads `is not a valid emoji`, where it read `is not a emoji`. A `bool` param is named a `yes or no answer`. A role deleted while a command's guards ran is named `<@&id> is not a role in this server`, and a value of an app's own type whose `EntityRef` resolves to nothing `is not a valid <label>`, where both read `is not a value of its type`. A `MessageParamType`'s `label` is the bare noun, such as `hex colour`, as its example now shows. A test that matches the old wording, such as `is not a whole number`, needs the new one.

- [#250](https://github.com/meocord/meocord/pull/250) [`873aeab`](https://github.com/meocord/meocord/commit/873aeabaeb0d4ad11cfa4c7aaffcc0cc7e589d19) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `MessageParamType`'s documentation link in your editor opens the message params page, which covers typed params and your own param types, rather than the message commands page.

- [#225](https://github.com/meocord/meocord/pull/225) [`c862b1f`](https://github.com/meocord/meocord/commit/c862b1f637c50a53d8e1551a6ad1106cc08806ef) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Importing `meocord/common` no longer computes the Redis script hash until a `RedisCooldownStore` uses it. Each script's SHA1 is worked out the first time a store given `evalsha` runs it, then kept, so an app that never uses Redis hashes nothing, and one without `evalsha` never needs the hash.

- [#237](https://github.com/meocord/meocord/pull/237) [`69ec4e8`](https://github.com/meocord/meocord/commit/69ec4e808f3709bfa5dfcfd6dc3939c73cee86b2) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `getResponse(interaction).sent` counts only calls Discord accepted. A reply, update, edit or follow-up that Discord refused, such as a reply rejected with 10062 once the three seconds passed, used to count as sent, so a test of what the member sees after an expired interaction could pass while the member saw nothing. The refused call stays in `calls`, in the order it was made, and carries what it rejected with as `error`, the new optional field of `ResponseCall`: every call `respond()` makes, deferrals and modals included, is marked this way.

## 4.1.0-beta.5

### Minor Changes

- [#190](https://github.com/meocord/meocord/pull/190) [`6cc22f8`](https://github.com/meocord/meocord/commit/6cc22f8cff4ca768594cb89c18639426a663d741) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `CooldownStore.peekMany(entries)` checks a call against its cooldowns without recording it, returning the verdict `consumeMany` would. `MemoryCooldownStore`, `ShardedCooldownStore` (one message to the shard manager) and `RedisCooldownStore` (one read-only script; on Redis Cluster, one per slot unless `hashTag: 'handler'` keeps a handler's keys in one) answer it from their counts. A store of your own needs nothing: the default allows every call and leaves the refusal to `consumeMany`. Override it to let a cooldown refuse a call before the work ahead of its handler. `testCooldownStore` checks an override: a peek records nothing and refuses with the wait `consume` gives.

- [#157](https://github.com/meocord/meocord/pull/157) [`3ff8175`](https://github.com/meocord/meocord/commit/3ff81755eee48981c8e0e928ed026c5d88836ce7) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Cooldowns survive a failing store, and count a handler's stacked cooldowns in one step.

  - **When the store fails.** `@MeoCord({ cooldownStoreFailure, cooldownStoreTimeoutMs })` decides what a call gets when the cooldown store throws, rejects or does not answer within `cooldownStoreTimeoutMs` (1000 by default).
    - `'deny'`, the default, refuses it with the new `CooldownStoreError` from `meocord/common`, which the fallback answers privately: "Cooldowns can't be checked right now: try again shortly." A filter can catch it to answer otherwise, and observers see `outcome: 'error'`.
    - `'allow'` runs it uncounted.
    - Either way the failure is logged once per outage, with its cause, and again when the store answers. MeoCord never counts a call itself or asks twice, so an answer after the timeout records the call once, in the store.
  - **Stacked cooldowns, one step.** `CooldownStore` gains `consumeMany(entries)`, which `@Cooldown` calls once per call with every stacked cooldown. The default calls `consume` for each in order, so a store of your own keeps working; override it to check every entry and record the call against all of them only if all allow it. The built-in stores do:
    - `MemoryCooldownStore` checks them together.
    - `ShardedCooldownStore` sends one message to the manager.
    - `RedisCooldownStore` runs one script, so a call costs one round trip however many cooldowns it has: with 3 stacked and 5 ms to Redis, about 5 ms instead of 16. On Redis Cluster, where a handler's keys sit in different slots, it counts them a script each, in order, unless you pass `{ hashTag: 'handler' }` to keep each handler's keys in one slot.
    - With these stores, a call one cooldown refuses no longer spends the others, and waits the longest wait among those that refuse it.
  - **`ShardedCooldownStore`** treats a manager that does not answer as a store failure, handled by `cooldownStoreFailure`, rather than counting in the shard.
  - **`testCooldownStore`** checks the batch path too: a batch is counted at once and names the longest wait, and for a store that overrides `consumeMany`, a refused batch records nothing and concurrent batches at the limit let exactly one through.

  See [Smaller changes](https://github.com/meocord/meocord/blob/main/docs/MIGRATING.md#smaller-changes) in the upgrade guide.

- [#164](https://github.com/meocord/meocord/pull/164) [`8b524a0`](https://github.com/meocord/meocord/commit/8b524a0d8bbb8cad6f09ba2c64bd5f7cf5e5686c) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `route()` in `meocord/common` builds customIds from a component pattern: `const ticket = route('ticket/{id}')` goes to `@Command(ticket, CommandType.BUTTON)` in place of the string, and `ticket.build({ id })` gives `ticket/42`. A missing or unknown param fails to compile. So does a button's or select menu's handler whose params require a key its route does not capture, other than the menu's choices; a modal's fields, and a command's options, are not checked. A `/` or `%` in a value is encoded as `%2F` or `%25`, an empty value or an id over Discord's 100 characters throws, and routes are ranked and checked for duplicates as their pattern strings are. Handlers now receive `%2F` and `%25` in a captured param decoded, for string patterns too.

- [#154](https://github.com/meocord/meocord/pull/154) [`2ba4e96`](https://github.com/meocord/meocord/commit/2ba4e96a301a22ddcbcbd60263fa6f5ee4c65d1f) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Two component handlers of one type whose customId patterns match exactly the same ids, such as `profile/{uid}` and `profile/{id}`, stop the bot at startup with an error naming both, as two message handlers with the same pattern do. The bot used to start with a warning and send every click to one of them, chosen by the order the controllers were listed. One handler declared under both spellings is one route, the same pattern on different component types is still allowed, and patterns that only overlap, such as `a/{x}/c` and `a/b/{y}`, are still a warning. `findRouteConflicts` and `resolveRoute` throw the same error. Controllers generated by 4.0 share their default customIds, such as `button-click`; see [Two component handlers with the same customId pattern stop the bot](https://github.com/meocord/meocord/blob/main/docs/MIGRATING.md#two-component-handlers-with-the-same-customid-pattern-stop-the-bot).

- [#197](https://github.com/meocord/meocord/pull/197) [`9fd7ad3`](https://github.com/meocord/meocord/commit/9fd7ad380433dfe3d87d9c43eeca9743d4164f30) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A typed message param's member, user, role or channel is fetched from Discord only once the handler's guards let the call through, so a caller they refuse, or one still on a cooldown that has no `by`, costs no request, however many IDs the message names. The guards see each such param as an `EntityRef`: its `id`, the entity as `cached` when discord.js already has it, and `resolve()` to fetch it; `ParamRefsOf<'pattern'>`, from `meocord/interface`, types the params that way. The handler, `@Validate`, pipes and `@Cooldown({ by })` get the entities, as before. Each ID is fetched once however many messages and guards ask for it at the same time. An app's own param type can return an `EntityRef` from `parse` to fetch after the guards too.

- [#156](https://github.com/meocord/meocord/pull/156) [`64d9caa`](https://github.com/meocord/meocord/commit/64d9caa06270a6230ab06ace3b0279d80ecec7ed) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Class-level `@UseGuard`, `@UseInterceptor`, `@UseFilter` and `@Cooldown` on a controller also apply to the handlers a subclass declares itself, as they do in NestJS: a guard on an abstract `StaffController` now guards every command of a class that extends it, where the subclass's own handlers ran without it. Every handler gets the chain inherited handlers had: the subclass's class stages first, then each base's, then the method's, with filters tried and cooldowns counted from the base out. `@Controller({ inheritStages: false })` keeps a subclass's own handlers to its own class and method stages; the handlers it inherits keep their base's. `inspectHandler` lists the resolved chain, and a direct call to a guarded handler runs the same guards in the same order as dispatch.

  Each handler's stages are resolved once, not on every call, so dispatch pays nothing for the chain. See [A base controller's class stages cover its subclasses](https://github.com/meocord/meocord/blob/main/docs/MIGRATING.md#a-base-controllers-class-stages-cover-its-subclasses) in the upgrade guide.

- [#175](https://github.com/meocord/meocord/pull/175) [`e22c401`](https://github.com/meocord/meocord/commit/e22c401e637e1f99edf117ad26049ea9b2722f90) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `Logger` prints from a level up, set by `logLevel` in `meocord.config.ts` (`'debug'`, `'log'`, `'warn'`, `'error'` or `'silent'`) or, for one run, by the `MEOCORD_LOG_LEVEL` environment variable, which wins. By default `[DEBUG]` lines show in development, where `NODE_ENV` is `development` as under `meocord start --dev`, and are hidden elsewhere, so a production log no longer carries the raw error and stack behind an explained startup failure such as a refused token. To see debug lines in production again, start with `MEOCORD_LOG_LEVEL=debug` or set `logLevel: 'debug'`. An unknown `MEOCORD_LOG_LEVEL` is reported once and ignored. The level is resolved once, on the first line logged, and a suppressed line costs no formatting.

- [#166](https://github.com/meocord/meocord/pull/166) [`0d9b466`](https://github.com/meocord/meocord/commit/0d9b466bc8d2dc1a2084b36b15ee2df200b95779) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `@MessageHandler` takes `aliases`, `description` and `scope`. `aliases: ['m']` lets `!m @ana` run `mute {target:member}`, each alias standing in place of the words the pattern begins with. `scope: 'guild'` or `'dm'` answers a message sent elsewhere that the command works in a server only, or in direct messages only, and the handler does not run; `MessageUsageError` gains `dmOnly` for the second. `HandlerRegistry`'s message entries list each command once, with its `command` words, `aliases`, `description`, `scope`, `usage(prefix)`, the text a usage error shows, and `matches(words)`, for a help command of the app's own; the README has one to start from.

- [#173](https://github.com/meocord/meocord/pull/173) [`6af9e7a`](https://github.com/meocord/meocord/commit/6af9e7adcddd05e7f5f4839414f6c712c0b3f05e) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Message patterns take flags and typed lists. `{--bots}` is `true` when a message gives `--bots` anywhere after the command word, and `false` when it does not; `{--from:user?}` takes `--from=@ana`, resolved as a typed param is, and is required without the `?`. `{options:string...}` gives the rest of the message as a list, one item per word or "quoted words", and `{targets:member...}` a list of members, fetched with the message's other members in one request. A flag the command does not have, a typed flag missing or given no value, and a list item of the wrong type each get the usage reply. `ParamsOf` types flags as `boolean` or their value, and typed lists as arrays. Only a message naming a command with flags is read for them, so a pattern without flags reads `--bots` as an ordinary word, as before, and `{name...}` without a type stays the rest of the message as text.

- [#159](https://github.com/meocord/meocord/pull/159) [`4b7ef50`](https://github.com/meocord/meocord/commit/4b7ef505bda48125701f5aae056800ef10489394) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A `@MessageHandler` pattern's params can name a type, `{name:type}`: `int`, `number`, `bool`, `duration` (`10m`, `2h30m`, in milliseconds), `member`, `user`, `role`, `channel` (by mention, ID or, for a role, its name), words to choose from such as `{mode:on|off}`, or a type the app adds in `@MeoCord({ messages: { types } })` and declares in `MessageParamTypes`. Several optional params may end a pattern, as in `ban {target:member} {duration:duration?} {reason...?}`: each one that another follows takes a word only if it fits its type, so `!ban @ana spamming` gives a reason and no duration. Each word becomes its value before the guards run, so guards, `@Validate`, pipes, `@Cooldown({ by })` and the handler receive members and numbers. A mentioned member, a cached member, user, role or channel costs no request, and the members a message names that are not cached are fetched in one request. The params a handler declares are checked against its pattern at compile time, and `ParamsOf<'pattern'>` gives their type.

  A message that names a command after a prefix or mention but does not fit its pattern, with a word of the wrong type, a param missing, or a `member`, `role` or `channel` param sent in a DM, gets the command's usage in a reply, deleted after `@MeoCord({ messages: { deleteUsageRepliesAfter } })` seconds (10, or 0 to keep it). It is a `MessageUsageError` from `meocord/common`, which the handler's exception filters see first. A message with no prefix or mention gets no reply. In `meocord/testing`, `createMockGuild({ members, roles, channels })` fills the guild's caches, `createMockMessage({ guild })` sends a message in that guild or, with `null`, in a DM, and `invoke` resolves typed params as dispatch does, and answers a prefixed message that names the command but leaves out a param with the same `MessageUsageError`, through the handler's filters.

- [#162](https://github.com/meocord/meocord/pull/162) [`d0e6bf7`](https://github.com/meocord/meocord/commit/d0e6bf732fb7c39c289abb8e12d07de794a87301) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `@ReactionHandler` matches a custom emoji by its id, as well as by name. Pass the id, `@ReactionHandler('1234567890123456789')`, or the `<:party:1234567890123456789>` Discord shows when you send `\:party:` in a message. The handler then runs for that one emoji, rather than for every custom emoji called `party` across the bot's servers. A name, and a standard emoji's character, match as before.

- [#161](https://github.com/meocord/meocord/pull/161) [`05bcea6`](https://github.com/meocord/meocord/commit/05bcea6e43f1909b47a651e6170f6e841bcc8f67) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A select menu's choices arrive in its handler's params, as a modal's fields do. `values` holds the chosen options' values or ids, beside the customId params. discord.js's resolved objects come too: `users` and `members` from a user select, `roles` from a role select, `channels` from a channel select, and `users`, `members` and `roles` from a mentionable one.

  `@Validate`, pipes, `@Cooldown({ by })` and `getHandlerParams()` see them, so a poll can limit each option on its own with `by: (_context, { values }: { values: string[] }) => values[0]`. A customId param of the same name keeps winning, and development warns about the clash. `invoke` builds them from a mock's `values`, `users`, `members`, `roles` and `channels`. Handlers that read `interaction.values` keep working.

- [#183](https://github.com/meocord/meocord/pull/183) [`3af939e`](https://github.com/meocord/meocord/commit/3af939ee3ef4be7e85b9df5c3ff38cacb2535083) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `module.dispatch(input)` in `meocord/testing` sends an interaction, a message or a reaction through the bot's own dispatch: routed over the module's controllers and its `app`'s message options exactly as the bot routes it, then run through the full pipeline of each handler it reaches. It resolves to `{ ran, handlers, error? }`, where `handlers` lists each handler reached, in the order it ran, with its own `ran` and `error`. What the user is sent reaches the mocks as the bot sends it, including a usage reply and the built-in fallback's answer to an error no filter handles. An error the fallback answers as the user's own outcome resolves in `error`: a usage reply, an unknown command, or a guard's, a cooldown's, a validation's or a `UserError`'s refusal. Any other error no filter handles rejects the call once the fallback has answered. A reaction is dispatched with the user who reacted, `module.dispatch(reaction, { user, action })`, added unless an action is given, so `@ReactionHandler` can be tested through routing, which `emit` never reaches. `invoke` still tests one handler you name.

- [#172](https://github.com/meocord/meocord/pull/172) [`c1fd9e5`](https://github.com/meocord/meocord/commit/c1fd9e5966757caf5d43bf2621afde715660b3dc) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A testing module runs the lifecycle hooks. `await module.init({ ready: true })` runs every `onReady` once, in the order the bot runs them: each class after the classes and providers it injects, the observers last. `await module.close()` runs, in reverse, the `onShutdown` hooks of everything the module has constructed, whether or not it was readied, so a test can close a provider it opened, such as a connection pool a factory made in `init()`, instead of leaking it; nothing is constructed just to be shut down. `onReady` receives a client from `createMockClient` and `{ primary: true }`, or those passed as `init({ ready: { client, primary } })`. Every hook runs even when one throws; `init` or `close` then rejects with that error, or an `AggregateError` naming each hook that threw. `init()` without `ready` runs no hook, as before.

- [#200](https://github.com/meocord/meocord/pull/200) [`c6b4af0`](https://github.com/meocord/meocord/commit/c6b4af0203d3066ee5a84f832fadcfe9937bbb40) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Add themes: design tokens by role, which `respond()` and MeoCord's own views take their colours, emojis and button styles from, set once for the app and changed per controller, handler, server or user. See [Theming](https://github.com/meocord/meocord/blob/main/README.md#theming).

  **What an existing bot sees without changing anything**

  - Answers sent through `respond()` with no colour, an embed without `color` or a Components V2 container without `accent_color`, now show the theme's `primary`, `#7680F4` unless the app sets another. A colour that is set is kept, `0` and a `null` accent included, and nothing sent around `respond()` is touched. To send one message as written, pass `{ fill: false }` (`ResponseSendOptions`) as the second argument to `send()`, `edit()` or `followUp()`.
  - MeoCord's error view is coloured by the error's tone: `warning` when it is the user's own outcome, such as a denied guard, a cooldown, invalid input or a `UserError`, and `danger` for a fault in the bot. Its loading view uses the theme's loading emoji.
  - `Theme` from `meocord/common` is deprecated, and goes in MeoCord 5. Its colours still work: each reads the matching role of the call's theme, so code written against `Theme.primaryColor` follows `@MeoCord({ theme })` and `@UseTheme` with no change, and `errorColor` is the `danger` role. Their values are now the new defaults, tuned for at least 3:1 contrast against every Discord surface: 4.0's were `primaryColor` `#5865F2`, `successColor` `#28A745`, `infoColor` `#17A2B8`, `errorColor` `#DC3545` and `warningColor` `#FFC107`, which `@MeoCord({ theme })` sets again if you want them. Assigning one still recolours MeoCord's views, beneath every theme the app sets, and logs a warning once per colour. See [`Theme` is deprecated, and its colours changed](https://github.com/meocord/meocord/blob/main/docs/MIGRATING.md#theme-is-deprecated-and-its-colours-changed).
  - A presenter from an earlier 4.1 beta gets `context.theme` and the error's `tone`. A spec that builds a `ResponseContext` or a `PresentedError` by hand adds `theme: createMockTheme()` and `tone`.

  **What's new**

  - **Tokens:** `ThemeColors`, `ThemeEmojis` and `ThemeButtons` in `meocord/interface`, grouped in `MeoCordTheme`, each role with a default. An app adds [tokens of its own](https://github.com/meocord/meocord/blob/main/README.md#adding-tokens-of-your-own) by augmenting them; a bad token stops the bot before it logs in, naming where it was set.
  - **Setting and reading:** `@MeoCord({ theme })` for the app, `@UseTheme` for a controller or handler, and `useTheme()` from `meocord/common` to read the call's theme anywhere the call runs, `context.getTheme()` in a stage. `@MeoCord({ themeFor: { guild, user } })` looks a theme up per server and per user, cached, with `ThemeCache` to clear a result when it changes; see [Themes per server and per user](https://github.com/meocord/meocord/blob/main/README.md#themes-per-server-and-per-user).
  - **Presenters:** `ResponseContext.theme` and `PresentedError.tone`, so `context.theme.colors[tone]` styles an error by kind.
  - **Replies to messages:** `@MeoCord({ messages: { replyEmoji: true } })` starts MeoCord's text replies to message commands with the theme's emoji. It is off by default.
  - **Testing:** calls in a testing module run in its theme as in the bot; `overrideTheme`, `overrideThemeFor`, `createMockTheme` and `withTheme` from `meocord/testing` set or check one.
  - **New apps:** `meocord create` writes a presenter styled from `context.theme` and `tone`, `src/types/theme.d.ts` for the app's own tokens beside `src/types/assets.d.ts`, and an `eslint.config.ts` that warns on deprecated APIs in app code.

- [#167](https://github.com/meocord/meocord/pull/167) [`0edd2cf`](https://github.com/meocord/meocord/commit/0edd2cf90bb341b139f437b6cde577fb7a8e5450) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A guard, interceptor, filter or pipe can declare the params it takes, `declare readonly params?: { channelIds: string[] }`, and every `{ provide, params }` for it is checked against that type: in `@UseGuard`, `@UseInterceptor`, `@UseFilter`, `@UsePipe` and `@MeoCord({ guards, interceptors, filters })`. A misspelt param, such as `channelId`, or one of the wrong type, fails to compile, where it failed at the first call. A class that declares none takes any params, as before.

  A guard also has its params whole as `this.params`, besides each as a property of its own. An interceptor, filter or pipe, shared across calls, reads them typed with `context.getParams<StageParams<typeof X>>()`; `StageParams` is exported from `meocord/interface`.

- [#169](https://github.com/meocord/meocord/pull/169) [`433a449`](https://github.com/meocord/meocord/commit/433a4496fa10ead93e39d209d6bb778bbe366adb) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `factoryProvider` in `meocord/common` types a factory provider: each `useFactory` parameter is what the token in the same place of `inject` provides (a class's instance, a `createToken` token's type, or `unknown` for a string or plain symbol), and the factory must return what `provide` stands for. A parameter `inject` does not supply, one of the wrong type, or a wrong return fails to compile. It returns the provider unchanged, for `@MeoCord({ providers })` and the testing module.

  ```typescript
  factoryProvider({
    provide: DATABASE,
    inject: [Config, PORT],
    useFactory: (config, port) => new Pool(config.url, port),
  })
  ```

  A plain `{ provide, useFactory, inject }` object works as before. TypeScript cannot type its factory from `inject` inside a list, which is why this is a function.

- [#168](https://github.com/meocord/meocord/pull/168) [`645e951`](https://github.com/meocord/meocord/commit/645e9511f6729264200d36004f44e510c7b62e81) Thanks [@l7aromeo](https://github.com/l7aromeo)! - In development, MeoCord warns once per handler that finishes without answering its interaction, which leaves the user with "The application did not respond", or that defers it and never follows up, which leaves them watching it think until Discord gives up. The warning names the handler and what to call. A call a guard denied, or one that failed, is answered by the fallback and never warned about. It is on while `NODE_ENV` is `development`, as under `meocord start --dev`, and off in production; `@MeoCord({ warnUnanswered })` turns it on or off regardless.

- [#165](https://github.com/meocord/meocord/pull/165) [`ab924dc`](https://github.com/meocord/meocord/commit/ab924dc79baa671cfc9ee94e82d98ae3db5582cf) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `UserError` in `meocord/common` is for a mistake the user can fix, such as too few coins or an account that does not exist, rather than a fault in the bot. Throw it from a handler, a pipe, a service or a guard: the built-in fallback shows its message privately for an interaction, even after `@Defer`, and as a reply to a message, without pinging its author, and logs it only at debug level.

  ```typescript
  throw new UserError(`You need ${missing} more coins.`, { code: 'shop.poor', context: { missing } })
  ```

  - `code` and `context` let an exception filter or a presenter phrase it otherwise, such as in the user's language; a presenter's `error()` receives the error with the interaction.
  - `respond(interaction).error(userError)` shows its message privately by default.
  - Observers see the new outcome `'refused'`, with `handled` set, apart from `'error'`, so metrics tell the user's mistakes from the bot's faults. An observer that switches over every `DispatchOutcome` gains a case to handle.

### Patch Changes

- [#215](https://github.com/meocord/meocord/pull/215) [`f7f64a4`](https://github.com/meocord/meocord/commit/f7f64a471c5fd19c88ff2bd40688da26a3554291) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `@Defer({ mode: 'auto' })` acknowledges an interaction without a creation time after its delay, 1.5 s unless `after` says otherwise, instead of at once. The 2.5 s cap counts from `createdTimestamp`, and without one the deadline was not a number, so the timer fired immediately. A real interaction always has one, but a test's mock did not, so a test of an auto-deferred handler saw an acknowledgement the bot would not send.

  `createMockInteraction` and `createMockMessage` now give `createdTimestamp` and `createdAt`: the time an `id` the test gives encodes, as discord.js reads it, or, with the generated `id`, the time the mock was made. A `createdTimestamp` the test sets wins. Generated ids are unchanged.

- [#176](https://github.com/meocord/meocord/pull/176) [`e1810cc`](https://github.com/meocord/meocord/commit/e1810cc3edb347ed251f69d032c6e820f14ee22e) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A `@MessageHandler` whose own `prefix` is `''`, no prefix, no longer stops every message command in the bot: each message threw `Cannot read properties of undefined (reading 'toLowerCase')` before any handler ran. The handler now matches messages without a prefix, as its JSDoc says, beside the handlers that use the app's prefix or their own.

- [#195](https://github.com/meocord/meocord/pull/195) [`3cd75b7`](https://github.com/meocord/meocord/commit/3cd75b76f7d1325d9bafa22d678a135ca0daa38c) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A `UserError` thrown from an `@On` handler of an event that carries a message, such as `messageCreate`, now answers that message as a message handler's does: a reply with its message, without pinging, the edited message for `messageUpdate`. It was logged as an error and answered nothing. From any other event it is logged at debug level, not as an error, since it is the user's outcome rather than a fault.

- [#170](https://github.com/meocord/meocord/pull/170) [`e8fffd2`](https://github.com/meocord/meocord/commit/e8fffd252df65d045c4b779db9062872edf4e2bc) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `CooldownStoreFailure`, the type of `@MeoCord({ cooldownStoreFailure })`, is exported from `meocord/interface`. `@MeoCord`'s declarations referred to it without any entry exporting it, so a consumer declaring a value of that type, or emitting declarations for an app that wraps `@MeoCord`'s options, had no name to import and could hit TS2742.

- [#199](https://github.com/meocord/meocord/pull/199) [`f91aee5`](https://github.com/meocord/meocord/commit/f91aee5f653e3ba0a9da3fcced751dfe815db6de) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A flag before a command's first word, as in `!--bots purge 5`, is never read, and the message names no command. Before, such a message ran `purge` whenever some other handler's pattern with flags began with a param, such as `{target} {--ping}`, so whether it matched depended on unrelated handlers. A pattern that begins with a param still takes its flags anywhere.

- [#152](https://github.com/meocord/meocord/pull/152) [`e03539d`](https://github.com/meocord/meocord/commit/e03539d5b9e289ceaa706e7773afe90574e6c363) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `meocord generate` writes components that fit a 4.1 app as they are.

  - A button, modal or select menu takes its customId from its name, and a message handler its pattern: `meocord g co button ticket` routes `ticket` and `ticket/{id}`, and `meocord g co message ping` matches `ping`. Generated components no longer share the fixed ids `button-click` or `select-menu`, or the `baka` pattern of the sample message controller. With that one listed, the bot stopped at startup: "match the same messages, so only one of them could ever run".
  - A nested name gives its whole path to the class, as it already did to the command: `admin/ban` makes `AdminBanButtonController`, so it never shares a class name with `ban`'s `BanButtonController`. Two classes of one name are refused under process sharding and share cooldown keys.
  - Controllers answer with `respond()`, and their methods are named after the class: `handleTicket`. The filter template answers with `context.response?.error()`.
  - After writing, `generate` names the next step, such as `Next: add TicketButtonController to @MeoCord({ controllers }) in src/app.ts.` It still never edits `src/app.ts`.

  New apps from `meocord create` get `src/types/assets.d.ts`, so `import logo from './logo.png'` and the template's Markdown imports pass the app's own `tsc`. Its coverage settings leave declaration files out. The sample `app.ts` no longer sets an empty custom activity. To add the declarations to an existing app, see [Smaller changes](https://github.com/meocord/meocord/blob/main/docs/MIGRATING.md#smaller-changes).

- [#184](https://github.com/meocord/meocord/pull/184) [`29fdbcb`](https://github.com/meocord/meocord/commit/29fdbcbb3fbace5fe153b635d60751e89f157fd3) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `invoke` in `meocord/testing` runs a message handler only for a message dispatch would give it. With `roll {sides}` in one controller and `roll 20` in another, invoking the first with `!roll 20` rejects saying dispatch runs the second, rather than running a handler the bot never would.

- [#179](https://github.com/meocord/meocord/pull/179) [`3ec6c2d`](https://github.com/meocord/meocord/commit/3ec6c2d2248a8c8a1bb40ed64b5e8dc10f52ec51) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `invoke` in `meocord/testing` answers a message that names a command without fitting its pattern with that command's usage only where dispatch would. With `config {key}` beside `config set {key} {value...}`, invoking the first with `!config set prefix ?` rejects saying dispatch runs the second, rather than with a usage error the user would never see.

- [#182](https://github.com/meocord/meocord/pull/182) [`920da89`](https://github.com/meocord/meocord/commit/920da896bdcf37c5835eec1d67f9f0ce9a13aeef) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `logLevel` in `meocord.config.ts` applies to the built bot only. The CLI and tests read it from whatever `dist/meocord.config.mjs` a previous build left, so `meocord build` printed its progress on the first build and nothing on the next, and a test's log lines depended on whether the app had been built. Both now print by `MEOCORD_LOG_LEVEL` and the default; set `MEOCORD_LOG_LEVEL` to quiet them.

- [#182](https://github.com/meocord/meocord/pull/182) [`aaaf328`](https://github.com/meocord/meocord/commit/aaaf32830c9d3b78a535075dd2806d4e33d67836) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `MEOCORD_LOG_LEVEL` is read in any case, so `MEOCORD_LOG_LEVEL=DEBUG` shows debug lines rather than being rejected. A value that names no level is reported even when the configured `logLevel` is `error` or `silent`, which hid the warning, so a bot that prints nothing tells you why your override did not apply.

- [#185](https://github.com/meocord/meocord/pull/185) [`ba57fcc`](https://github.com/meocord/meocord/commit/ba57fcca8aeb733ed92540fcc19bbc121c9a9dde) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `Logger` reads `appName` from the config only in the built bot. Elsewhere it read `dist/meocord.config.mjs` left by the last build, so the CLI prefixed its lines with a previous build's name, and a test that logged loaded `.env` through that file's `import 'dotenv/config'`, but only once the app had been built. Tests now never load `.env` on their own; see [Running tests](https://github.com/meocord/meocord/blob/main/README.md#running-tests) to load it in `vitest.setup.ts`.

- [#157](https://github.com/meocord/meocord/pull/157) [`6827411`](https://github.com/meocord/meocord/commit/682741110a788e2f8cee15047d7894afc01a7963) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `MemoryCooldownStore`, the default, spends the same time on a call however many calls its key holds. It filtered every call time of a key on each call, so a busy cooldown with a large `uses`, such as a `'global'` one, slowed dispatch as calls built up: at 20,000 calls a second with `uses: 1_000_000`, about 45 µs a call. Each key's times are now trimmed from the front as they leave the window, which costs about 0.12 µs a call there, and decisions are unchanged.

- [#191](https://github.com/meocord/meocord/pull/191) [`399e4e4`](https://github.com/meocord/meocord/commit/399e4e4e37e4ae6721f8c59eb70a78800edfb0c4) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A message command that a guard denies with a `GuardDeniedError`, or that `@Validate` refuses, now gets a reply with the reason, without pinging, deleted after `@MeoCord({ messages: { deleteUsageRepliesAfter } })` seconds as a usage reply is, and is logged at debug level. It was answered with nothing and logged as an error, though an interaction gets the same reason and neither is a fault. A guard denying a listener, an unpatterned `@MessageHandler()` or an `@On` handler, still gets no reply, since it only filters what the listener takes, and is now logged at debug level rather than as an error.

- [#198](https://github.com/meocord/meocord/pull/198) [`a9ae5e4`](https://github.com/meocord/meocord/commit/a9ae5e439c3888d9ce73a646ae44f17d1cefd4e5) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A message after a prefix whose first word names no command is no longer split into words, so an unknown command costs dispatch about 40% less. A message naming a command with flags is split once instead of twice.

- [#184](https://github.com/meocord/meocord/pull/184) [`8e5f76a`](https://github.com/meocord/meocord/commit/8e5f76aac6c099de22ac426a2745dfe8503b529e) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A message pattern's flag must start with a letter: `{--2fa}` or `{--_x}` stops the bot at startup with a message saying so, since a message's `--2fa` is read as a word and the flag could never be given. A rest param with flags taken out keeps its own spacing and line breaks: `say {text...} {--loud}` with "one\n--loud\ntwo" gives "one\ntwo", where the flag's surroundings were joined by a single space.

- [#158](https://github.com/meocord/meocord/pull/158) [`d724f12`](https://github.com/meocord/meocord/commit/d724f121a9ba454e58e893948247ccca331b9e78) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Matching a message against `@MessageHandler` patterns costs the same however many patterns an app has. The patterns are compiled once into an index of their words, a message's words are read once rather than once per pattern, and a message whose first character no prefix or mention begins with is turned away before it is read at all. At 1000 patterns a matching message costs about 0.4 µs where it cost about 0.4 ms, and ordinary chat about 20 ns where it cost 25–50 µs. Which handler a message reaches, and the params it receives, are unchanged.

- [#184](https://github.com/meocord/meocord/pull/184) [`e728d8c`](https://github.com/meocord/meocord/commit/e728d8cc58bd60e3bd460218ef7c448fc23b7251) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A message naming more than 100 uncached members, as a `member` list can, has them fetched 100 at a time. Discord's gateway request for members takes at most 100 IDs, and a larger one was sent whole.

- [#194](https://github.com/meocord/meocord/pull/194) [`7508511`](https://github.com/meocord/meocord/commit/75085111eb7736417d61608559a243dbf7c3e22c) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A mention of the bot starts a message command in an app whose handlers all have their own prefixes, when `mention` is on. Such an app took no mention, since it read no starts at all, and did not prefer a handler whose `scope` fits where the message was sent. Its prefix function is still never called, since no handler uses the app's prefixes.

- [#184](https://github.com/meocord/meocord/pull/184) [`770ca8f`](https://github.com/meocord/meocord/commit/770ca8f4cecffe0f19e248ea27f386e8089dbde8) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A message command's `scope` now decides which handler runs, not only whether it may. A handler whose scope fits where the message was sent runs before one of another scope, so a DM-only `config {key}` no longer answers "direct messages only" in a server where an unscoped `config {words...}` fits, and one command may have a server handler and a DM handler with the same pattern, which startup refused. A message that only an out-of-scope handler matches still gets the reply saying where the command works.

- [#184](https://github.com/meocord/meocord/pull/184) [`6664a27`](https://github.com/meocord/meocord/commit/6664a2771233b4de22be24f9f51df8a66d85775c) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A message full of unclosed quotes no longer costs time growing with the square of its length. Each unclosed quote searched to the end of the message for its close, about 14 ms for a 4000-character message of them, work any user could make the bot do; reading a message is now one pass whatever its quotes.

- [#177](https://github.com/meocord/meocord/pull/177) [`d43f382`](https://github.com/meocord/meocord/commit/d43f382cf28d159c235e977c260c42531b06d08b) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `createMockMessage` caches what its content mentions, as the gateway delivers a message's mentions with it: `<@id>` a user in `message.client.users.cache` and, in a guild, a member in `guild.members.cache`; `<@&id>` a role; `<#id>` a channel; each also in `message.mentions`. A typed `user` param in a test, through `invoke` or dispatch, no longer throws `message.client.users.cache.get is not a function`. `createMockClient` has real `users` and `channels` caches, and every mock client is the same bot, `createMockClient().user.id`, so a message starting with a mention of the bot reaches its handler through `invoke`. `createMockMessage` takes `client` and `users` to set the client it arrived on and more cached users.

- [#163](https://github.com/meocord/meocord/pull/163) [`c1c9ff0`](https://github.com/meocord/meocord/commit/c1c9ff0ab7c243e9c75ca4c92405a613e8aa0f3f) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A bot token Discord refuses, or an empty one, is now explained in one line: what is wrong, and where to get a token (Developer Portal → your application → Bot → Reset Token, into `DISCORD_TOKEN` in `.env` for a generated app). `app.start()` still rejects and sets the exit code, and the error is recognised by `isExplainedError`, so the generated `main.ts` no longer logs discord.js's error and stack a second time. `meocord register` explains a refused token the same way instead of printing the raw `DiscordAPIError` 401. With process sharding, the manager explains it and exits before spawning any shard.

  `commands.guilds` whose ids are all blank, as `[process.env.GUILD_ID]` leaves it with the variable empty or unset, no longer registers globally. The commands without guilds of their own are registered nowhere, with a warning that names them, leftovers are not cleared even with `clearOther`, and `meocord register` exits 1. `guilds` accepts undefined ids, so `[process.env.GUILD_ID]` needs no `!`.

  With `bundleDependencies`, a build that finds `supports-color` missing, which `debug` probes for, prints one line naming the dependency and the `optionalExternals` entry that silences it, instead of the bundler's "Module not found" warning with a code frame.

  `meocord show` without a flag says to run `meocord show --license` or `meocord show --warranty` instead of reprinting its options. A config number out of range shows the value and the range, as in `sharding.shards must be 'auto' or a whole number of shards, 1 or more (got 0)`. A new application's README lists the observer generator.

- [#153](https://github.com/meocord/meocord/pull/153) [`0b3f3b4`](https://github.com/meocord/meocord/commit/0b3f3b4c0697c0467c0e854cb4cf5de4e0474304) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `@ReactionHandler` skips reactions from bots, the bot's own included, as `@MessageHandler` skips messages from bots. Every handler ran for them: a bot's reaction handlers ran for the reactions it added itself, a poll counted the reactions the bot seeded, and the generated sample answered its own reaction twice. A handler that should still run for bot reactions sets `bots: true`: `@ReactionHandler('📌', { bots: true })`, or `@ReactionHandler({ bots: true })` for every emoji. A partial user is fetched to tell whether it is a bot. See [Reactions from bots reach no handler](https://github.com/meocord/meocord/blob/main/docs/MIGRATING.md#reactions-from-bots-reach-no-handler) in the upgrade guide.

  New applications' sample reaction controller answers 😋 once, and its handler for every emoji only logs.

- [#160](https://github.com/meocord/meocord/pull/160) [`b452256`](https://github.com/meocord/meocord/commit/b452256bed5e443a6aa7f999d2389f03b467ce74) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Testing mocks behave more like discord.js, and a few messages and types say more:

  - An interaction mock has an `id`, a `channelId` and a `user` with an `id`, and a message mock an `id`, `author.id`, `channelId` and `guildId`, each a snowflake string no other mock in the test run has; `createMockUser`, `createMockGuild` and `createMockChannel` get ids too. They were mock objects that all read as `[object Object]`, so two default users were one user, and shared a per-user cooldown.
  - An interaction mock made without a `guildId` has `guildId`, `guild` and `member` `null`, as a direct message does, where they were truthy while `inGuild()` said otherwise. Giving it a `guildId` gives it a member.
  - The autocomplete mock's `respond()` rejects more than 25 choices, as Discord does.
  - `invoke` takes the interaction for a handler declared with no parameters, which failed to compile.
  - `respond().modal()` after `@Defer` acknowledged the interaction says so, and how to fix it.
  - A class listed alone in `providers` is refused with what to write instead: in the testing module it needs no listing, and in `@MeoCord` it goes in `services`.
  - The `ExceptionFilter` and `@Catch` examples answer through `context.response?.error()`, which suits a deferred interaction too.
  - The README gives the key a cooldown is counted under, with an example.

  Tests that relied on the old mock defaults may need a change; see [Smaller changes](https://github.com/meocord/meocord/blob/main/docs/MIGRATING.md#smaller-changes).

- [#193](https://github.com/meocord/meocord/pull/193) [`3cc9898`](https://github.com/meocord/meocord/commit/3cc989825a47b3a1848b5f60940e44ef19b6fcae) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A shared guard that calls another shared guard, such as one injected into it, no longer makes the inner guard read the outer guard's `params`. Each guard reads only the params its own `{ provide, params }` entry gives; called directly by another guard, it reads its own values.

  A shared guard whose class takes a param through a setter, such as `set limit(value)`, gets it again: the value was dropped, and the guard read its own. Such a param has nowhere to be kept per call, so it is set on the shared instance, as it was before shared guards read each call's own params, and the bot warns once that overlapping calls can read each other's. Reading the param as a plain property, or not binding the guard, avoids that.

  A shared guard whose instance is sealed (`Object.seal(this)`) cannot read each call's own params: its properties cannot be changed to do so. It takes them on the one instance, as before, so overlapping calls can read each other's params and a call without params reads the last ones given; the bot now warns about such a guard once. Leave the instance unsealed, or stop binding the guard, to keep calls apart.

- [#187](https://github.com/meocord/meocord/pull/187) [`721ec61`](https://github.com/meocord/meocord/commit/721ec6142e9d978becf836879fad4017c9e11211) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A guard shared as one instance now reads each call's own `params`. A guard bound once, by listing it in `@MeoCord({ services })` or `providers` or by injecting it into a service, is a single instance for every call. When two handlers gave it different params, such as `{ role: 'admin' }` and `{ role: 'mod' }`, and their calls overlapped, one call's guard could read the other's params and allow or deny the wrong call. Each call now sees its own, while the instance, its state and its private fields stay shared. Guards made for each call, the default, are unchanged.

  No action is needed. The startup warning about a guard listed in `services` is gone, since such a guard is now safe.

  A sealed guard that declares the properties its params set, and no `params` property, takes its params again instead of failing the call. A frozen guard given params fails the call with an error that names the guard and says why.

- [#149](https://github.com/meocord/meocord/pull/149) [`b9be088`](https://github.com/meocord/meocord/commit/b9be08873b1949cfb2195936df409aa9aa339ac7) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Stack traces name your source files, lines and columns on Node and Bun, in development and production. `meocord start` runs node with `--enable-source-maps`, and its shard processes inherit it. A bundle started any other way, such as `node dist/main.js` in a Docker `CMD` or under Bun, which applies no source map to a bundle, maps its stacks from `dist/main.js.map` through `Error.prepareStackTrace`.

  - The map is read the first time a stack needs it. Each frame keeps the runtime's format, `at fn (/abs/path/src/file.ts:line:col)`.
  - A hook already set on `Error.prepareStackTrace` receives the mapped call sites.
  - On minified Bun builds, a frame for a call can land one line above it.

  Under Bun, development traces had pointed into `dist/main.js` since 4.1.0-beta.4 dropped the eval devtool, and production traces always did without the Node flag.

  Set `sourceMappedStacks: false` in `meocord.config.ts` for an error tracker that applies uploaded source maps to the bundle's positions. See [Stack traces](https://github.com/meocord/meocord/blob/main/README.md#stack-traces).

- [#151](https://github.com/meocord/meocord/pull/151) [`8faddd0`](https://github.com/meocord/meocord/commit/8faddd08b9a05d51348dbf20d3ea2ac60e92a708) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Source-mapped stacks leave alone what a bot's dependencies do with `Error.captureStackTrace`. Some packages give it an object built by a function rather than an `Error`: follow-redirects, which axios loads, and node-fetch 2 both do. Bun's own stack hook refuses such an object, so MeoCord no longer hands it one, and that stack reads as it does with no hook set. A stack hook set before MeoCord's that throws no longer fails the code reading the stack; MeoCord writes the stack itself.

- [#155](https://github.com/meocord/meocord/pull/155) [`e064407`](https://github.com/meocord/meocord/commit/e06440740fadd25bce7eddec78ab0b8e4c4b57c0) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A new app's `test:coverage` reads files no spec imports. Coverage counts them as untested, and gets them as `file.ts?cache=…&vitest-uncovered-coverage=true`. The template's SWC plugin matched files by extension only, so it skipped those, and istanbul stopped with a syntax error on the first type annotation or decorator in one. The template now passes SWC an `include` that allows that query. For an existing app, see [Smaller changes](https://github.com/meocord/meocord/blob/main/docs/MIGRATING.md#smaller-changes).

- [#218](https://github.com/meocord/meocord/pull/218) [`9022251`](https://github.com/meocord/meocord/commit/9022251cbb4aaa88f5c75b7905419db0ed527443) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A click a discord.js collector takes is no longer answered "Command not found!". A button, select menu or modal submission no `@Command` route matches was answered at once, before a collector's `collect` callback or `awaitModalSubmit` could answer it, so the user saw "Command not found!" and the collector's own answer failed as already sent. While anything besides MeoCord listens for the client's interactions, such an interaction is now left to it for 1.5 seconds, and "Command not found!" and its warning come only if nothing has answered it by then. A bot with no other listener, and a command no handler takes, are answered at once as before. In a testing module, `dispatch()` does the same for the client of the interaction it is given. Observers are told of such an interaction only when nothing answered it, as `'not-found'`; a click a collector answered is the collector's, and is not reported.

## 4.1.0-beta.4

### Minor Changes

- [#137](https://github.com/meocord/meocord/pull/137) [`c778561`](https://github.com/meocord/meocord/commit/c778561f583a1246570881c56348c3b850bc8330) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `@Cooldown` takes `by`, a function of the call that counts calls apart by a value, such as the account a button acts on: `@Cooldown({ seconds: 3600, by: (_context, { uid }: { uid: string }) => uid })` lets a user check each of their accounts in once an hour, where before the first check-in blocked the rest. `by` receives the handler's params as the handler does, after validation and pipes, and the handler's params are checked against the ones `by` declares at compile time. With `per: 'global'`, the limit is per resource across every user. Returning `undefined` counts as before; an error `by` throws goes to the exception filters, and nothing is counted. `inspectHandler(...).cooldowns` now reports `by` alongside `bypass`.

- [#143](https://github.com/meocord/meocord/pull/143) [`add425d`](https://github.com/meocord/meocord/commit/add425d6d37171828d23fb8d6e07532eec349d7f) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `testCooldownStore` in `meocord/testing` checks a `CooldownStore` you write yourself, over Postgres, SQLite, MongoDB or anything else, against the behaviour `MemoryCooldownStore` defines. It registers its cases with your test framework's `describe`, `it` and `expect`, so it runs under Vitest or Jest:

  ```typescript
  import { testCooldownStore } from 'meocord/testing'

  testCooldownStore('PostgresCooldownStore', () => new PostgresCooldownStore(sql), { describe, it, expect })
  ```

  It covers calls within a window, a sliding window, `retryAfterMs` counted from the oldest call still in the window, each key counted on its own, calls in the same millisecond kept distinct, and several concurrent calls at the limit where exactly one passes. It uses real time with short windows and takes a few seconds. The README's [Store recipes](https://github.com/meocord/meocord/blob/main/README.md#store-recipes) show stores for Postgres, SQLite and MongoDB.

- [#140](https://github.com/meocord/meocord/pull/140) [`28f0f0a`](https://github.com/meocord/meocord/commit/28f0f0ae8bd660f3dccc332d87f657b1a069c49b) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `ExecutionContext.getHandlerParams<P>()` returns the handler's params, its second argument, to any stage: a command's options, a component's customId params, a modal's fields or a message pattern's params. A guard sees them raw, an interceptor raw before `next.handle()` and validated and piped after it, and a filter as they were when the error was thrown. It returns a patterned `@MessageHandler`'s params too, and is `undefined` for message listeners, reaction and event handlers, and a call no handler was reached for. It is separate from `getParams()`, which stays the running stage's own `{ provide, params }`. `createExecutionContext` takes `handlerParams` for unit tests. `getArgs()` now returns the arguments as they stand too, so after validation and pipes its second argument is the validated and piped params, the same value `getHandlerParams()` returns; in 4.1.0-beta.1 to beta.3 it kept returning the raw arguments.

- [#148](https://github.com/meocord/meocord/pull/148) [`abf9fd8`](https://github.com/meocord/meocord/commit/abf9fd8ba1769ac1cdd2f0c9b1dd1df6de81ff5e) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `@MessageHandler` takes patterns with params, using the `{name}` syntax of customId routes: `@MessageHandler('roll {sides} {note...?}')` gives the handler `{ sides, note }` as its second argument. `{name}` is one word, and words in quotes count as one; `{name...}` takes the rest of the message as typed; `{name?}` and `{name...?}` are optional; the last three come only at the end. `@Validate`, pipes, `@Cooldown({ by })` and `ExecutionContext.getHandlerParams()` see a patterned message handler's params as they do a component's. `@MeoCord({ messages: { prefix, mention, caseSensitive } })` sets the prefix, a string, a list or a function of the message, accepts a mention of the bot when `mention` is on, and matches the prefix and literal words in any case unless `caseSensitive` is set; a handler overrides them with `@MessageHandler('ping', { prefix: false | '?' | ['?', '??'], caseSensitive })`. Only the most specific matching pattern runs, across every controller: more literal words first, then a fixed number of words before a rest, then fewer params. `@MessageHandler()` without a pattern still runs for every message. A pattern that cannot be read, and two that match the same messages, stop the bot at startup. In `meocord/testing`, `resolveRoute(App, { content })` resolves a message, `invoke(Controller, 'method', message)` passes the params the pattern captures, `inspectHandler(...).pattern` reports the pattern, and `createMockMessage()` comes from a user rather than a bot.

  A 4.0 keyword now matches in any case and word by word, only the most specific of two matching patterns runs, two handlers with the same keyword stop the bot at startup, and a configured prefix applies to existing keywords unless they set `prefix: false`. See [Message keywords match in any case, and only one runs](https://github.com/meocord/meocord/blob/main/docs/MIGRATING.md#message-keywords-match-in-any-case-and-only-one-runs).

- [#147](https://github.com/meocord/meocord/pull/147) [`5a2813f`](https://github.com/meocord/meocord/commit/5a2813f72b9d8afc9e0797ee266929b98433ad5c) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Observers see every call MeoCord dispatches once it has settled, for metrics and audit logs. Mark a class `@Observer()`, implement `DispatchObserver`'s `onSettled(context, result)`, and list it in `@MeoCord({ observers })`. It is told about commands, components, modals, autocomplete, message, reaction and event handlers, and interactions no handler matches. The `DispatchResult` carries an `outcome` (`'ran'`, `'denied'`, `'cooldown'`, `'invalid'`, `'error'` or `'not-found'`), `startedAt` in epoch milliseconds, a `durationMs` covering the whole call through the filters and the fallback, the guard that denied it as `deniedBy`, where an interaction's answer stood as `response` (`'replied'`, `'deferred'` or `'unanswered'`), the `error`, and whether a filter or the fallback `handled` it. An optional `onStart(context)` sees the call begin, before the guards, with the same context object `onSettled` later receives, so a `WeakMap` pairs them into a span. Observers run in the order listed, and the call never waits for them: one that is slow never delays a handler, and one that throws is logged while the rest still run. `@Observer({ types })` limits one to some kinds of call. They are services, so they inject dependencies and their `onReady` and `onShutdown` hooks run in dependency order. A message no handler matches is not reported. In `meocord/testing`, `invoke` and `emit` wait for the module's observers, the testing module takes `observers`, and `inspectHandler(...).observers` lists an app's. `npx meocord g ob <name>` generates one with its spec.

- [#144](https://github.com/meocord/meocord/pull/144) [`6798abd`](https://github.com/meocord/meocord/commit/6798abd830f3f4b62b073413ca663d48b062f4b7) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `RedisCooldownStore` in `meocord/common` keeps `@Cooldown` counts on Redis, so they survive a restart and are shared by every shard and process that uses the same server, which keeps `'user'` and `'global'` cooldowns exact under process sharding. MeoCord adds no Redis dependency: give `RedisCooldownStore.using` a function that runs a script with your client, and pass what it returns to `@MeoCord({ cooldownStore })`:

  ```typescript
  import { RedisCooldownStore } from 'meocord/common'

  // node-redis
  cooldownStore: RedisCooldownStore.using((script, keys, args) => redis.eval(script, { keys, arguments: args }))
  // ioredis
  cooldownStore: RedisCooldownStore.using((script, keys, args) => redis.eval(script, keys.length, ...keys, ...args))
  ```

  One Lua script checks and records each call as one step, timed by the server's `TIME`, with calls in the same millisecond kept apart and every key set to expire. Keys start with `meocord:cooldown:`, or `{ prefix }`; pass `{ evalsha }` to send the script by its SHA1, in full only when the server answers `NOSCRIPT`. It runs on Redis 5 and later, Valkey, KeyDB, Dragonfly and Upstash; Garnet runs Lua only in part, so check it with `testCooldownStore` first. See [Where calls are counted](https://github.com/meocord/meocord/blob/main/README.md#where-calls-are-counted).

- [#145](https://github.com/meocord/meocord/pull/145) [`8f8690c`](https://github.com/meocord/meocord/commit/8f8690c84bc4e6b2676e86842b0ae3e51129c620) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `ShardedCooldownStore` in `meocord/common` makes `'user'` and `'global'` cooldowns exact under process sharding without a database. Each shard asks the shard manager, which counts every shard's calls in its memory over the IPC the shards already use:

  ```typescript
  import { ShardedCooldownStore } from 'meocord/common'

  @MeoCord({ controllers: [...], clientOptions: {...}, cooldownStore: ShardedCooldownStore })
  export default class App {}
  ```

  Counts are kept while the manager runs, so a shard that restarts keeps them, but they start again when the whole bot restarts. For counts that outlive a restart, or a bot on several hosts, use `RedisCooldownStore`. If the manager does not answer within a second, a shard counts the call itself and warns once. The startup warning about per-shard cooldowns stays silent with this store, and now names both shared stores. See [Where calls are counted](https://github.com/meocord/meocord/blob/main/README.md#where-calls-are-counted).

### Patch Changes

- [#142](https://github.com/meocord/meocord/pull/142) [`400f903`](https://github.com/meocord/meocord/commit/400f903510961d7b181352586f2c693f5039eabc) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A `bundleDependencies` build starts under Bun, and under any devtool.

  - **Bun.** A bundled ES module that probes for CommonJS, as lodash-es does with `typeof exports`, left `module` and `exports` in the bundle's top scope. Bun then read the whole bundle as CommonJS and stopped at startup with `Cannot use import statement with CommonJS-only features`, while Node ran it. Those probes now see `undefined`, as they do in any ES module, so `bun dist/main.js` starts. CommonJS dependencies keep their own `module` and `exports`. Rebuild to pick this up; nothing else changes.
  - **Eval devtools.** An `eval-*` devtool, set through `output.sourceMap` or `tools.rspack` in the `rsbuild` hook, is built as its non-eval equivalent (`eval-source-map` as `source-map`, plain `eval` as no source map), with a warning at build time. A module evaluated from a string cannot read `import.meta`, so with `bundleDependencies` such a bundle stopped at startup with `SyntaxError: import.meta is only valid inside modules`. To silence the warning, set `output.sourceMap.js` to the non-eval devtool yourself.
  - Development builds emit `cheap-module-source-map` rather than `eval-source-map`. See [Smaller changes](https://github.com/meocord/meocord/blob/main/docs/MIGRATING.md#smaller-changes) in the upgrade guide.

## 4.1.0-beta.3

### Patch Changes

- [#133](https://github.com/meocord/meocord/pull/133) [`9153786`](https://github.com/meocord/meocord/commit/9153786e695a7d98c5d6b777e77cc07381e2c22e) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Ships every change listed under 4.1.0-beta.2, which was not published on its own. Providers in `@MeoCord({ providers })` and in the testing module's `providers` can be listed in any order: a class listed there is bound once, even when a provider earlier in the list injects it.

## 4.1.0-beta.2

Not published to npm: these changes first ship in 4.1.0-beta.3.

### Minor Changes

- [#123](https://github.com/meocord/meocord/pull/123) [`3924763`](https://github.com/meocord/meocord/commit/3924763805de2c1b6c44ca2d94e72e823956b67d) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `@MeoCord({ providers })` provides values, classes and sync or async factories under a class, string, symbol or `createToken` token, injected with the new `@Inject(token)`, with their `onReady` and `onShutdown` hooks run in dependency order; `MeoCordTestingModule` takes the same providers.

- [#132](https://github.com/meocord/meocord/pull/132) [`9dcfec5`](https://github.com/meocord/meocord/commit/9dcfec5d37b7a2f0e13a8fdf9193be80f39e994f) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `meocord/testing` exports `clearAllMocks()` and `resetAllMocks()`, which reach every mock it made: `createMockFn`, and the mocks inside `createMockInteraction`, `createMockClient` and the rest. Vitest's `clearMocks` and jest's `clearAllMocks()` only reach their own `vi.fn()` and `jest.fn()`. New projects call `resetAllMocks()` after every test from `vitest.setup.ts`. To do the same in an existing project, add `afterEach(() => resetAllMocks())` to a Vitest setup file, and set what a mock returns in the test, or in `beforeEach`, that relies on it.

### Patch Changes

- [#125](https://github.com/meocord/meocord/pull/125) [`c8584a6`](https://github.com/meocord/meocord/commit/c8584a63e9b9d0a4db629338c137bf26a96fa765) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `createMockChannel` takes `ThreadChannel`, stubs `threads.create` on text, announcement, forum and media channels, and gives a subclass the managers of the channel class it extends.

- [#130](https://github.com/meocord/meocord/pull/130) [`1b81e6d`](https://github.com/meocord/meocord/commit/1b81e6d4035e41a02d5b2cabaed503927c8e09af) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Mocks from `meocord/testing` behave more like discord.js. An interaction mock has a `locale` of `'en-US'`, and a `guildLocale` of `'en-US'` with a `guildId` and `null` without, so `t.for(interaction, { public: true })` works on a default mock. A method that returns a promise in discord.js now resolves instead of returning `undefined`, so `await` and `.catch()` work without setup. `send()` and `reply()` resolve to a mock message. A manager's `fetch(id)`, `create()` and `edit()` resolve to a mock of its item, and a list fetch to an empty `Collection`. `createDM()` resolves to a DM channel, and a structure's own `edit()`, `fetch()` and setters to the structure itself. `mockResolvedValue` and `mockRejectedValue` still override them.

- [#126](https://github.com/meocord/meocord/pull/126) [`8cee75d`](https://github.com/meocord/meocord/commit/8cee75d56a250cc86ced77325cdffa20557431eb) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `respond()` reads discord.js's deprecated `ephemeral: true` as `flags: MessageFlags.Ephemeral`, so a private follow-up on a public deferred reply is no longer shown to everyone as an edit of that reply, and tests see the privacy the bot sends; `flags: MessageFlags.Ephemeral` is the supported form.

- [#131](https://github.com/meocord/meocord/pull/131) [`b5e7e63`](https://github.com/meocord/meocord/commit/b5e7e6358bdb325fac4a21b0415922a50ec1727a) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A controller or service whose constructor parameter has no runtime type now stops `MeoCordFactory.create`, and the testing module, before anything is bound. The error names the class, the parameter and the classes that inject it, and says how to fix it. This happens when two services import each other, or a parameter is typed with an interface or an `import type`; the error inversify raised before pointed at the compiler options instead. `meocord/eslint` now warns on import cycles (`import-x/no-cycle`, type-only imports ignored) in projects that have `eslint-import-resolver-typescript`, which it needs to follow imports through `@src`. New projects include it; in a project without it the check stays off and lint is unchanged. Add it with `npm i -D eslint-import-resolver-typescript` to get the warning.

## 4.1.0-beta.1

### Minor Changes

- [#120](https://github.com/meocord/meocord/pull/120) [`9d435d9`](https://github.com/meocord/meocord/commit/9d435d9da2bc62eab012ea2b80df2c1e001a926e) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `createMockMessage()` takes an `id`, `content`, `components`, `embeds` and `flags`, so a test can put controls on the message a button sits on, such as to check what `@Defer` locks; components and embeds may be API JSON, builders or discord.js instances.

### Patch Changes

- [#118](https://github.com/meocord/meocord/pull/118) [`5c636aa`](https://github.com/meocord/meocord/commit/5c636aa930224aef9b4670a5e16b234a3f57397d) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Tools that read the installed version with `require('meocord/package.json')` no longer fail with `ERR_PACKAGE_PATH_NOT_EXPORTED`.

- [#121](https://github.com/meocord/meocord/pull/121) [`c6990c2`](https://github.com/meocord/meocord/commit/c6990c250f7694ca5adb9963e89f151b7ed5dc4b) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `inGuild()`, `inCachedGuild()` and `inRawGuild()` on a mock answer from its `guildId` and `guild`, so a mock created without a `guildId` is a DM and a guard that requires a guild returns `false`, not `undefined`.

## 4.1.0-beta.0

### Minor Changes

- [#66](https://github.com/meocord/meocord/pull/66) [`5b49d3e`](https://github.com/meocord/meocord/commit/5b49d3e2e827d4a3db88e3e554693957f1082ade) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Choose where commands are registered, and register without starting the bot.

  - `commands` in `meocord.config.ts`: `guilds` registers to guilds instead of globally, `developmentGuild` sends everything to one test guild under `start --dev`, `register: false` leaves registration to `meocord register`, and `clearOther` removes commands left in a scope no longer used, which are otherwise reported as a warning; a development run sending to `developmentGuild` only warns, since production may share the application.
  - `@CommandBuilder(type, { guilds })` keeps one command in its own guilds, for staff commands.
  - `meocord register [--build] [--dev] [--guild <id>]` registers over REST and exits, without logging in, and exits non-zero on failure.
  - In development, a scope whose commands are unchanged since the last start is not sent again; `meocord start --dev --force-register` sends it anyway.
  - Commands are read from the controllers' prototypes, so registering constructs no controller.

  With no `commands` setting, an existing bot still registers every command globally at each start. One thing does change: a builder whose `toJSON()` throws, such as a slash command missing its description, now stops that start's registration. You see an error naming the builder, and no commands are sent, where before the rest were registered and the broken one was dropped. A bulk update without it would delete it from Discord. Fix the builder and the next start registers everything.

  New applications get `developmentGuild` wired to `DEV_GUILD_ID` in `.env`.

- [#76](https://github.com/meocord/meocord/pull/76) [`6bfe0e3`](https://github.com/meocord/meocord/commit/6bfe0e3660664d834c23404c0dcac0477a469edb) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Limit how often a handler runs with `@Cooldown`.

  - `@Cooldown({ seconds, uses, per, bypass })` on an interaction or message handler, or a controller, allows `uses` calls within `seconds` (a sliding window), counted per `'user'`, `'guild'`, `'channel'` or `'global'`. Stack several for layered limits: each call counts against every one of them in order, so a call a later limit blocks has still used the earlier ones; put the shortest window first. `bypass` exempts callers such as owners. Counts are kept under the class name, so two same-named classes are refused at startup when either has a cooldown or a `@Once` handler.
  - It is counted after guards, validation and pipes, so a denied call or bad input spends nothing. A blocked call throws `CooldownError` (from `meocord/common`), which the built-in fallback answers only to the caller with `cooldownMessage()`: "Slow down: try again in 12s."
  - Calls are counted in memory by default. `@MeoCord({ cooldownStore })` takes a class extending `CooldownStore`, such as one on Redis, to share the count across shards and processes; with process sharding and the in-memory store, the bot warns that `'user'` and `'global'` cooldowns count per shard.
  - `inspectHandler(...).cooldowns` lists a handler's cooldowns.

- [#81](https://github.com/meocord/meocord/pull/81) [`017ec6c`](https://github.com/meocord/meocord/commit/017ec6cae7ac0510260e441bbef51bfe379f1ea9) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Add `@Defer()`, which acknowledges an interaction for its handler in two steps: a deferred reply (or an invisible deferred update, for a component) before guards run, so slow guards and handlers never miss Discord's three seconds; then, once guards, validation and pipes allow the call, a lock on the component's message — its controls disabled, the clicked button showing the loading emoji, the presenter's loading view added. `respond(interaction).send()` without `components` puts the message back as it was, including buttons that were disabled on purpose, and a handler that never answers has it put back when it returns. A guard that returns `false` leaves nothing behind, and one that throws `GuardDeniedError` is answered privately.

  Options: `ephemeral`, `disable` (`'all'`, `'clicked'` or `'none'`), `mode: 'auto'` to acknowledge only when the handler has not answered after `after` milliseconds (1500 by default, and never later than 2.5 seconds after the interaction was created), and `suppressNotifications`. `@Defer` on a message, reaction, event or autocomplete handler throws.

- [#69](https://github.com/meocord/meocord/pull/69) [`f00309f`](https://github.com/meocord/meocord/commit/f00309f6df7e0e42cd3a04c6ba8e7119889abfa2) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Add exception filters, which decide what happens when a handler, its interceptors or its guards throw.

  - `@Catch(ErrorType, ...)` marks a class implementing `ExceptionFilter`: `catch(error, context)` receives the error and the call's `ExecutionContext`. With no types, it handles every error.
  - `@UseFilter(...)` applies filters to a method or a controller, and `@MeoCord({ filters })` to every handler. The method's filters are tried first, then the controller's, then global ones; within one level, the first whose `@Catch` matches. `{ provide, params }` passes options, read with `context.getParams()`. One instance serves every call.
  - An interaction no handler matches raises `CommandNotFoundError`, which global filters receive with no handler in the context.
  - `GuardDeniedError`, thrown from a guard, denies with a message the built-in fallback shows only to the user who made the call. Returning `false` still denies silently.
  - An error no filter handles goes to the built-in fallback, which logs it and answers the user: "An error occurred while executing the command.", or "Command not found!".
  - Testing: `overrideFilter(Class).useValue(stub)`, `inspectHandler(...).filters`, and `MeoCordTestingModule.create({ app })` includes global filters. `invoke` resolves with `error` set when a filter handled one, and rejects with an error no filter handles, since the fallback does not run in tests.
  - `meocord generate filter <name>` (alias `f`) writes a filter, the error it handles, and a spec.

- [#60](https://github.com/meocord/meocord/pull/60) [`f3ea0df`](https://github.com/meocord/meocord/commit/f3ea0df560d0deca8f6fc3b73b64b4abc56ca59d) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Add typed handler metadata and `ExecutionContext`, so guards can read what they guard.

  - `createMetadata<T>(description)` in `meocord/common` makes a typed decorator for a controller or a handler, with a unique key.
  - `ExecutionContext` in `meocord/common` describes the handler call being run. A guard receives it by constructor injection and reads metadata with `context.get(Roles)`, where the handler's value wins over the controller's. It also gives the handler's arguments, the controller and method, the call type, and the guard's `{ provide, params }` through `getParams()`. `SetMetadata` keys are read with `context.get('roles')`.
  - `createExecutionContext(Controller, 'method', { args, params })` in `meocord/testing` builds that context for a guard's unit test.
  - `meocord generate guard` now generates a guard that reads a `createMetadata` decorator through `ExecutionContext`, with a spec using `createExecutionContext`.

  Existing guards and tests work unchanged: guards run in the same order, once each, whether a handler is dispatched or called directly in a test. A controller or service, which is shared across calls, cannot inject `ExecutionContext`; the bot and `MeoCordTestingModule` refuse to start with a clear error rather than handing one call's context to another.

- [#110](https://github.com/meocord/meocord/pull/110) [`5d45fc4`](https://github.com/meocord/meocord/commit/5d45fc4380baf8410beeaf62094f9090b4127507) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `isExplainedError(error)` in `meocord/common` tells whether MeoCord has already logged what went wrong with an error `app.start()` rejects with, and what to do about it, such as a privileged intent Discord refused. New apps' `main.ts` uses it to skip logging such an error a second time with its stack trace; an existing app can do the same:

  ```typescript
  bootstrap().catch(error => {
    if (!isExplainedError(error)) logger.error('Error during startup:', error)
  })
  ```

- [#68](https://github.com/meocord/meocord/pull/68) [`1eb5f7f`](https://github.com/meocord/meocord/commit/1eb5f7f067018b659f1dec0e3e69f8fd3632f1ad) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Add gateway event handlers and handler discovery.

  - `@On(event)` and `@Once(event)` from `meocord/decorator` handle any discord.js client event on a controller or service, with the handler's parameters typed from `ClientEvents`. Event handlers run through the same pipeline as commands, so guards, interceptors and exception filters apply; an error no filter handles is logged with the event and handler, without stopping the bot. At startup MeoCord warns about intents and partials the handlers need that `clientOptions` lacks, for `@MessageHandler` and `@ReactionHandler` too.
  - `HandlerRegistry` from `meocord/core` lists every registered handler — commands (one entry per subcommand path), components, modals, autocomplete, message, reaction and event handlers — with the metadata declared on it. Inject it into a service to build a `/help` command or generated docs.
  - `TestingModule.emit(event, ...args)` sends an event to a testing module's handlers through the same pipeline, and `MeoCordTestingModule` binds `HandlerRegistry`.
  - A guard's `canActivate` now also receives an event handler's arguments, so its first parameter accepts any value, and `@UseGuard` no longer throws when a method's first argument is not an interaction, message or reaction.
  - Global guards and interceptors from `@MeoCord({ guards, interceptors })` also run on event handlers. `@Guard({ types })` and `@Interceptor({ types })` limit a guard or interceptor to the context types it is written for, at every level, and a subclass inherits them unless it declares its own. An empty list, or `'autocomplete'` for an interceptor, which never runs there, throws when the class is decorated. At startup MeoCord names each global one without `types` that will also run on events. With no stage that applies to a call, no execution context is built.

- [#65](https://github.com/meocord/meocord/pull/65) [`939e206`](https://github.com/meocord/meocord/commit/939e206660d9ad902a7571faeb145b80044e96b8) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Add global guards: `@MeoCord({ guards })` runs guards before every dispatched handler — commands, components, modals, autocomplete, message and reaction handlers — ahead of the controller's and the method's own guards. Entries take the same forms as `@UseGuard`, a guard class or `{ provide, params }`, and guards that inject `ExecutionContext` receive it. A controller method called directly still runs only its own guards.

  For tests, `MeoCordTestingModule.create({ app: App, ... })` reads the application's global guards, so `module.invoke` runs them first, and `inspectHandler(Controller, 'method', { app: App })` lists them first. Controllers and providers are still listed as before.

- [#78](https://github.com/meocord/meocord/pull/78) [`99a8bd4`](https://github.com/meocord/meocord/commit/99a8bd4f953e7dc54dd4d385afe66db8085dfb79) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Add `respond(interaction)`, one place to answer an interaction, and presenters to style MeoCord's answers.

  - `respond(interaction)` in `meocord/common` returns the interaction's response state, typed as the `ResponseState` interface: `acknowledge()`, `send()`, `edit()`, `followUp()`, `delete()`, `modal()` and `error()`. Each picks the Discord call from where the answer stands — reply, update or edit — re-read from the interaction on every call, so answers made directly with discord.js still count. Flags are computed per call, so an ephemeral follow-up never leaks into the next message, and one sent while a public deferred reply is still empty stays private instead of becoming that reply; Components V2 edits keep their flag; re-sent Discord attachment images are pointed at `attachment://`.
  - Answers go through the interaction's own methods, which work wherever a user-installed app is used. The channel is used only once the interaction's token has expired and the bot is present. `getInstallContext(interaction)` in `meocord/common` reports where an interaction happened and whether the bot is there.
  - `error(error, { message, visibility })` shows an error and never throws. The built-in fallback now answers through it, so an error on a private (ephemeral) component message is added to that message rather than sent separately.
  - `@MeoCord({ presenter })` takes a `ResponsePresenter` that styles the error and loading views. Without one, errors look as before, and the loading view is "⏳ Working on it…" in the new `Theme.primaryColor`.
  - Interceptors and filters reach the state as `context.response`.
  - Testing: `getResponse(interaction)` reports what `respond()` sent; `createDiscordError(code)` builds the error discord.js throws; mock messages carry real, empty `flags`, `components`, `embeds` and `attachments`; mock `showModal()` and a modal submission's `deferUpdate()` answer the interaction as the real ones do.

- [#67](https://github.com/meocord/meocord/pull/67) [`6c47f09`](https://github.com/meocord/meocord/commit/6c47f0924c278277985c045bdca9e301bc7f5420) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Add interceptors, which run around a handler once its guards allow the call — for timing, logging, caching or mapping errors.

  - `@Interceptor()` marks a class implementing `InterceptorInterface`: `intercept(context, next)` receives the call's `ExecutionContext` and continues with `next.handle()`, which resolves to what the handler returns. An interceptor can act before and after the handler, skip it, or replace the error it throws.
  - `@UseInterceptor(...)` applies interceptors to a method or a controller, including inherited handlers, and `@MeoCord({ interceptors })` to every handler. Global interceptors are outermost, then the controller's, then the method's. `{ provide, params }` passes options, read with `context.getParams()`.
  - One instance serves every call. An interceptor that injects `ExecutionContext` is refused at startup.
  - Interceptors run for dispatched handlers and under `TestingModule.invoke`; a controller method called directly runs its guards but no interceptors, and autocomplete handlers run none.
  - Testing: `overrideInterceptor(Class).useValue(stub)`, `inspectHandler(...).interceptors`, and `MeoCordTestingModule.create({ app })` includes global interceptors. `invoke` resolves `{ ran: false }` when an interceptor skips the handler.
  - `meocord generate interceptor <name>` (alias `i`) writes an interceptor and its spec.

- [#64](https://github.com/meocord/meocord/pull/64) [`37170f3`](https://github.com/meocord/meocord/commit/37170f3abea1c148acfe0891828abb8743f68c0d) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Add lifecycle hooks. A controller or service that implements `OnReady` from `meocord/interface` has `onReady(client, { primary })` called once the bot is ready; one that implements `OnShutdown` has `onShutdown()` called on SIGINT or SIGTERM, before the client is destroyed. Hooks run on every controller and service the app binds, including services no handler has used yet. `onReady` hooks run one at a time in dependency order, each class after the classes it injects, and never wait for command registration; `onShutdown` hooks run in reverse order. A hook that throws is logged and the next one still runs. A signal that arrives while `onReady` hooks are running starts no further `onReady` and shuts down only the classes whose `onReady` finished, and those without one. Shutdown waits for the `onShutdown` hooks up to the new `shutdownTimeout` option in `meocord.config.ts` (10 seconds by default), then destroys the client and exits 0.

  A process now adds one SIGINT and one SIGTERM listener however many apps it starts, so a test suite that creates many apps no longer triggers Node's `MaxListenersExceededWarning`.

- [#73](https://github.com/meocord/meocord/pull/73) [`42b62a1`](https://github.com/meocord/meocord/commit/42b62a19947daccef86930bf769880025a626b29) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Translate commands and replies from typed catalogs.

  - `createTranslator({ default, locales })` in `meocord/common` builds a translator from one catalog per discord.js `Locale`. Keys, `{name}` params and plural forms (`{ one, other, … }`, chosen through `Intl.PluralRules`) are type-checked against the default catalog, which `defineCatalog(...)` or `as const` keeps literal; other locales may leave messages out, and fall back to a locale of the same language, then the default.
  - `t.default(key)` and `t.localizations(key)` fill command builders; `t.for(interaction)`, `t.for(interaction, { public: true })`, `t.forGuild(guild)` and `t.locale(locale)` translate replies.
  - `@MeoCord({ i18n: t })` injects it as `Translator`.
  - `expectCompleteCatalog` in `meocord/testing` reports missing messages and plural forms per locale.
  - Registration refuses localised names and descriptions Discord would reject, listing each field, and a builder that throws while building now names itself and the command.

  Nothing changes for a bot that does not use it.

- [#84](https://github.com/meocord/meocord/pull/84) [`b21b0ed`](https://github.com/meocord/meocord/commit/b21b0ed11c102ac5cc01b86aa90fbb4f035c1323) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `createMockInteraction` accepts `authorizingIntegrationOwners` as the plain map Discord sends — `{ [ApplicationIntegrationType.UserInstall]: userId }` — and builds the `AuthorizingIntegrationOwners` object discord.js would, so testing a user-installed command no longer needs `as never`.

- [#75](https://github.com/meocord/meocord/pull/75) [`b11d77b`](https://github.com/meocord/meocord/commit/b11d77b0e92fe819725fb387d3f27d35581f11cc) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Add `optionalExternals` to `meocord.config.ts`, for packages a dependency tries to load and runs without, such as `supports-color`, which `debug` probes for inside a `try` and which axios brings in. With `bundleDependencies` on, such a package made every build warn, and listing it in `externals` made the bot fail at startup when it was missing, because an external becomes an import that runs before the bot's code. A name listed in `optionalExternals` stays a `require` where the dependency calls it, so a missing package is caught by the dependency, and it is copied into `dist/node_modules` when it is installed. The build warns when a name is also in `externals`. discord.js's optional accelerators, `zlib-sync`, `bufferutil` and `utf-8-validate`, are handled the same way, as before.

- [#72](https://github.com/meocord/meocord/pull/72) [`d9ad59b`](https://github.com/meocord/meocord/commit/d9ad59b3972d7671a58b008efc67f666d57f7a79) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Add sharding, configured by `sharding` in `meocord.config.ts`.

  - `sharding: { shards: 'auto' }` (or a number) runs every shard in one process, in one client, with nothing else changing. Unset, `clientOptions.shards` works as before.
  - `mode: 'process'` runs each shard in its own process. `meocord start`, `node dist/main.js`, bun and process managers such as pm2 all start a manager that registers the commands once, spawns the shards from the built bundle, restarts a shard that exits with a growing delay, stops everything with exit code 1 when a shard's token is invalid or Discord refuses its intents, and on SIGINT or SIGTERM shuts every shard down through its `onShutdown` hooks before killing any left after `shutdownTimeout` plus five seconds. Under `meocord start --dev` every shard runs in one process unless `sharding.development` is `true`.
  - `ShardContext` from `meocord/core` gives the shards of the current process and calls a service method in every shard with `call(Service, 'method', ...args)`, one result per process. Each process runs the class passed in, or, for a call from another process, the class of that name, so with process sharding the bot refuses to start when two controllers or services share a name. `onReady`'s `primary` is `true` only in the process running shard 0.
  - `MeoCordFactory.create()` now returns the new `MeoCordApplication` type, with the same `start()` and `registerCommands()` as before.
  - The generated `meocord.config.ts` shows the `sharding` option, commented out.

- [#63](https://github.com/meocord/meocord/pull/63) [`9e27912`](https://github.com/meocord/meocord/commit/9e27912fc8f026fc3f532eddefcc8fd144712610) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Add `TestingModule.invoke` and `inspectHandler` to `meocord/testing`, for testing a handler the way the bot runs it.

  - `module.invoke(Controller, 'method', ...args)` runs the handler through the same pipeline dispatch uses, starting with its guards, class guards first and each once. Guards resolve from the testing module, so `overrideGuard` stubs apply and guards that inject `ExecutionContext` receive it. It resolves to `{ ran }`, `false` when a guard denied the call, and the method name and arguments are type-checked against the handler. An interaction dispatch could not route to the handler, such as a customId its pattern does not match, is rejected before anything runs.
  - `inspectHandler(Controller, 'method')` reports the guards that run for a handler, in order, and reads its metadata as `ExecutionContext` does, without building a module.

  Calling a controller method directly in a test still runs its guards, as before.

- [#70](https://github.com/meocord/meocord/pull/70) [`ade2be6`](https://github.com/meocord/meocord/commit/ade2be6a1dcb953f89d7f3954833540485bd2192) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Validate a handler's input, and transform it with pipes.

  - `@Validate(schema)` checks an interaction handler's input with any [Standard Schema](https://standardschema.dev) library (zod, valibot, arktype and others) before it runs; a handler takes one, and a second throws when decorated. The handler receives the schema's output, and its second parameter is type-checked against it. Invalid input throws a `ValidationError` (from `meocord/common`) listing each issue, which the built-in fallback answers privately with that list; an exception filter can phrase it otherwise.
  - Pipes turn one validated value into what the handler works with: `@Validate(schema, { pipes: { uid: AccountPipe } })` keeps the handler fully typed, and `@UsePipe(key, ...pipes)` works on its own or beside `@Validate`, where the value it produces is marked `Piped<T>` (from `meocord/interface`). Mark a class `@Pipe()` and implement `PipeInterface`.
  - `meocord generate pipe <name>` (alias `pi`) writes a pipe and its spec.
  - A modal handler's second argument now also carries the submitted fields, keyed by customId, next to the customId params; a param wins over a field of the same name, with a warning in development.
  - `TestingModule.invoke` builds the params from the interaction when a test passes none, and `createModalFields` gives a mock modal its fields.

  Existing handlers keep working: modal handlers receive extra keys, and nothing is validated until you add `@Validate`.

### Patch Changes

- [#65](https://github.com/meocord/meocord/pull/65) [`5df8fa3`](https://github.com/meocord/meocord/commit/5df8fa3d019af0eb2514602cd26c3fec5aa378cd) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A class-level `@UseGuard` now also guards the controller's `@Autocomplete` handlers, including inherited ones, as it does commands, components, message and reaction handlers. Global guards from `@MeoCord({ guards })` run there too. A guard sees an `AutocompleteInteraction` and `ExecutionContext.getType() === 'autocomplete'`, and must not reply; when a guard denies, the menu is closed with an empty list instead of being left loading.

  This changes which guards run for autocomplete. If a class guard assumes a command interaction or replies on denial, see [Class guards now cover autocomplete handlers](https://github.com/meocord/meocord/blob/main/docs/MIGRATING.md#class-guards-now-cover-autocomplete-handlers).

- [#80](https://github.com/meocord/meocord/pull/80) [`cc2fb29`](https://github.com/meocord/meocord/commit/cc2fb2923cd46cb9f44c7ebdc108bfa66d357716) Thanks [@l7aromeo](https://github.com/l7aromeo)! - The CLI stops sooner and says what to do when something is wrong.

  - `build`, `start` and `register` check `meocord.config.ts` first. One that fails to load stops them, naming the file and line, instead of building on. Options of the wrong type, such as `sharding.mode: 'bogus'` or `optionalExternals: 'sharp'`, stop them with a list of every problem, where before some built silently and others failed with an internal error. An option MeoCord does not know is reported as a warning. `start --prod` without `--build` checks the built config the same way, and says when there is no config at all.
  - The compiled config is written only once it has built, so a failed build no longer leaves a broken `dist/meocord.config.mjs` for every later command to trip over.
  - `meocord generate` refuses names that leave its folder (`..`, a leading `/`, a drive letter), which could write outside `src/` or the project, and asks to be run from a project's root. On Windows, `\` separates folders in a name.
  - `meocord create` refuses a name with no letters or digits, which was reported as `Directory "" already exists`.
  - A missing token is reported with where it comes from: `discordToken` in `meocord.config.ts`, which a new app reads from `DISCORD_TOKEN` in `.env`.
  - `start --dev --build` builds once, as the watcher does, instead of twice.

- [#95](https://github.com/meocord/meocord/pull/95) [`86301f7`](https://github.com/meocord/meocord/commit/86301f7bce5ec2529e7271bb8e808c88fee29485) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `meocord start --dev` restarts the bot on the next rebuild after it exited on its own, such as after an error at startup, and Ctrl+C then stops the watcher at once instead of waiting for a second Ctrl+C. The bot started through `npm run` from a script bun runs is launched on node again, rather than handed to npm.

- [#105](https://github.com/meocord/meocord/pull/105) [`8dc19f4`](https://github.com/meocord/meocord/commit/8dc19f49fea3c896de35918c7be5a8ac09f2ac6f) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `meocord --help` and each command's help no longer print "No available choices." for arguments that have no choices, and `meocord create --help` describes its `<app-name>` argument instead of saying "No description provided".

- [#103](https://github.com/meocord/meocord/pull/103) [`35d2276`](https://github.com/meocord/meocord/commit/35d22764a5b011c29f1e0fa5b927cf674d23f6c6) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `meocord start` and `meocord register` pass SIGINT and SIGTERM on to the bot. A signal sent to the CLI alone, as Docker, pm2 and systemd send one, used to stop the CLI and leave the bot running, or, with SIGINT, not stop it at all; the bot now shuts down through its own shutdown path and the CLI exits with its code. One Ctrl+C that reaches a process twice within a second counts once, so it no longer force-kills the shards in process sharding; a second signal after that still stops everything at once.

- [#93](https://github.com/meocord/meocord/pull/93) [`18db29e`](https://github.com/meocord/meocord/commit/18db29ece8640bff65daf7a58d288d76f03ce9ff) Thanks [@l7aromeo](https://github.com/l7aromeo)! - The warning about two component `customId` patterns that can match the same id, such as `a/{x}/c` and `a/b/{y}`, is logged when the bot starts, as the README describes, rather than at the first button, select menu or modal interaction. The routes are built once at startup and reused by every interaction.

- [#69](https://github.com/meocord/meocord/pull/69) [`f00309f`](https://github.com/meocord/meocord/commit/f00309f6df7e0e42cd3a04c6ba8e7119889abfa2) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A command that throws after deferring its reply is now answered instead of left showing "thinking…" until it times out: the deferred reply is edited into the error message. A command or component that throws after it already replied now gets a private follow-up with the error, where it used to get nothing. Buttons, select menus and modals submitted from a public message are answered with a private follow-up, never by editing the message the user clicked; on a private (ephemeral) message, the error is added to that message. Unanswered interactions are answered exactly as before.

  If you want a different answer in these cases — a different text, no answer, or a log to an error service — register an exception filter with `@Catch()` in `@MeoCord({ filters })`: filters run before this built-in answer and replace it.

- [#56](https://github.com/meocord/meocord/pull/56) [`c2c09d7`](https://github.com/meocord/meocord/commit/c2c09d7b703408b2813f6088c2f09e9dc4bad20c) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Update `@rsbuild/core` to 2.2.9, and generate new applications with `prettier` 3.9.9.

- [#59](https://github.com/meocord/meocord/pull/59) [`7cfea8d`](https://github.com/meocord/meocord/commit/7cfea8d383680e30e1d80d62c6a14e337563c897) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `meocord/eslint` ignores `coverage/`. Flat config does not read `.gitignore`, so running `eslint` after `test:coverage` in a generated application linted the istanbul report and failed with three warnings about unused `eslint-disable` directives. Nothing to do after upgrading.

- [#110](https://github.com/meocord/meocord/pull/110) [`213bd8b`](https://github.com/meocord/meocord/commit/213bd8bdc555777d840b20ec74fb603dfe05eca4) Thanks [@l7aromeo](https://github.com/l7aromeo)! - When Discord refuses a privileged intent at login, the bot now says which privileged intents it requests (`GuildMembers`, `GuildPresences`, `MessageContent`) and where to enable them — Developer Portal → your application → Bot → Privileged Gateway Intents — and that a verified bot in 100 or more servers needs Discord's approval for them. Before, it printed only "Used disallowed intents" and a stack trace. Intents Discord refuses as invalid are explained too. The stack trace moves to debug level; the exit code and the error `app.start()` rejects with are unchanged.

- [#59](https://github.com/meocord/meocord/pull/59) [`d4612b3`](https://github.com/meocord/meocord/commit/d4612b31817ca35292b2290804e60882ca10d312) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Generated controllers, context menu builders and services pass the application's lint as written. `meocord g` output carried a blank line at the start of each controller class, a split context menu builder chain and a semicolon in the service, which failed prettier whenever `eslint --fix` had not already rewritten the file. Files you generated earlier are unaffected; `eslint --fix` corrects them.

- [#58](https://github.com/meocord/meocord/pull/58) [`88cb6f0`](https://github.com/meocord/meocord/commit/88cb6f0916628f3a6915a44908c5fec299df3629) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Fix handlers of a controller that extends another controller being added to the parent class too. A subclass's `@Command`, `@MessageHandler`, `@ReactionHandler` and `@Autocomplete` handlers were written into the base class's metadata, so the base controller listed, and could be routed to, handlers it does not have. Each class now keeps its own copy, including the handlers it inherits.

  Fix the guard list stored under `MetadataKey.Guards` when `@UseGuard` is used on both a class and its methods. The class-level list replaced the method's own guards; it now holds every guard that runs, class-level guards first, in the order they run. Which guards run is unchanged.

- [#109](https://github.com/meocord/meocord/pull/109) [`2d4738a`](https://github.com/meocord/meocord/commit/2d4738ae09798732616ea7f356a148fe23dc7eda) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A handler may take fewer parameters than dispatch passes, as any TypeScript callback can. `@Command`, `@Autocomplete`, `@MessageHandler` and `@ReactionHandler` on a method with no parameters, such as `async refresh() {}`, failed to compile with TS1241 ("Unable to resolve signature of method decorator"), and `@Validate` or `@UsePipe` on a handler that ignores its input was refused as a mismatch. Both now compile. A parameter of the wrong type is still refused.

- [#65](https://github.com/meocord/meocord/pull/65) [`53eac95`](https://github.com/meocord/meocord/commit/53eac95ee9f637cb644f950527eedc17ef1e0fe5) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A class-level `@UseGuard` now also guards the handlers a controller inherits. On a controller that extends another, the subclass's guards were applied only to the handlers it declared itself, so inherited commands, components, message and reaction handlers ran without them. They now run the subclass's guards first, then the base class's, then the method's, whether dispatched, called directly or run with `TestingModule.invoke`.

  This changes which guards run for inherited handlers. If your bot relied on an inherited handler skipping the subclass's guards, see [Class guards now cover inherited handlers](https://github.com/meocord/meocord/blob/main/docs/MIGRATING.md#class-guards-now-cover-inherited-handlers).

- [#64](https://github.com/meocord/meocord/pull/64) [`a42ca18`](https://github.com/meocord/meocord/commit/a42ca18332f843408dce6ac373b738f7e1af4961) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Fix `MeoCordFactory.create()` for a controller or service that injects a dependency with `@inject(Token)` on a parameter typed as an interface. The factory followed only the parameter's type, which for an interface is `Object`, so it bound `Object` instead of the token and resolving the class failed with "missing metadata on type Object". It now binds the `@inject` token, and skips built-in constructors such as `Object`.

- [#62](https://github.com/meocord/meocord/pull/62) [`04c7333`](https://github.com/meocord/meocord/commit/04c7333ccb608afa425db93a0bfb7b6beb58f217) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `process.env` values loaded by `meocord.config.ts` are set before the application's modules run. `main.ts` imports `App` before anything else, so an option such as `@MeoCord({ activities: [{ name: process.env.STATUS! }] })` read the environment before the config's `dotenv` import had loaded `.env`, and got `undefined`. The build now loads `dist/meocord.config.mjs` ahead of `main.ts`, for every way of starting the bundle. Rebuild to pick it up; no code changes. The README shows how to choose a `.env` file per environment.

- [#69](https://github.com/meocord/meocord/pull/69) [`baa94ed`](https://github.com/meocord/meocord/commit/baa94ed1819fbc7d5ea5a179af7220d614226766) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `createMockInteraction(ModalSubmitInteraction)` now runs the real `isFromMessage()`, so it returns `true` only when the mock has a `message`, as a real modal does. It returned `undefined`.

- [#113](https://github.com/meocord/meocord/pull/113) [`9b54a71`](https://github.com/meocord/meocord/commit/9b54a71a0ee0fe42181fc18ef03ff03b2ed1dd28) Thanks [@l7aromeo](https://github.com/l7aromeo)! - MeoCord's repository is now `meocord/meocord` on GitHub. The package's repository, homepage and issue links point there, and so does the README that `meocord create` writes for a new application. Links to the old `l7aromeo/meocord` address redirect, so nothing needs changing in your code or bookmarks.

- [#61](https://github.com/meocord/meocord/pull/61) [`1f09800`](https://github.com/meocord/meocord/commit/1f098002964d21e3d5c367188cc8403d8dcd8a43) Thanks [@l7aromeo](https://github.com/l7aromeo)! - The `RateLimitGuard` that 4.0 copied into generated applications never limited anything: a new guard instance is created for every call, so the counts it kept on the instance started empty each time. New applications no longer get it; they limit their sample commands with `@Cooldown`.

  Upgrading `meocord` does not change the copy in your application. If your app still has `src/guards/rate-limit.guard.ts`, move its `rateLimits` map out of the class to module level, so every instance shares it, or replace the guard with `@Cooldown({ uses, seconds })`.

  The README now explains that a guard instance is created for every call, and shows how to pass options to a guard with `@UseGuard({ provide, params })`.

- [#84](https://github.com/meocord/meocord/pull/84) [`ed07729`](https://github.com/meocord/meocord/commit/ed07729ef2ca4b9b26583c9630a32b601b2b79f6) Thanks [@l7aromeo](https://github.com/l7aromeo)! - New applications from `meocord create` start with the 4.1 patterns. Existing applications are not changed: upgrading `meocord` never touches your code.

  - The sample controllers answer through `respond(interaction)`. The button, select menu and modal samples use `@Defer`, and the button sample's second handler is guarded by an `OwnerGuard` that denies with `GuardDeniedError`.
  - The slash, button, modal and context menu samples limit how often they run with `@Cooldown({ uses: 5, seconds: 60 })`, and the `RateLimitGuard` and its spec are gone.
  - `src/presenters/app.presenter.ts` styles the loading and error views, registered with `@MeoCord({ presenter })`.
  - Each sample's spec runs its handler with `invoke` and checks what `respond()` sent.

- [#88](https://github.com/meocord/meocord/pull/88) [`53517cc`](https://github.com/meocord/meocord/commit/53517cce6384d6f718f4831ab67d2cb7f49f1f40) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `SetMetadata` refuses the keys MeoCord stores its own metadata under, such as `'guards'` and `'commandType'`, and throws when the decorator is created, naming the key. A value under `'guards'` replaced the guard list dispatch runs, so a handler decorated with `@SetMetadata('guards', …)` above its `@UseGuard` ran with none of its guards. Choose another key, or declare the decorator with `createMetadata`, whose key is unique; see [`SetMetadata` refuses MeoCord's own keys](https://github.com/meocord/meocord/blob/main/docs/MIGRATING.md#setmetadata-refuses-meocords-own-keys).

  A guard class listed in `@MeoCord({ services })` is warned about at startup: one shared instance takes every call's `{ provide, params }`.

- [#107](https://github.com/meocord/meocord/pull/107) [`aca4436`](https://github.com/meocord/meocord/commit/aca4436aba0c4400ca9f95aa78f428999f6283bd) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `@UseGuard`, `@UseInterceptor`, `@UseFilter`, `@UsePipe`, `@Validate`'s pipes and `@MeoCord({ guards, interceptors, filters })` all take the same entries: a class, or `{ provide: Class, params? }`. `params` is now optional for guards, interceptors and filters too, as it already was for pipes, so `{ provide: ChannelGuard }` works as the class alone; before, a guard or interceptor given that way failed inside the container on its first call.

  Anything else, such as `null`, a `provide` that is not a class, or `params` that are not an object, is refused when the decorator applies, with an error naming the decorator and the class or handler, instead of failing when a call first reaches it.

- [#65](https://github.com/meocord/meocord/pull/65) [`1c4ed6f`](https://github.com/meocord/meocord/commit/1c4ed6f2671f9932c8940f560d0a4f01c51ec8b8) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Fix dependency injection for a controller, service or guard that extends another decorated class. The subclass was treated as already set up because its base class was, so its own constructor's dependencies were never injected: a subclass with its own constructor failed to resolve, and one without a constructor was built with no arguments. A subclass now gets its own constructor's dependencies, or its base class's when it declares no constructor, and inherits its base class's injected properties. No change is needed in your code.

- [#92](https://github.com/meocord/meocord/pull/92) [`a531fcb`](https://github.com/meocord/meocord/commit/a531fcbc7bafb2f4a88d329ce5cec0efd358a722) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Fix building an application whose `tsconfig.json` uses `extends`, `files`, or `compilerOptions.typeRoots`. MeoCord builds from a copy of `tsconfig.json` in a temporary directory, and a relative `extends` or `files` entry in that copy pointed at files that are not there; a package in `extends`, such as `@tsconfig/node22/tsconfig.json`, could not be found from there either. The copy now carries absolute paths, with a package resolved from the project's `node_modules`. `typeRoots` is read from `compilerOptions`, where TypeScript declares it, and `include` and `exclude` are resolved even without `compilerOptions`.

- [#92](https://github.com/meocord/meocord/pull/92) [`16d9a59`](https://github.com/meocord/meocord/commit/16d9a59d47ca85b47a608498e8b01174342d7772) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `meocord build` no longer rewrites your `tsconfig.json`. When the file had comments or trailing commas, which TypeScript allows, the build "repaired" it and wrote the result back, deleting your comments, and the repair broke on a `//` inside a string such as `"$schema": "https://json.schemastore.org/tsconfig"`, failing the build. MeoCord now reads comments and trailing commas as TypeScript does, leaves strings alone, and only ever writes its own temporary copy. A `tsconfig.json` it cannot parse fails the build with the file and the fix named.

- [#74](https://github.com/meocord/meocord/pull/74) [`5f32513`](https://github.com/meocord/meocord/commit/5f32513e508e37679e3cb5d9762527f107ad3572) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Fix builds that run at the same time, such as CI jobs sharing a runner, failing with a JSON parse error in `modified-tsconfig.json`. Every build wrote its copy of the tsconfig to one fixed file in the system temp directory, so two builds could read each other's half-written file. Each build now writes to a directory of its own, removed when the build exits.

## 4.0.0

MeoCord 4 builds with Rsbuild instead of webpack, requires Node.js 22.13 and dotenv 18, and can
deploy a bot without `node_modules`. Most bots need two changes; see the
[migration guide](https://github.com/l7aromeo/meocord/blob/main/docs/MIGRATING.md).

### Major Changes

- [#22](https://github.com/l7aromeo/meocord/pull/22) [`4deb96f`](https://github.com/l7aromeo/meocord/commit/4deb96fd73f86a29c46b9bb080c13e6267246cb1) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Build with [Rsbuild](https://rsbuild.rs) instead of webpack. Production builds are several times
  faster, and webpack and its four loader and plugin packages are no longer installed with MeoCord.
  The output layout is unchanged: `dist/main.js`, and assets under `dist/assets/` with the same names.
  Production source maps now list sources as `../src/...` paths instead of `webpack://` URLs.

  **Breaking:** the `webpack` hook in `meocord.config.ts` is replaced by `rsbuild`, which receives
  Rsbuild's configuration. A config that still declares `webpack` stops the build with a message
  saying so. `MeoCordWebpackConfig` is removed; import `RsbuildConfig` from `meocord/interface`
  instead. The [migration guide](https://github.com/l7aromeo/meocord/blob/main/docs/MIGRATING.md#2-replace-the-webpack-hook-with-rsbuild) shows where each
  webpack setting goes.

- [#44](https://github.com/l7aromeo/meocord/pull/44) [`e48472e`](https://github.com/l7aromeo/meocord/commit/e48472e9ffee2f0371a7a2a71a4063e99ce61674) Thanks [@l7aromeo](https://github.com/l7aromeo)! - **Breaking:** `meocord/decorator` exports only the decorators. The routing helpers it also exported
  — `getCommandMap`, `getMessageHandlers`, `getReactionHandlers`, `getAutocompleteHandlers`,
  `findAmbiguousRoutes` and `PARAM_SEPARATOR` — are internal to MeoCord now. See the
  [migration guide](https://github.com/l7aromeo/meocord/blob/main/docs/MIGRATING.md#internal-helpers-are-no-longer-exported).

- [#19](https://github.com/l7aromeo/meocord/pull/19) [`204c7be`](https://github.com/l7aromeo/meocord/commit/204c7bec74886c931732cb771d9178b47fbec5e8) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Require dotenv 18. The `dotenv` peer dependency moves from `^17.4.2` to `^18.0.3`, so install
  `dotenv@18` alongside MeoCord 4. No application code changes — `import 'dotenv/config'` behaves
  the same. See the [migration guide](https://github.com/l7aromeo/meocord/blob/main/docs/MIGRATING.md#1-upgrade-dotenv-to-18).

- [#33](https://github.com/l7aromeo/meocord/pull/33) [`21b06ae`](https://github.com/l7aromeo/meocord/commit/21b06ae6810cfe203abadcadc6f7b7247c7b305b) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Require Node.js 22.13 or newer, up from 22.0. A built bot loads its compiled config with `require()`
  of an ES module. Node 22.12 runs that without a flag but still warns on every start and crashes on a
  config that throws; 22.13 is the first 22 release that does neither. Bun is unaffected. See the
  [migration guide](https://github.com/l7aromeo/meocord/blob/main/docs/MIGRATING.md#before-you-start-nodejs-2213).

- [#36](https://github.com/l7aromeo/meocord/pull/36) [`45e564e`](https://github.com/l7aromeo/meocord/commit/45e564e6baff17313037372ec56baa1711a3584c) Thanks [@l7aromeo](https://github.com/l7aromeo)! - **Breaking:** `app.start()` rejects when the login fails. It logged the error and resolved, so a bot
  with an invalid token went on to log "Application started" and exit with code 0, which Docker's
  `restart: on-failure`, systemd and CI all read as success. It now sets the exit code to 1 before
  rejecting, so a bot that fails to log in exits 1 with its entry point unchanged. See the
  [migration guide](https://github.com/l7aromeo/meocord/blob/main/docs/MIGRATING.md#4-build-and-start).

### Minor Changes

- [#22](https://github.com/l7aromeo/meocord/pull/22) [`4deb96f`](https://github.com/l7aromeo/meocord/commit/4deb96fd73f86a29c46b9bb080c13e6267246cb1) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Add `bundleDependencies`, which puts everything a bot needs inside `dist`, so it deploys without
  `node_modules` or an install step. Plain JavaScript dependencies are bundled into `main.js`. Native
  addons such as `sharp` are found while building and copied, with their platform binary, into
  `dist/node_modules` — nothing has to be listed. Only binaries for the platform building are copied,
  whichever package manager installed them.

  A build carrying native addons records its platform in `dist/meocord.platform.json`, and a bot
  started on another platform stops before going online with a message naming both. Build on the
  platform you deploy to. See
  [Self-contained builds](https://github.com/l7aromeo/meocord#self-contained-builds).

- [#47](https://github.com/l7aromeo/meocord/pull/47) [`9652436`](https://github.com/l7aromeo/meocord/commit/965243660323277827a64851f28da9cda2c2fe0c) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Add `resolveRoute` and `findRouteConflicts` to `meocord/testing`, for testing which handler a
  component's customId reaches. `resolveRoute(App, { type, customId })` gives the answer dispatch
  gives — across every controller the app registers, for that component type, most specific pattern
  first — as the controller, the handler method and its name, and the captured params, or `undefined`.
  `findRouteConflicts(App)` returns the pattern pairs that can match the same customId, which MeoCord
  otherwise only warns about at startup. Both read decorator metadata only, and dispatch runs on the
  same matcher.

### Patch Changes

- [#22](https://github.com/l7aromeo/meocord/pull/22) [`4deb96f`](https://github.com/l7aromeo/meocord/commit/4deb96fd73f86a29c46b9bb080c13e6267246cb1) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Read `meocord.config.ts` on every build. `meocord build` read the compiled `dist/meocord.config.mjs`
  left by the previous build, so a config edit took effect one build late, and the watcher's reload
  on a config change reloaded nothing.

- [#22](https://github.com/l7aromeo/meocord/pull/22) [`4deb96f`](https://github.com/l7aromeo/meocord/commit/4deb96fd73f86a29c46b9bb080c13e6267246cb1) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Start the bot with `bun --no-install` from `meocord start`. Without it, bun downloads any package it
  cannot find while the bot runs, which a bot deployed without `node_modules` would do in
  production. If you start `dist/main.js` with bun yourself, pass the flag too.

- [#37](https://github.com/l7aromeo/meocord/pull/37) [`a9452c2`](https://github.com/l7aromeo/meocord/commit/a9452c256beace70141bb87ed33c693d14064d14) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Type the CommonJS build as CommonJS. Every entry point's `require` condition resolved to the ESM
  declarations, so a CommonJS TypeScript project was told `meocord/core` is an ES module it cannot
  `require`, even with `skipLibCheck`. Each entry now ships `.d.cts` declarations for `require`, and
  `meocord/eslint` types its `module.exports` array as what `require` returns.

- [#33](https://github.com/l7aromeo/meocord/pull/33) [`21b06ae`](https://github.com/l7aromeo/meocord/commit/21b06ae6810cfe203abadcadc6f7b7247c7b305b) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Load the compiled config without a transpiler. A built bot reads `dist/meocord.config.mjs` with
  `require()` and no longer falls back to `meocord.config.ts` when it is missing, so jiti stays out of
  a bot bundled with `bundleDependencies`. `meocord build` fails when the config does not compile,
  instead of warning and producing a bot that cannot start.

- [#35](https://github.com/l7aromeo/meocord/pull/35) [`b93a771`](https://github.com/l7aromeo/meocord/commit/b93a771b19664345fec4222d5a2c29dcf5b31a0d) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Generate code that passes a new application's own `lint`. A generated guard failed `tsc` and ESLint
  — `GuardInterface` imported as a value, and an unused `context` parameter — and generated message and
  reaction controllers imported names they never used, which only the application's ESLint, run in the
  background after generating, removed. New applications also typecheck `meocord.config.ts`: the
  template's `tsconfig.json` includes it instead of excluding it, so a type error in the config fails
  `lint`, and editors resolve `paths` aliases imported there. `noEmit` stays on, so `tsc` writes nothing
  beside it.

- [#25](https://github.com/l7aromeo/meocord/pull/25) [`2179f85`](https://github.com/l7aromeo/meocord/commit/2179f85c2912d45e3fefbf996ca267c19a1a773c) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Stop `meocord generate` overwriting files. Slash, context-menu and primary entry point controllers
  all wrote one shared `builders/sample.builder.ts`, so generating a second controller replaced a
  builder you had already edited. Each controller now gets its own `builders/<name>.builder.ts`
  exporting `<Name>CommandBuilder`, and registers a command named after it — `admin/ban` registers
  `admin-ban` — rather than every one registering `sample-slash`. Generating a controller, service or
  guard refuses if any file it would write already exists.

- [#40](https://github.com/l7aromeo/meocord/pull/40) [`3629edd`](https://github.com/l7aromeo/meocord/commit/3629eddaf20bd0947d24e5582aa167b2c0ca0d47) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Lint `meocord.config.ts`. The shared ESLint config from `meocord/eslint` ignored it, so the config
  alone skipped the rules every other file follows — unused imports, formatting. It is linted like the
  rest now; the typecheck it already gets is unchanged.

- [#24](https://github.com/l7aromeo/meocord/pull/24) [`5e2a54b`](https://github.com/l7aromeo/meocord/commit/5e2a54b67a1f9f51c4c3a3e8cf51247de2ac2528) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Type `deleted` on `createMockMessage()`. The mock tracks and documents it, but it was missing from
  the type, so `message.deleted` did not compile.

- [#24](https://github.com/l7aromeo/meocord/pull/24) [`5e2a54b`](https://github.com/l7aromeo/meocord/commit/5e2a54b67a1f9f51c4c3a3e8cf51247de2ac2528) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Accept slash command builders that add options. `@CommandBuilder(CommandType.SLASH)` rejected
  `new SlashCommandBuilder().addStringOption(...)`, whose type narrows to
  `SlashCommandOptionsOnlyBuilder`, so the most common builder — one command with an option — did
  not compile.

- [#21](https://github.com/l7aromeo/meocord/pull/21) [`bebf116`](https://github.com/l7aromeo/meocord/commit/bebf1168466595546017a317b62acd3707ff2d1c) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Generate applications with current test tooling: vitest and `@vitest/coverage-istanbul` 5,
  `unplugin-swc` 2, and current eslint, prettier and typescript-eslint. A new application's
  `test:coverage` no longer fails on its decorated entry files.

## 4.0.0-beta.5

### Minor Changes

- [#47](https://github.com/l7aromeo/meocord/pull/47) [`9652436`](https://github.com/l7aromeo/meocord/commit/965243660323277827a64851f28da9cda2c2fe0c) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Add `resolveRoute` and `findRouteConflicts` to `meocord/testing`, for testing which handler a
  component's customId reaches. `resolveRoute(App, { type, customId })` gives the answer dispatch gives
  — across every controller the app registers, for that component type, most specific pattern first —
  as the controller, the handler method and its name, and the captured params, or `undefined`. `findRouteConflicts(App)` returns the
  pattern pairs that can match the same customId, which MeoCord otherwise only warns about at startup.
  Both read decorator metadata only, and dispatch runs on the same matcher.

## 4.0.0-beta.4

### Major Changes

- [#44](https://github.com/l7aromeo/meocord/pull/44) [`e48472e`](https://github.com/l7aromeo/meocord/commit/e48472e9ffee2f0371a7a2a71a4063e99ce61674) Thanks [@l7aromeo](https://github.com/l7aromeo)! - **Breaking:** `meocord/decorator` exports only the decorators. The routing helpers it also exported
  — `getCommandMap`, `getMessageHandlers`, `getReactionHandlers`, `getAutocompleteHandlers`,
  `findAmbiguousRoutes` and `PARAM_SEPARATOR` — are internal to MeoCord now. See the
  [migration guide](https://github.com/l7aromeo/meocord/blob/main/docs/MIGRATING.md#internal-helpers-are-no-longer-exported).

## 4.0.0-beta.3

### Patch Changes

- [#40](https://github.com/l7aromeo/meocord/pull/40) [`3629edd`](https://github.com/l7aromeo/meocord/commit/3629eddaf20bd0947d24e5582aa167b2c0ca0d47) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Lint `meocord.config.ts`. The shared ESLint config from `meocord/eslint` ignored it, so the config
  alone skipped the rules every other file follows — unused imports, formatting. It is linted like the
  rest now; the typecheck it already gets is unchanged.

- [#40](https://github.com/l7aromeo/meocord/pull/40) [`80b8302`](https://github.com/l7aromeo/meocord/commit/80b83021894ef8a964a12ac1610c2ec9b40f344e) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Exit with code 1 when the login fails, whatever the entry point does. `app.start()` now sets
  `process.exitCode = 1` before rejecting, so an existing `main.ts` whose `catch` only logs the error no
  longer exits 0 — no `process.exitCode = 1` needs adding to it, and new applications' `main.ts` no
  longer carries one.

## 4.0.0-beta.2

### Major Changes

- [#36](https://github.com/l7aromeo/meocord/pull/36) [`45e564e`](https://github.com/l7aromeo/meocord/commit/45e564e6baff17313037372ec56baa1711a3584c) Thanks [@l7aromeo](https://github.com/l7aromeo)! - **Breaking:** `app.start()` rejects when the login fails. It logged the error and resolved, so a bot
  with an invalid token went on to log "Application started" and exit with code 0, which Docker's
  `restart: on-failure`, systemd and CI all read as success. New applications' `main.ts` sets
  `process.exitCode = 1` when startup fails; add the same to an existing entry point's `catch`. See the
  [migration guide](https://github.com/l7aromeo/meocord/blob/main/docs/MIGRATING.md#4-build-and-start).

### Patch Changes

- [#37](https://github.com/l7aromeo/meocord/pull/37) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Type the CommonJS build as CommonJS. Every entry point's `require` condition resolved to the ESM
  declarations, so a CommonJS TypeScript project was told `meocord/core` is an ES module it cannot
  `require`, even with `skipLibCheck`. Each entry now ships `.d.cts` declarations for `require`, and
  `meocord/eslint` types its `module.exports` array as what `require` returns.

- [#35](https://github.com/l7aromeo/meocord/pull/35) [`b93a771`](https://github.com/l7aromeo/meocord/commit/b93a771b19664345fec4222d5a2c29dcf5b31a0d) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Generate code that passes a new application's own `lint`. A generated guard failed `tsc` and ESLint
  — `GuardInterface` imported as a value, and an unused `context` parameter — and generated message and
  reaction controllers imported names they never used, which only the application's ESLint, run in the
  background after generating, removed. New applications also typecheck `meocord.config.ts`: the
  template's `tsconfig.json` includes it instead of excluding it, so a type error in the config fails
  `lint`, and editors resolve `paths` aliases imported there. `noEmit` stays on, so `tsc` writes nothing
  beside it.

## 4.0.0-beta.1

### Major Changes

- [#33](https://github.com/l7aromeo/meocord/pull/33) [`21b06ae`](https://github.com/l7aromeo/meocord/commit/21b06ae6810cfe203abadcadc6f7b7247c7b305b) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Require Node.js 22.13 or newer, up from 22.0. A built bot loads its compiled config with `require()`
  of an ES module. Node 22.12 runs that without a flag but still warns on every start and crashes on a
  config that throws; 22.13 is the first 22 release that does neither. Bun is unaffected. See the
  [migration guide](https://github.com/l7aromeo/meocord/blob/main/docs/MIGRATING.md#before-you-start-nodejs-2213).

### Patch Changes

- [#33](https://github.com/l7aromeo/meocord/pull/33) [`21b06ae`](https://github.com/l7aromeo/meocord/commit/21b06ae6810cfe203abadcadc6f7b7247c7b305b) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Keep jiti out of bots built with `bundleDependencies`. A built bot loaded `dist/meocord.config.mjs`,
  already compiled JavaScript, through jiti, and the logger and the factory both reach that loader,
  so jiti was bundled into every bot: 190 KB, 89% of a minimal bot's `main.js`, and a
  `Critical dependency` warning on every build. The compiled config is now loaded with `require()`,
  and jiti is only used by the CLI to read `meocord.config.ts`. A minimal bot bundles to 22 KB.

  A built bot no longer falls back to reading `meocord.config.ts` when `dist/meocord.config.mjs` is
  missing, and `meocord build` now fails when the config does not compile, instead of warning and
  producing a bot that cannot start.

- [#31](https://github.com/l7aromeo/meocord/pull/31) [`f50bafc`](https://github.com/l7aromeo/meocord/commit/f50bafce5bcf04b555a7638fedeb6986cf7ea9d5) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Resolve asset imports to files under `dist` in development builds too. `meocord start --dev` gave
  `import logo from './logo.png'` the path `/assets/logo.png`, at the root of the filesystem, so a bot
  reading an imported font or image failed in development while production worked.

- [#32](https://github.com/l7aromeo/meocord/pull/32) [`72b228c`](https://github.com/l7aromeo/meocord/commit/72b228ceaca2dca33ed660aff0ec1bc2aa59bfc2) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Pack only the build platform's native binaries with `bundleDependencies`. Every installed platform
  package was copied into `dist/node_modules`, and bun installs both the glibc and the musl build on
  Linux, so a glibc build of a bot using sharp carried about 19 MB of musl binaries it could never
  load. A package whose `os`, `cpu` or `libc` does not match the platform building is now left out,
  whichever package manager installed it.

## 4.0.0-beta.0

### Major Changes

- [#22](https://github.com/l7aromeo/meocord/pull/22) [`4deb96f`](https://github.com/l7aromeo/meocord/commit/4deb96fd73f86a29c46b9bb080c13e6267246cb1) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Build with [Rsbuild](https://rsbuild.rs) instead of webpack. Production builds are several times
  faster, and webpack and its four loader and plugin packages are no longer installed with MeoCord.
  The output is unchanged: `dist/main.js`, assets under `dist/assets/` with the same names, and the
  same source maps.

  **Breaking:** the `webpack` hook in `meocord.config.ts` is replaced by `rsbuild`, which receives
  Rsbuild's configuration. A config that still declares `webpack` stops the build with a message
  saying so. `MeoCordWebpackConfig` is removed; import `RsbuildConfig` from `meocord/interface`
  instead. The [migration guide](https://github.com/l7aromeo/meocord/blob/main/docs/MIGRATING.md#2-replace-the-webpack-hook-with-rsbuild) shows where each
  webpack setting goes.

- [#19](https://github.com/l7aromeo/meocord/pull/19) [`204c7be`](https://github.com/l7aromeo/meocord/commit/204c7bec74886c931732cb771d9178b47fbec5e8) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Require dotenv 18. The `dotenv` peer dependency moves from `^17.4.2` to `^18.0.3`, so install
  `dotenv@18` alongside MeoCord 4. No application code changes — `import 'dotenv/config'` behaves
  the same. See the [migration guide](https://github.com/l7aromeo/meocord/blob/main/docs/MIGRATING.md#1-upgrade-dotenv-to-18).

### Minor Changes

- [#22](https://github.com/l7aromeo/meocord/pull/22) [`4deb96f`](https://github.com/l7aromeo/meocord/commit/4deb96fd73f86a29c46b9bb080c13e6267246cb1) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Add `bundleDependencies`, which puts everything a bot needs inside `dist`, so it deploys without
  `node_modules` or an install step. Plain JavaScript dependencies are bundled into `main.js`. Native
  addons such as `sharp` are found while building and copied, with their platform binary, into
  `dist/node_modules` — nothing has to be listed.

  A build carrying native addons records its platform in `dist/meocord.platform.json`, and a bot
  started on another platform stops before going online with a message naming both. Build on the
  platform you deploy to. See
  [Self-contained builds](https://github.com/l7aromeo/meocord#self-contained-builds).

### Patch Changes

- [#22](https://github.com/l7aromeo/meocord/pull/22) [`4deb96f`](https://github.com/l7aromeo/meocord/commit/4deb96fd73f86a29c46b9bb080c13e6267246cb1) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Read `meocord.config.ts` on every build. `meocord build` read the compiled `dist/meocord.config.mjs`
  left by the previous build, so a config edit took effect one build late, and the watcher's reload
  on a config change reloaded nothing.

- [#22](https://github.com/l7aromeo/meocord/pull/22) [`4deb96f`](https://github.com/l7aromeo/meocord/commit/4deb96fd73f86a29c46b9bb080c13e6267246cb1) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Start the bot with `bun --no-install` from `meocord start`. Without it, bun downloads any package it
  cannot find while the bot runs, which a bot deployed without `node_modules` would do in
  production. If you start `dist/main.js` with bun yourself, pass the flag too.

- [#25](https://github.com/l7aromeo/meocord/pull/25) [`2179f85`](https://github.com/l7aromeo/meocord/commit/2179f85c2912d45e3fefbf996ca267c19a1a773c) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Stop `meocord generate` overwriting files. Slash, context-menu and primary entry point controllers
  all wrote one shared `builders/sample.builder.ts`, so generating a second controller replaced a
  builder you had already edited. Each controller now gets its own `builders/<name>.builder.ts`
  exporting `<Name>CommandBuilder`, and registers a command named after it — `admin/ban` registers
  `admin-ban` — rather than every one registering `sample-slash`. Generating a controller, service or
  guard refuses if any file it would write already exists.

- [#24](https://github.com/l7aromeo/meocord/pull/24) [`5e2a54b`](https://github.com/l7aromeo/meocord/commit/5e2a54b67a1f9f51c4c3a3e8cf51247de2ac2528) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Type `deleted` on `createMockMessage()`. The mock tracks and documents it, but it was missing from
  the type, so `message.deleted` did not compile.

- [#24](https://github.com/l7aromeo/meocord/pull/24) [`5e2a54b`](https://github.com/l7aromeo/meocord/commit/5e2a54b67a1f9f51c4c3a3e8cf51247de2ac2528) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Accept slash command builders that add options. `@CommandBuilder(CommandType.SLASH)` rejected
  `new SlashCommandBuilder().addStringOption(...)`, whose type narrows to
  `SlashCommandOptionsOnlyBuilder`, so the most common builder — one command with an option — did
  not compile.

- [#21](https://github.com/l7aromeo/meocord/pull/21) [`bebf116`](https://github.com/l7aromeo/meocord/commit/bebf1168466595546017a317b62acd3707ff2d1c) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Generate applications with current test tooling: vitest and `@vitest/coverage-istanbul` 5,
  `unplugin-swc` 2, and current eslint, prettier and typescript-eslint. A new application's
  `test:coverage` no longer fails on its decorated entry files.

## 3.2.2

### Patch Changes

- [#13](https://github.com/l7aromeo/meocord/pull/13) [`f8a6b15`](https://github.com/l7aromeo/meocord/commit/f8a6b156e8d22abf88443ba77c605d6d47991ab4) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Update the shipped dependencies — `@clack/prompts` 1.8.0, `@swc/core` 1.16.2, and `webpack`
  5.110.3 — and state the copyright as `2025-present`, including in the notice the CLI prints
  under `--license` and in its help banner.
