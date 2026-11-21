# meocord

## 4.3.2

### Patch Changes

- [#1097](https://github.com/meocord/meocord/pull/1097) [`82f1144`](https://github.com/meocord/meocord/commit/82f11442156ea9e670b47ae28c8ff10f86279de6) Thanks [@l7aromeo](https://github.com/l7aromeo)! - When Discord refuses `@Defer`'s acknowledgement, or `respond(interaction).lock()`'s, because something else already answered the interaction (40060), the message is no longer locked. That other answer may be a reply, and the lock's two edits went to it: first the loading view with the message's controls disabled, then a copy of the message, so the reply's own content was lost. Now nothing edits it, and an error from the handler follows up privately as before.

  A test that rejects `deferUpdate` with `createDiscordError(40060)` under `@Defer` now sees no `editReply` from the lock and its restore. Locking after the app's own `interaction.deferUpdate()` is unchanged.

- [#1093](https://github.com/meocord/meocord/pull/1093) [`295ade3`](https://github.com/meocord/meocord/commit/295ade3ec4a3f0da32e058f520d7bfa3f9b48845) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `meocord/eslint`'s packages are no longer listed in `meocord`'s `peerDependencies`. Listing them there made npm and Yarn 1 install the lint toolchain (about 115 packages) in production for a bot that lints with `meocord/eslint`, as every bot from `meocord create` does: `npm ci --omit=dev` installed it, and `npm audit --omit=dev` reported its advisories. They stay in `peerDependenciesMeta` as optional peers of any version, which pnpm, Bun and Yarn 2+ read as before. For `npm ci --omit=dev` to leave the toolchain out, update the bot's lockfile to this version with `npm install` or `npm update meocord`. Bun's production installs (`bun install --production`) still include the toolchain: Bun keeps an optional peer in a production install when the bot has it as a devDependency. `meocord/eslint` works as before. See [ESLint](https://meocord.dev/docs/4.3/eslint#adopting-it-by-hand).

- [#1091](https://github.com/meocord/meocord/pull/1091) [`0e11e57`](https://github.com/meocord/meocord/commit/0e11e5769891ef3d544e5e817842843823780635) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `meocord start --prod` and `meocord register` no longer load the bundler. A production install without optional dependencies, such as `npm ci --omit=dev --omit=optional`, can start the bot with `meocord start --prod`; before, it stopped with "Cannot find native binding". Without the bundler, `start --prod` also starts a little sooner and uses less memory, about 13 MB less on our test machine. The commands that build (`build`, `start` without `--prod`, `start --build`, `register --build`) still need the bundler and its native binding. See [Deployment](https://meocord.dev/docs/4.3/deployment#example).

- [#1097](https://github.com/meocord/meocord/pull/1097) [`39630af`](https://github.com/meocord/meocord/commit/39630afbaca5bd233acd4184fcda91c72e2583ef) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `respond(interaction).lock()` after the handler's own `interaction.deferReply()` no longer edits that deferred reply. The lock and the next `send()` used to turn the reply into a copy of the component's message, loading view and controls included, while the message itself stayed unlocked. Now the lock draws nothing once a reply or a deferred reply is the answer. After the handler's own `interaction.deferUpdate()` it locks the message as before.

  For tests: a default-mode mock interaction's `ephemeral` now reads `null` after the mock's `update()` or `deferUpdate()`, or after a test marks the interaction `deferred` itself, as discord.js does, where it read `false`, with a placeholder warning after the mock's own answers. A test asserting `toBe(false)` there now fails; `toBeFalsy()` still passes. This is an exception to default mocks staying as they were: `lock()` reads `ephemeral` to tell an update from a reply, so the mock has to read as discord.js does for a test to see the lock it would see in production. Before any answer, after `reply()` or `deferReply()`, and with `useStrictMocks()`, nothing changes.

- [#1089](https://github.com/meocord/meocord/pull/1089) [`411759c`](https://github.com/meocord/meocord/commit/411759c5d2382efb667a0f39eee93280e75252eb) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A call is themed for the server its event names when the server is given as itself, after another value, or as the new value of an update whose old value was not cached. `@On` and `@Once` handlers for `guildCreate`, `guildUpdate`, `guildDelete` and the other events given a `Guild`, events given a server or a channel after a collection (`guildMembersChunk`, `messageDeleteBulk`, …), `threadMemberUpdate`, poll votes, and updates such as `presenceUpdate` with no cached old value now get `themeFor.guild`'s theme, as do functions `bindTheme` wraps when called with them. Before, they ran with no server's theme, and a bound function kept the theme of the call that bound it. A value from a direct message names no server, whether its `guildId` or its message's `guildId` is `null` or it is a direct message's channel or poll, so a later argument does not theme the call. See [Theming](https://meocord.dev/docs/4.3/theming#collectors-and-listeners).

  An update whose old value was not cached also gets its new value's user, as it does when the old value is cached: a `presenceUpdate` is themed for its user's `themeFor.user` theme.

## 4.3.1

### Patch Changes

- [#1082](https://github.com/meocord/meocord/pull/1082) [`6cc04cf`](https://github.com/meocord/meocord/commit/6cc04cfeb03c5e50c53893ef9f7a6ef650a75a5d) Thanks [@l7aromeo](https://github.com/l7aromeo)! - An error on a component on a private message, or on a modal submitted from one, is added to that message only when MeoCord answered the interaction on that message, with an update or a deferred update. Otherwise it is sent as a private follow-up. Before, an error after the app's own `interaction.reply()`, after a follow-up that took the place of a deleted answer, or after Discord reported the interaction already answered, replaced that other response with the message's components and the error. The same applies to putting a select menu back: a pick is put back with an edit only after MeoCord deferred it, never after the handler's own `interaction.deferReply()`.

  A handler that answers with discord.js directly, through `interaction.update()` or `interaction.deferUpdate()`, and then fails, now gets the error as a private follow-up instead of added to the message. A test that checks the calls for such a handler now sees `followUp` where it saw `editReply`.

- [#1082](https://github.com/meocord/meocord/pull/1082) [`eb2f56b`](https://github.com/meocord/meocord/commit/eb2f56b22c0feec9ef1bfc229913e1c35470affc) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A select menu no longer keeps showing a pick that MeoCord answers with an error. Such a pick is one refused by a guard such as `OwnerGuard`, by a cooldown or by invalid input, one no route takes, or one whose handler throws. MeoCord now answers it with an update that sets no field, which puts the menu back as it was before the pick in that user's client, then sends the error as a private follow-up. Before, it sent only the private reply, and the menu went on showing the refused option until the message was drawn again. The message itself is not rewritten: it keeps every edit made to it and shows no "(edited)", and nobody else sees a change. Under `@Defer`, a pick acknowledged and not edited since is put back with an edit that sets no field; one on a private message gets the error added to that message, as before. A filter's `respond(interaction).error()` answers a pick the same way. Buttons and modals are unchanged.

  A test that checks the Discord calls for a refused pick now sees `update` with `{}`, then `followUp`, where it saw `reply`. Under `@Defer` it sees `editReply` with `{}` between `deferUpdate` and `followUp`.

  An app that worked around this with a guard of its own can drop the workaround. Such a guard sends the message's components back before refusing, as `respond(interaction).edit({ components: interaction.message.components })`. Use `OwnerGuard`, or throw `GuardDeniedError`, on its own instead. Sending the components back could also undo a change made to the message after the menu was drawn. See [Guards](https://meocord.dev/docs/4.3/guards).

## 4.3.0

### Minor Changes

- [#975](https://github.com/meocord/meocord/pull/975) [`906780b`](https://github.com/meocord/meocord/commit/906780b9e8c05d44e282f54053e892dbf428cfaf) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `@MeoCord({ answerDenied: true })` answers a guard's `false` on an interaction as if the guard had thrown `GuardDeniedError`. A command, context menu, component or modal a guard denies is told privately "You can't use this." in the user's language, from `meocord.guard.denied`, which an app's catalogs translate; until now a denied command got Discord's "The application did not respond". The denial takes a thrown one's path: a filter catching `GuardDeniedError` sees it and can answer otherwise, observers get the outcome `'denied'` with `deniedBy` and the error, and a call with `@Defer` is answered into its deferral. Autocomplete still closes its menu, an event handler still skips the event, and a message command stays silent, since a `false` there is often a filter. A guard that throws its own `GuardDeniedError` keeps its words. In a testing module built from an app that sets the option, `invoke` rejects with that `GuardDeniedError` for a guard's `false` and sends nothing, as it does for a thrown denial, while `dispatch` answers it as the bot does. Nothing changes until an app sets the option. See https://meocord.dev/docs/4.3/guards.

- [#980](https://github.com/meocord/meocord/pull/980) [`0510d95`](https://github.com/meocord/meocord/commit/0510d957c5f807cb720c6542881e9c2cc94fa8a5) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `bindTheme` now runs each call in the theme of the member and server it answers. A function it wraps rebuilds the theme for every call whose arguments name a server or a user, as a handler's call is themed (an interaction, a message, a reaction, a member): MeoCord's defaults and the app's theme, the `@UseTheme` layers of the handler that bound it, then `themeFor`'s layers for that call's server and user, in the order a handler's call has them. A collector's `collect` callback answers each member who clicks in their own theme, and a `client.on(...)` listener bound in one server's call answers every other server in that server's theme, where both used the theme of the member whose call bound them.

  A theme `themeFor` is still looking up replaces the handler's once found, so the wrapped function stays synchronous: `respond()` waits for it, and `useTheme()` reads the handler's theme until then. A call whose arguments name neither, such as a collector's `end`, runs in the whole theme of the call that bound it, as before. Once a bot's stop or a testing module's `close()` has ended its shutdown, a wrapped function asks no `themeFor` resolver: a call whose arguments name a server or a user runs in the theme of the handler that bound it, and nothing is logged for the lookup. An app without `themeFor` sees no change. See [Theming](https://meocord.dev/docs/4.3/theming#collectors-and-listeners).

- [#979](https://github.com/meocord/meocord/pull/979) [`1789503`](https://github.com/meocord/meocord/commit/1789503db4590eef28769fe9eae07171ed9bcb3d) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Under Bun, what the runtime prints itself names your source, as under Node: `console.error(error)` and any other inspection of an error, an uncaught error, and a rejection nothing handles. `sourceMappedStacks` mapped only `error.stack`, so a crash, the trace most worth reading, showed positions in `dist/main.js`.

  When the bundle maps its stacks (`sourceMappedStacks` is not `false` and the build wrote its source map), a bot running on Bun gets:

  - an inspection hook on `Error.prototype` (`Symbol.for('nodejs.util.inspect.custom')`), which inspects an error with its mapped stack and keeps its own properties, such as a `DiscordAPIError`'s `code`, and its `cause`;
  - an `uncaughtException` and an `unhandledRejection` listener on `process`, which print the error with its mapped stack and end the process as Bun would: code 1 for an uncaught error, and for a rejection as Bun's `--unhandled-rejections` mode decides. Without the flag a rejection ends the process; under `=throw` it is raised as an uncaught error, which your own `uncaughtException` listener gets, or which ends the process when there is none.

  What Bun prints changes with it. `console.error(error)` and a crash print the error in Node's inspection format, `Error: message` followed by `at` lines naming `src/` files and any own properties in braces, where Bun printed its own layout: the source line excerpt above the error and, for a crash, the `Bun v…` line below it are gone. An error whose `stack` is no string of its own, such as a `DOMException` or one with a `stack` getter, is printed by Bun's own formatter, so a crash still shows its name and message. Under `--unhandled-rejections=warn`, Bun prints its own warning for a rejection, which keeps the bundle's positions. Set `sourceMappedStacks: false` to keep Bun's own output.

  `process.listenerCount()` for each of the two events is one higher. An application that listens for either event itself, before or after MeoCord, keeps the error and the exit, also with a listener that removes itself as it runs, as `process.once` adds one: MeoCord's listener does nothing while another listener is there. The exception is a listener that runs ahead of MeoCord's and removes itself, as one added after MeoCord's with `process.prependOnceListener` does: it is gone by the time MeoCord's listener runs, so MeoCord also reports the error and exits 1. Under Node nothing changes. See [Configuration](https://meocord.dev/docs/4.3/configuration).

- [#993](https://github.com/meocord/meocord/pull/993) [`264b19d`](https://github.com/meocord/meocord/commit/264b19db0a119f318eec78763148d01e7034fff8) Thanks [@l7aromeo](https://github.com/l7aromeo)! - MeoCord's CommonJS build bundles its ES-module-only dependencies, `inversify` (with its `@inversifyjs/*` packages) and `chalk`, so `require('meocord/...')` loads nothing that ships only as an ES module. jest, which runs tests as CommonJS, now loads `meocord/testing` without Node's VM modules: drop `NODE_OPTIONS=--experimental-vm-modules` from a jest setup that added it for MeoCord. With the flag left in, jest runs as before. The ES module build imports both packages from `node_modules` as before. A process that loads both builds runs two copies of `inversify` and of `chalk`: the one bundled into the CommonJS build and the one in `node_modules` that the ES module build imports. The two builds' `Logger` writes the same output under each colour setting. With them, and with the rest of 4.3, `dist/cjs` is 1765 KB, where 4.2.3's was 1227 KB, and THIRD_PARTY_NOTICES.md carries the bundled packages' licenses. See https://meocord.dev/docs/4.3/testing.

- [#976](https://github.com/meocord/meocord/pull/976) [`77d534b`](https://github.com/meocord/meocord/commit/77d534bfc76eedb5f1e9c900649ff715e9bb03e9) Thanks [@l7aromeo](https://github.com/l7aromeo)! - New `commandMention(path, target)` in `meocord/common` gives a clickable mention of one of your slash commands, a subcommand or a grouped subcommand, such as `</settings channel:1234567890123456789>`, so a help reply or an error can point at the command to run:

  ```ts
  await respond(interaction).send(`Set a channel first with ${await commandMention('settings channel', interaction)}.`)
  ```

  `target` is the interaction, message, guild or client the mention is shown with. It looks the command up where the reader can use it: the target's guild first, then the global commands. The IDs come from the bot's own registration, or from one request per scope on its first mention, listed again when no scope holds it, so it works in a shard, with `commands.register: false`, and for commands `meocord register` sent. A path the app doesn't declare is a `RangeError`; a command that isn't registered where the reader is, or a mention before the bot is ready, is an `Error` that says what to do. A scope whose listing fails, such as a guild the bot lost access to, doesn't stop a mention the global scope resolves; if none does, the `Error` names the failure.

  In tests, a testing module answers from the commands its controllers declare, with a fixed ID per command and no request; `MeoCordTestingModule.create({ … }).overrideCommandId(name, id)` sets one. See [Formatting](https://meocord.dev/docs/4.3/formatting).

- [#978](https://github.com/meocord/meocord/pull/978) [`4d52db9`](https://github.com/meocord/meocord/commit/4d52db9d611b7759ac1184d1d85b674a3536f5e4) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `meocord/common` exports `formatDuration(ms, target?, options?)`, which writes a length of time for people: `formatDuration(3_900_000)` is `1h 5m`, and `{ style: 'long' }` gives `1 hour, 5 minutes`. Given an interaction or a message, it writes in that user's or server's language through your app's translator; given a `Locale`, through `options.t`. `units`, `largest`, `smallest` and `round` choose what it shows, and `{ style: 'param' }` writes `1h30m`, which a `{x:duration}` param reads back, for a value up to `Number.MAX_SAFE_INTEGER` milliseconds. See [Formatting](https://meocord.dev/docs/4.3/formatting).

  Its unit words are new MeoCord texts in a `meocord.duration` group, the first of MeoCord's texts with plural forms, which an app's catalog translates like the others, with every plural form its language needs. `defineCatalog` refuses at compile time a translation of one of them without its `other` form, with a form that isn't a text, or with a key that is no plural category. `expectCompleteCatalog` now reports a translation of MeoCord's own plural texts that lacks a form its language needs, such as `few` in Russian, or that isn't a plural, `{}` included. See [Localisation](https://meocord.dev/docs/4.3/localisation).

  A plural in a catalog with a form that isn't a text, as a JSON catalog may hold, reads as missing, so the next locale's catalog answers; translating it threw a `TypeError`.

  `cooldownMessage` writes its wait with `formatDuration`, and its output is unchanged for every finite wait. A refusal whose wait is no finite number, as a custom `CooldownStore` may answer, now tells the caller "Slow down: try again later.", a new MeoCord text `meocord.cooldown.later` that an app's catalog translates, where they were shown a timestamp Discord couldn't display; `cooldownMessage` gives the same text where it wrote `NaNd NaNh`.

- [#978](https://github.com/meocord/meocord/pull/978) [`43396b2`](https://github.com/meocord/meocord/commit/43396b2efe4508e1de46972a28235197cbd19bcc) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `meocord/common` exports `permissionNames(permissions, target?, options?)`, which names permissions as a server owner reads them in Discord's role settings: `permissionNames(['ManageMessages', 'BanMembers'])` is `['Ban Members', 'Manage Messages']`, in bit order, and `{ join: 'and' }` gives `Ban Members and Manage Messages`, joined as a list in the labels' language. The labels are Discord's own wording, commas included, such as `Kick, Approve, and Reject Members`. Given an interaction or a message, it names them in that user's or server's language through your app's translator; given a `Locale`, through `options.t`. A bit with two flag names, such as `1 << 30`, gives one label; a bit with no label gives its flag name, and a bit discord.js doesn't name gives `Unknown permission (1 << n)`. See [Formatting](https://meocord.dev/docs/4.3/formatting).

  The labels are new MeoCord texts in a `meocord.permissions` group, by flag name, which an app's catalog translates like the others. See [Localisation](https://meocord.dev/docs/4.3/localisation).

- [#978](https://github.com/meocord/meocord/pull/978) [`768018f`](https://github.com/meocord/meocord/commit/768018f8f95498273a15893f90fe1208fa409a9b) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `meocord/common` exports discord.js's formatters under their own names, so a bot imports its formatting from one place: `userMention`, `channelMention`, `time` with `TimestampStyles`, `bold`, `codeBlock`, `escapeMarkdown` and the rest, 44 functions and constants and 4 types. They are your own discord.js's functions, not copies: `userMention` from `meocord/common` is `userMention` from `discord.js`, so code that imports them from discord.js keeps working, and their documentation is discord.js's. `version` and the deprecated `underscore` aren't exported. A new app's sample button replies with `userMention(ownerId)`. See [Formatting](https://meocord.dev/docs/4.3/formatting).

- [#978](https://github.com/meocord/meocord/pull/978) [`7683c01`](https://github.com/meocord/meocord/commit/7683c014a613a5374bb8dc8d041b4117eefdbcf7) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `meocord/common` exports `splitMessage`, `truncate` and `DiscordLimits` for fitting text to what Discord accepts. `splitMessage(text)` splits text into messages of at most 2000 characters, or the `max` you give it: at line ends, a longer line at its last whitespace, never through an emoji or an accented letter. It reads code as Discord does, and closes code cut across messages at the end of one and reopens it in the next, a code block with its language and inline code with its own backticks, so each message shows its part of the text as the whole text does. `truncate(text, max)` shortens text to `max` characters with an ellipsis, closing code it cuts open. `DiscordLimits` names Discord's length limits, such as `DiscordLimits.content` and `DiscordLimits.embedDescription`. See [Formatting](https://meocord.dev/docs/4.3/formatting).

  The help reply, MeoCord's own and a `presenter.messageHelp` string, splits with `splitMessage`. It splits as before, with these differences: a code block or inline code cut across messages is closed and reopened rather than cut through, no cut parts an escape from the character it escapes or leaves a backtick to pair with another in its message, a line longer than a message breaks at its last whitespace rather than at its last character, dropping the whitespace there, and a CR before a line end is no longer left at the end of a message. See the [upgrade guide](https://meocord.dev/docs/4.3/migrating#help-reply-split).

- [#1006](https://github.com/meocord/meocord/pull/1006) [`7a633ff`](https://github.com/meocord/meocord/commit/7a633ff0edddb79263cdd97dda34fa6035d2f491) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Two changes the next major version (5.0) makes at compile time are now announced:

  - A context menu handler that declares a second parameter is named in a startup warning, and by a testing module as it compiles. A context menu command has no options, so that argument is always `{}`; remove it. In 5.0 such a handler fails to compile. The check reads the method's parameter count, so a second parameter with a default value, or a rest parameter, goes unnamed. See [Context menus](https://meocord.dev/docs/4.3/context-menus).
  - `@Autocomplete<T>(…)`'s type argument is deprecated, and your editor strikes it through. It did nothing: the handler's return type is inferred. Write `@Autocomplete(…)`; in 5.0 the type argument fails to compile. See [Autocomplete](https://meocord.dev/docs/4.3/autocomplete).

- [#977](https://github.com/meocord/meocord/pull/977) [`d8e80b3`](https://github.com/meocord/meocord/commit/d8e80b3902890d96d7d99bcafb907a1953ddc7c5) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A testing module can answer an event handler's refusals as the bot does. With `eventFallback: true` in `MeoCordTestingModule.create()` or `fromApp()`, `emit` runs the bot's own event fallback: a guard's `GuardDeniedError` skips the event and the handler isn't counted as run, and a `UserError` is answered as a reply to the newest message among the event's arguments, with the app's presenter and `replyEmoji`. Neither rejects `emit`; any other error still does. The option applies to `emit` alone, not to `invoke` of an `@On` handler. With the option, `emit` gives each event argument's client the module's presenter, theme and translator without strict mocks too, so the reply is drawn as the bot draws it. A test can now check the reply a member gets:

  ```ts
  const module = MeoCordTestingModule.fromApp(App, { eventFallback: true }).compile()
  const message = createMockMessage({ content: 'hello' })
  await module.emit('messageCreate', message)
  expect(message.reply).toHaveBeenCalled()
  ```

  Without the option `emit` rejects with both errors as before, and the first time it does, it logs one warning for the run: the next major version (5.0) answers them as the bot does ([#964](https://github.com/meocord/meocord/issues/964)). Set `eventFallback: false` to keep the rejection without the warning. See [Invoke and dispatch](https://meocord.dev/docs/4.3/invoke-and-dispatch).

- [#984](https://github.com/meocord/meocord/pull/984) [`85314bc`](https://github.com/meocord/meocord/commit/85314bc292b20e364beb283fb415688e8c229f6b) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `meocord generate controller` and `meocord generate observer` now add the class they write to `src/app.ts`: its import after your last import, and its entry in `@MeoCord({ controllers })` or `@MeoCord({ observers })`, adding `observers` when the options have none. A controller or observer takes no part until it is listed, and the step was easy to miss. The edit is made with your project's own `typescript` and inserts only those lines, following the list's layout, indentation and trailing comma; nothing else in the file changes. When your project has ESLint, found from its root as Node finds packages, including one a workspace keeps in a parent folder, the edited file is linted with it, with no fixing, as your app's lint runs it; an edit that would bring an error the file didn't have, such as an import a rule forbids or a line past Prettier's print width, is undone, and the file is left as it was, its modification time included. The file is written in place, as an editor saves it: its mode, owner and links stay, a symlinked `src/app.ts` edits its target, and one you can't write is refused. Because a typed ESLint config lints the file on disk, the edit is there while it is checked, so `start --dev` rebuilds twice for an edit that is undone, and three times for one kept in a file that already had lint errors. Ctrl+C, or a SIGTERM outside Windows, while the edit is being checked puts the file back first. When ESLint is missing, can't run or doesn't finish, the class is listed and `generate` says it went unchecked and why. Pass `--skip-app` to keep the old behaviour, which leaves `src/app.ts` alone and prints what to add.

  When the class can't be placed safely, `generate` writes its files, warns why, prints the two lines to add and changes nothing in `src/app.ts`: when the file or its `@MeoCord({ … })` is missing; the list is not an array written in place (a variable, an import or a call) or holds a spread; the options have a spread or a computed key that may already hold the list; the class's name is already taken in `src/app.ts`, by a type-only import, an import from another file or a declaration of its own; the edit would fail your lint; or the project's `typescript` can't be loaded or has no compiler API on its main entry, as with TypeScript 7. A class already imported and listed is left alone. Other kinds, such as services and guards, are used by naming them in code and keep printing their hint. ESLint gets 60 seconds across the runs `generate` makes, including the one that formats the files it writes: a run still going then is stopped, and killed if it ignores the request, no further run starts, and a warning says the files went unformatted or the edit unchecked, so a config that never finishes no longer holds `generate` for good. Its report is read from a file of its own, so a config that prints does not leave the edit unchecked. See [CLI](https://meocord.dev/docs/4.3/cli).

- [#975](https://github.com/meocord/meocord/pull/975) [`0630ee4`](https://github.com/meocord/meocord/commit/0630ee4f675a345825534fd26aa3469aa28dd12c) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `@MeoCord({ globalStagesOnEvents: false })` keeps the app's global guards and interceptors that declare no `types` from running before `@On` and `@Once` handlers. They still run for commands, components, modals, message commands, reactions and autocomplete, so a global blocklist or maintenance guard keeps covering message commands. A stage that declares `types` keeps exactly what it declares, `'event'` included; the guards and interceptors a controller or a handler names, and global exception filters, are unaffected. The default stays `true` in 4.3 and becomes `false` in the next major version (5.0), as [meocord#502](https://github.com/meocord/meocord/issues/502) plans.

  The startup line that named each such stage is now a warning, once per stage, shown only when the app has event handlers and leaves the option unset. To silence it, declare `@Guard({ types: [...] })` or `@Interceptor({ types: [...] })` on the stage, or set `globalStagesOnEvents` to `true` to keep today's behaviour or to `false` to take 5.0's now. See https://meocord.dev/docs/4.3/guards.

- [#1004](https://github.com/meocord/meocord/pull/1004) [`8c63674`](https://github.com/meocord/meocord/commit/8c636741b4b6157e6fc9b6c2fc875751f0bd389f) Thanks [@l7aromeo](https://github.com/l7aromeo)! - The built-in help reads what joins its lists from two new MeoCord texts: `meocord.help.listJoiner`, a comma and a space, joins a command's aliases, and `meocord.help.paramJoiner`, a middle dot with a space on each side, its params. A catalog that translates `meocord.help` can write them as its language writes a list, such as `、` in Chinese or Japanese. A catalog without them shows the help as before. `expectCompleteCatalog(t, { meocord: true })` lists both as missing in a locale that doesn't translate them. See [Localisation](https://meocord.dev/docs/4.3/localisation).

- [#977](https://github.com/meocord/meocord/pull/977) [`5dd3eaf`](https://github.com/meocord/meocord/commit/5dd3eaffad1c5e4a63708a8680515218e3415156) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `inspectHandler()` reports a handler's `@Defer` as `defer`: the options it runs with, with their defaults filled in (`ephemeral: false`, `suppressNotifications: false`, `disable: 'all'`, `mode: 'eager'`, and `after: 1500` for `mode: 'auto'`), or `undefined` without one. A `@Defer` inherited from the method a handler overrides is reported as the bot applies it. A test can check that a command defers privately without dispatching it:

  ```ts
  expect(inspectHandler(PingController, 'ping').defer).toEqual({
    ephemeral: true,
    suppressNotifications: false,
    disable: 'all',
    mode: 'eager',
  })
  ```

  `toEqual` on a whole inspection doesn't compare `defer`, so existing assertions hold. See [Invoke and dispatch](https://meocord.dev/docs/4.3/invoke-and-dispatch).

- [#1004](https://github.com/meocord/meocord/pull/1004) [`7046f51`](https://github.com/meocord/meocord/commit/7046f516e7e13710f104e222f6362d4c51b1824e) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `t.localizations(key, params)` takes a message with `{params}` and fills them into each locale's translation, where that translation places them, so descriptions that differ by one word need one catalog key, not one per word. The params are typed from the default message, as `t()`'s are. A value is a word or a number, used in every locale, or a function of the locale for a value that is itself translated: `t.localizations('lookup.user', { mode: locale => t.locale(locale)('modes.chaos') })`. The function is called once for each locale whose message uses it. A value, static or from a function, is used as written: a `{param}` in it stays as text, as `t()` leaves it. A translator typed `Translator<any>`, or by hand with messages typed `string` (a JSON file's shape), takes any params for such a message. A param the default message takes and `params` leave out, or give as `undefined`, throws, naming each one. `t.localizations(key)` without params is unchanged; for a message that takes params, its error now names the params to give. `ParamLocalizationKey`, `LocalizationParam` and `LocalizationParams` are exported from `meocord/common`, to type a helper that takes such a key or builds its params before passing them on. On a `Translator` without its catalog type, `t.localizations(key, params)` and `ParamLocalizationKey` give the same "This Translator has no catalog type" error as its other methods. See [Localisation](https://meocord.dev/docs/4.3/localisation).

- [#1014](https://github.com/meocord/meocord/pull/1014) [`c86a086`](https://github.com/meocord/meocord/commit/c86a08677d395bb3fb15f39a63f8ab42792175e6) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Under `useStrictMocks()`, a mock answers a property its discord.js class does not have as discord.js does: it reads `undefined` and is not `in` the mock, so `message.isRepliable?.()` gives `undefined` and `if (value.guild)` is false for a class without a `guild`, as on a bot. `in` is true for a field the class sets on its instances, such as `'content' in message`; the fields are read from the source of the discord.js the application installed. A property a test gives or assigns, one the class has, and a mock of an app's own subclass answer as before. Without `useStrictMocks()` a mock keeps its placeholder, and the first read of such a property by an app's or a test's code logs one warning for the run, naming the property, its class and what strict mocks answer; MeoCord's own reads and the discord.js code a mock runs stay quiet. The next major version (5.0) answers `undefined` without the call. See [Mocks](https://meocord.dev/docs/4.3/mocks).

- [#977](https://github.com/meocord/meocord/pull/977) [`de3e228`](https://github.com/meocord/meocord/commit/de3e22897ba723a01f465d7c0cba0ef649a1f21d) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Under `useStrictMocks()`, `createMockClient()` has a working emitter, so a test can attach a collector-style listener to the mock client and see what depends on it:

  - `on()`, `once()`, `off()`, `emit()`, `listeners()`, `listenerCount()` and the emitter's other methods stay mock functions that record each call, and call through to discord.js's, so `client.on.mock.calls` and `toHaveBeenCalledWith` work as before and a test can still set its own behaviour. `client.on(...)` returns the client instead of `undefined`, `listeners()` and `listenerCount()` answer, and `emit()` reaches every listener attached. discord.js's own `InteractionCollector` made on the client works, filtered by a message, in a server or a direct message, by a response, as `createMessageComponentCollector()` builds one, by a channel, a server or a component type, and it ends when its message, channel or server is deleted. For that, a message an interaction sends names it in `interactionMetadata`, as Discord's do, and a command's `message` and a message's raw `channel_id` and `guild_id` read `undefined`, as on discord.js's classes, where they read a placeholder. A strict test that read one of those, or a member of the placeholder, now gets `undefined`: a command's `interaction.message.id` throws a `TypeError`, and `message.guild_id` is `undefined`. An interaction's `authorizingIntegrationOwners` is discord.js's `AuthorizingIntegrationOwners` for an app installed to a server, keyed to the interaction's server or `"0"` in a direct message with the bot, as Discord sends it, where it was the mock's placeholder object; the message's `interactionMetadata` holds the same owners. With `themeFor`, a call in a direct message looks no server up, so a test that expected the guild resolver to be asked for a mock message's generated server there sees no call.
  - `module.dispatch()` leaves a component or modal no route takes to the mock client's `interactionCreate` listeners, as the bot leaves it to a collector: it delivers the interaction to them, in the order they were attached, and answers "no handler matched" only if none answered. It doesn't wait 1.5 seconds: it waits for what each listener returns, then one turn of the event loop, so a short test timeout and fake timers still hold. An answer a listener sends only after a timer of its own isn't waited for. A component a route takes isn't delivered to the listeners, unlike on a bot. `dispatch()` alone delivers it, so a test that also calls `client.emit('interactionCreate', interaction)` delivers it twice. What a listener throws or rejects with rejects `dispatch()` once MeoCord has answered.

  A real discord.js `Client` keeps the 1.5-second wait, and nothing is delivered to its listeners. Without strict mocks, the mock client's emitter attaches and reaches nothing and returns `undefined`, as before, and the first call an app's or a test's code makes to it logs one warning for the run; MeoCord's own read of the listeners doesn't log it. A test that asserts `Logger.warn` was never called fails on that warning: assert on the warnings it expects instead, or call `useStrictMocks()`. Reading a command's `message` or a message's `channel_id` or `guild_id` warns once too, where strict mocks read `undefined`. The next major version (5.0) has the working emitter without the call ([#441](https://github.com/meocord/meocord/issues/441)). See [Components](https://meocord.dev/docs/4.3/components).

- [#987](https://github.com/meocord/meocord/pull/987) [`e2ebbca`](https://github.com/meocord/meocord/commit/e2ebbcaa1393fc166424c7e00bfc711eedf3bdd3) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Under `useStrictMocks()`, a mock message's, a mock `InteractionResponse`'s and a mock text-based channel's `createMessageComponentCollector()` and `awaitMessageComponent()` run discord.js's own collector on the mock client, so a handler that collects clicks on its reply, or in its channel, runs in its test as it does in the bot:

  - A collector from `reply()`'s response, from `withResponse`'s `resource.message`, from a deferral's response once the reply is edited, from `update()`'s or `deferUpdate()`'s response, from a mock message, such as a message handler's reply or a component's `interaction.message`, or from `interaction.channel`, in a server or a DM, collects a click that `module.dispatch()` delivers or that a test emits on the client. `max`, `filter`, `componentType`, `time`, `idle` and `stop()` work as in discord.js, and `awaitMessageComponent()` resolves with the click or rejects on its `time`. Both stay mock functions that record each call, so `toHaveBeenCalledWith` works and a test can still set its own behaviour.
  - A click built from a reply, such as `createMockInteraction(ButtonInteraction, { customId, message: await command.fetchReply() })`, is on the reply's client, so `dispatch()` delivers it where the collector listens; give `client` for a click meant for a collector on another client.
  - A component a route takes goes to the route alone, so no collector sees it. discord.js times a collector's `time` and `idle` with `node:timers`, so a test's fake timers don't move them: end a collector in a test with `max` or `collector.stop()`. To answer `awaitMessageComponent()`, start the handler without awaiting it, dispatch the click once the handler has replied, then await the handler.

  A strict test that asserted one of these returned `undefined` now gets a collector, or a promise of the click. A mock on a real discord.js `Client` is unchanged, with strict mocks or without: both stay inert with no warning. Without strict mocks both still return `undefined`, as before; the first call an app's or a test's code makes to one logs one warning for the run. The next major version (5.0) runs the real collector without the call ([#441](https://github.com/meocord/meocord/issues/441)). See [Mocks](https://meocord.dev/docs/4.3/mocks).

- [#977](https://github.com/meocord/meocord/pull/977) [`88c03a4`](https://github.com/meocord/meocord/commit/88c03a42df1e089801def7f4901284d38e42b7bc) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Under `useStrictMocks()`, a mock interaction's answers resolve to what discord.js's do, so a handler that uses the response works in its test:

  - `reply()`, `deferReply()`, `update()` and `deferUpdate()` resolve to a mock `InteractionResponse` bound to the interaction. Its `edit()`, `delete()` and `fetch()` reach the interaction's `editReply()`, `deleteReply()` and `fetchReply()`, and `createMessageComponentCollector()` and `awaitMessageComponent()` are mock functions, as on a mock message. A test there that asserts `resolves.toBeUndefined()` on one of them now fails: assert on the response instead, or drop the assertion.
  - With `withResponse: true`, each resolves to an `InteractionCallbackResponse` holding what Discord answers. `reply()`'s and `deferReply()`'s `resource` is of type `ChannelMessageWithSource` and holds the message as `fetchReply()` reads it at that moment, for `deferReply()` the loading message, whose id the reply keeps. `update()`'s is of type `UpdateMessage` and holds the updated message. `deferUpdate()` has no `resource`: it is `null`. The callback's `interaction` names the message, the component's for an update, with `responseMessageLoading` `true` only for `deferReply()`.
  - A deferred reply reads as Discord shows it until it is edited: `fetchReply()` after `deferReply()` gives a message flagged `Loading`, and `Ephemeral` too for a private deferral, where it had neither flag. An edit clears `Loading`.
  - `respond(interaction).send()` resolves to the message the reply or the update sent, where it resolved to `undefined`.
  - With `withResponse`, and so through `respond()`, the message takes its generated id when the answer resolves, where it took one when first read, so the generated ids of mocks made after it can differ by one.

  Without strict mocks, all of these resolve as before. The first time an app's or a test's own code calls one of the four methods, one warning is logged for the run; MeoCord's own calls, such as `@Defer`'s acknowledgement and `respond()`'s answers, don't log it. A test that asserts `Logger.warn` was never called fails on that warning the first time its own code calls one of them: assert on the warnings it expects instead, or call `useStrictMocks()`. The next major version (5.0) resolves them as strict mocks do, without the call ([#441](https://github.com/meocord/meocord/issues/441)). See [Mocks](https://meocord.dev/docs/4.3/mocks).

- [#1005](https://github.com/meocord/meocord/pull/1005) [`94050f2`](https://github.com/meocord/meocord/commit/94050f203ab69c94b6c0d915b1d81bc71ff2e9ba) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Under `useStrictMocks()`, a mock text-based channel's `createMessageCollector()` and `awaitMessages()`, and a mock message's `createReactionCollector()` and `awaitReactions()`, run discord.js's own collector on the mock client, and `module.dispatch()` delivers a message or a reaction to the client's listeners, so a handler that asks a question and waits for the answer, or counts reactions, runs in its test as it does in the bot:

  - `dispatch(message)` reaches the mock client's `messageCreate` listeners, and `dispatch(reaction, { user })` its `messageReactionAdd` or `messageReactionRemove` listeners, routed or not, with discord.js's arguments, a reaction's with `{ type: ReactionType.Normal, burst: false }`. They are the listeners attached before routing starts, called once the route has run to its first `await`, as the gateway calls them after MeoCord's: a collector a handler starts takes the next message, never the one that started it, and an answer that another command takes still reaches the collector waiting for it. What a listener throws or rejects with rejects `dispatch()`.
  - A dispatched reaction is applied to its message first, as the gateway applies it, by discord.js's own code: an add caches it on `message.reactions` and counts the user into its `users`, `count` and `countDetails`. Where its message doesn't cache it, the add starts it from none, its `users` and `me` too, unless its state is the test's: a `count`, `countDetails`, `me` or users the test gave before its first dispatch, or a `count` or `countDetails` set after one. The add then counts on from what is there, `count` and `countDetails` apart, as discord.js keeps them. So the first add of a reaction given none of these counts 1, one given `me: true` counts 2 and keeps `me`, and a test that sets `count` to 5 between two dispatches gets 6 from the second. A remove takes the user out of `users`, and out of the count unless the user is the bot and `me` is set, as discord.js leaves that to the bot's own REST call; once neither users nor count are left the reaction leaves `message.reactions`. A remove of a reaction its message doesn't cache is delivered and changes nothing: a real client without `Partials.Reaction` emits nothing for it, and `dispatch` delivers it all the same, so a test doesn't show that a bot needs the partial. A partial reaction, its `count` null, is delivered as it is, as discord.js leaves it. A reaction's `countDetails` reads `{ burst: 0, normal: count }` unless the test sets it. A dispatched reaction is a normal one, never a burst.
  - A mock `MessageReaction` is on its message's client, by the rule a mock interaction follows: the `client` given, else its `message`'s, a real `Client` included, else a new one, on which its message is made when none is given. A real `Client` given to the reaction is its own only, and a reaction on a real `Client` is routed with nothing applied to it or delivered. A strict test that reads a reaction's `client` gets that client, where it read a placeholder, and `dispatch` delivers the reaction to that client's listeners.
  - `max`, `filter`, `time`, `idle`, `dispose` and `stop()` work as in discord.js, a reaction collector emits `create`, `remove` and `dispose`, and `awaitMessages()` and `awaitReactions()` resolve with what they collected, or reject on their `time` with `errors: ['time']`. All four stay mock functions that record each call, so `toHaveBeenCalledWith` works and a test can still set its own behaviour.

  A strict test that asserted one of these returned `undefined`, or an empty collection at once, now gets a collector, or a promise of what it collects. discord.js times a collector with `node:timers`, so a test's fake timers don't move it: a handler that awaits `awaitMessages({ time: 60_000 })` with nothing dispatched waits that long, past a test's timeout. Dispatch the answer, give the collector `max`, or call `collector.stop()`. A test that both dispatches a message or a reaction and emits the same event on the mock client delivers it twice, and `emit` applies nothing to a reaction; `emit()` on the testing module is unchanged and reaches only `@On` handlers. A mock on a real discord.js `Client` is unchanged, with strict mocks or without: nothing is delivered and the four stay inert with no warning. Without strict mocks nothing changes: the create methods return `undefined`, the await methods resolve at once to an empty collection, and dispatch reaches no listener and changes no reaction; the first call an app's or a test's code makes to one of the four logs one warning for the run. The next major version (5.0) runs the real collector without the call ([#441](https://github.com/meocord/meocord/issues/441)). See [Mocks](https://meocord.dev/docs/4.3/mocks).

- [#977](https://github.com/meocord/meocord/pull/977) [`2cad9a0`](https://github.com/meocord/meocord/commit/2cad9a0dc4fa66d2dee6176dd44e17002579d66f) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A project can have its mocks' values type-checked. Merge `typedValues: true` into `MockTypeOptions` from `meocord/testing`, in a declaration file the tests compile with:

  ```ts
  // src/types/meocord-testing.d.ts
  import 'meocord/testing'

  declare module 'meocord/testing' {
    interface MockTypeOptions {
      typedValues: true
    }
  }
  ```

  Every mock's `mockReturnValue`, `mockResolvedValue` and `mockImplementation` then take only what the mocked function returns, resolves to or is, and `mock.calls`, `mock.lastCall`, `mock.results` and `mock.settledResults` read as its own arguments and results. `mockResolvedValue(undefined)` stays allowed, since a mock's answers resolve to `undefined` by default. An overloaded method, such as `guild.members.fetch`, takes what any of its overloads gives. A partial fake such as `mockResolvedValue({ id })` is then refused; cast it where it is intended.

  Without the declaration nothing changes: those values stay `any`. A project whose tests compile as both ESM and CommonJS declares it in a `.d.ts` and a `.d.cts`. MeoCord 5.0 types the values by default ([meocord#561](https://github.com/meocord/meocord/issues/561)). See [Mocks](https://meocord.dev/docs/4.3/mocks).

- [#975](https://github.com/meocord/meocord/pull/975) [`c090957`](https://github.com/meocord/meocord/commit/c0909579d743c2d9bad4cd1684009654f60fa4b5) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `OwnerGuard`, from `meocord/common`, lets only the user whose id a component's customId carries use it. Put the id in the route, `@Command('card/{ownerId:snowflake}', CommandType.BUTTON)`, and add `@UseGuard(OwnerGuard)`; anyone else who clicks is told privately, in their own language, "Only the user who opened this can use it." Name another route param or give your own words with `@UseGuard({ provide: OwnerGuard, params: { param: 'authorId', message: '…' } })`. The text is `meocord.guard.notOwner`, which an app's catalogs translate. Since the guard throws `GuardDeniedError`, a filter catching that error can answer otherwise, and observers name it in `deniedBy`.

  The bot refuses to start with `OwnerGuard` where it would deny every call: on a slash command, a context menu or an entry point, and on a component or modal handler whose routes lack the param. Written with `@UseGuard` on a message, reaction, autocomplete or event handler it is refused too; on a controller or in `@MeoCord({ guards })` it passes over those handlers, which it never runs for, as a controller's `@Cooldown` passes over the handlers it never counts. Apps made with `meocord create` no longer get their own `src/guards/owner.guard.ts`: the sample button uses `OwnerGuard`. An app that has that file can keep it, or delete it and import `OwnerGuard` from `meocord/common`. See https://meocord.dev/docs/4.3/guards.

- [#979](https://github.com/meocord/meocord/pull/979) [`eeed81e`](https://github.com/meocord/meocord/commit/eeed81e5a1dc6e185bd2042d1f6a26d88355a4da) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A self-contained build (`bundleDependencies`) packs every installed copy of a native addon that bundled code imports, and each importer loads its own. With `natpkg@1` at the top of `node_modules` and `natpkg@2` nested under `wrap`, which needs it, `wrap` now runs against `natpkg@2` from `dist` alone, where the build packed only `natpkg@1` for everyone and warned.

  The copy your project's root resolves to keeps its place at the top of `dist/node_modules`; under npm, that is the copy npm hoisted to the top of `node_modules`. With none there, the copy your project's dependencies reach in the fewest steps takes it, the first by name on a tie, so the order the bundler meets imports in doesn't change which. Each other copy is packed with its own dependencies under `dist/node_modules/.meocord/<name>-<version>-<hash>/`, the hash taken from the chain of dependencies that reaches it from your project, such as `wrap>natpkg`, so the same installed tree, as a lockfile fixes it, builds the same `dist` on any machine, and under pnpm the same with its store inside the project or outside it. Its importers load its entry file from there, picked by the bundler as it resolved the import, the `exports` conditions of an `import` or a `require` and subpaths included. pnpm's links to one store copy count as one copy. When the other copy has no file for the request, for example an `exports` with no entry for `require`, the build stops and names the copy and the request.

  A project with one copy of each native addon builds exactly as before. See [Self-contained builds](https://meocord.dev/docs/4.3/self-contained-builds).

- [#976](https://github.com/meocord/meocord/pull/976) [`b7fa179`](https://github.com/meocord/meocord/commit/b7fa1799f30a492b64ace00e09ffd2e071e4050e) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `meocord register --prune` finds your app's commands left in servers the configuration no longer names, such as a test server after you moved to global commands, where members see every command twice, and removes them. It runs after a successful registration, checks every server the bot is in, and deletes, one request per command removed, only the commands this build declares by name and type, keeping and listing those not declared by this build. `--prune all` removes those too, asking once in a terminal or with `--yes` outside one. `--dry-run` registers nothing and only reports, `--prune-guild <id>` adds a server the bot isn't in, and `--after <id>` resumes a run that stopped early. A development run now also warns when this checkout once registered to a server the configuration no longer names. A variable left in your shell or `.env` file, such as `MEOCORD_REGISTER_GUILD`, no longer steers `meocord register` or `meocord start`: each run registers as its own flags say. See [CLI](https://meocord.dev/docs/4.3/cli).

- [#984](https://github.com/meocord/meocord/pull/984) [`0d62e30`](https://github.com/meocord/meocord/commit/0d62e3019f9d81b0760c2d638b66f7bfeb51887b) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A new app from `meocord create` sends without pings: its `clientOptions` sets `allowedMentions: { parse: [] }`, the default discord.js gives every message the client sends, `respond()`'s replies and your own `message.reply` and `channel.send` alike. A reply that echoes a member's text no longer pings whoever that text mentions, `@everyone` and roles included; one that should ping passes its own `allowedMentions`, such as `{ users: [id] }`, and a `message.reply` that should ping its author adds `repliedUser: true`.

  An existing app whose `clientOptions.allowedMentions` is unset logs one warning at startup, since the next major version (5.0) makes `{ parse: [] }` the default ([#501](https://github.com/meocord/meocord/issues/501)). Set it to `{ parse: [] }` to have that now, or to `{ parse: ['users', 'roles', 'everyone'], repliedUser: true }` to keep every mention; setting it to anything silences the warning. Nothing else changes. See [Security](https://meocord.dev/docs/4.3/security).

- [#1006](https://github.com/meocord/meocord/pull/1006) [`f1cfefd`](https://github.com/meocord/meocord/commit/f1cfefdb00bf61cfbf46ba691f4f45382032f4ae) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A `route()` can now read a customId back: `route('ticket/{id:int}/close').match('ticket/42/close')` returns `{ id: 42 }`, the params its handler would receive. Use it for a customId the bot did not get as a handler call, such as the other buttons on a message or an id kept in a database. A value `build` encoded with `/` or `%` comes back as it was given, and a typed param comes back as its value. `match` returns `undefined` for a customId that doesn't match, and an empty object for a matching route without params. It reads that one route, so a customId it matches can still go to a more specific pattern in your app. See [Buttons, selects and modals](https://meocord.dev/docs/4.3/components).

  The new `RouteMatch<T>` type, from `meocord/common`, is what `match` returns: the params a customId route gives its handler. It can type a handler's params too, such as `{ id }: RouteMatch<typeof closeTicket.pattern>`.

  `Route` gains the required `match` method. A bot that only calls `route()` needs nothing. Code that writes a `Route` object by hand no longer compiles until it adds `match(customId: string)`, returning the params or `undefined`; make the object with `route()` instead. See the [upgrade guide](https://meocord.dev/docs/4.3/migrating#route-match).

- [#993](https://github.com/meocord/meocord/pull/993) [`dabaa35`](https://github.com/meocord/meocord/commit/dabaa355189d71fce24d33406fb1c743561f8312) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A process that loads both of MeoCord's builds, such as jest setup files written in CommonJS beside ES module specs or an ES module bot that uses a CommonJS helper package, now injects the app's own instance into a constructor typed with either build's class. `Translator`, `ThemeCache`, `ExecutionContext`, `CooldownStore`, `MemoryCooldownStore`, `HandlerRegistry` and `ShardContext` are one class object for both builds of a MeoCord version, so `instanceof` on these classes agrees between the builds, as it already does for MeoCord's error classes. MeoCord's other exported classes, such as `Logger`, `RedisCooldownStore` and `MeoCordTestingModule`, stay one per build: MeoCord decides nothing by their identity, and only an app's own `instanceof` across the builds tells them apart. A sharded bot whose memory cooldown store comes from the other build now gets the warning that its per-user and global cooldowns count in each shard alone. Previously a class typed from the other build was given an empty instance (for `Translator`, `ThemeCache`, `ExecutionContext` and `CooldownStore`) or refused at startup with "has no decorator" (for `HandlerRegistry` and `ShardContext`). Two installed versions of MeoCord still keep their classes apart. See https://meocord.dev/docs/4.3/testing.

- [#984](https://github.com/meocord/meocord/pull/984) [`fed44ef`](https://github.com/meocord/meocord/commit/fed44ef2d7f85d58eb6b25354053618f9007ac53) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `meocord start --prod` and `meocord register`, run without `--build`, now warn when the build in `dist` is older than your source, naming the first file changed since, and then run that build as before: `dist was built before src/controllers/slash/ping.slash.controller.ts changed, so start --prod runs the previous build. Add --build, or run meocord build --prod first.` They also warn when `dist` holds a development build, as `meocord start --dev` and `meocord build --dev` leave it. The exit code and the bot are unaffected.

  Every build writes `dist/meocord.build.json`, recording its mode and, with their size, mtime and SHA-256, the source files it read, `tsconfig.json` and each file it extends, and with `bundleDependencies` your lockfile, whose packages the build copies in. The check reads no file whose size and mtime are unchanged and hashes the rest; it stops after about 200 ms, partway through a large file if need be, and then says nothing. A file whose mtime moved but whose content didn't, as after a checkout or a copy, gives no warning; neither does a `dist` with no recorded source beside it, as on a server that has only `dist`, or one built by an earlier MeoCord. As with git, an edit that keeps a file's size and has its old mtime put back is not seen. See [CLI](https://meocord.dev/docs/4.3/cli).

- [#1063](https://github.com/meocord/meocord/pull/1063) [`6503d89`](https://github.com/meocord/meocord/commit/6503d89929b41c2a211c02d8841494c43d75483c) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A testing module's `dispatch()`, `invoke()` or `emit()` made while `init()` is still running, which a `close()` then ends, no longer starts. Before, such a call went on once `init()` resolved: it ran its handler against the closed module, on classes `close()` had already shut down, logged nothing and resolved as a call that ran, with `ran: true`, or `ran: 1` for `emit()`. Now it settles as a call the bot drops at a stop: no handler runs, nothing is made for it, and it reports the error "The bot stopped before this call started.". `dispatch()` resolves with `ran: false`, that error and no handlers, and `invoke()` with `ran: false` and that error. `EmitResult` gains an optional `error`, so a dropped event resolves with `ran: 0` and that error. `error` is set only for a dropped event, so every other `emit()` still resolves with `{ ran: n }`. A call made after `close()` is unchanged: it warns and runs. See https://meocord.dev/docs/4.3/testing.

- [#1004](https://github.com/meocord/meocord/pull/1004) [`726ddee`](https://github.com/meocord/meocord/commit/726ddee1c545fab6f9ad81a1296241ed71aedfc4) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Each `ValidationIssue` from a `@Validate` schema keeps the issue the schema reported, as `raw`, typed `StandardSchemaV1Issue`. An exception filter can read the library's own fields from it, such as zod's `code` and `minimum`, to word a refusal in the user's language instead of parsing the library's English message. `raw` is non-enumerable, so `toEqual({ message, path })` and a serialised issue are unchanged, and an issue you build yourself has none. See [Validation](https://meocord.dev/docs/4.3/validation).

- [#983](https://github.com/meocord/meocord/pull/983) [`1c9036f`](https://github.com/meocord/meocord/commit/1c9036fe642d063f5a8c2b53ccda186df4a5fec0) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `@MeoCord({ waitForReady: true })` holds each call until the `onReady` hooks of the classes it uses have settled, so a handler no longer needs a flag or a promise of its own to avoid reading a cache before it is warm. It is off unless set.

  - A call waits for the hooks of its handler's class, the guards, interceptors, filters and pipes that run for it, global ones included, the presenter, the `themeFor` class, and what each of them injects. It doesn't wait for a hook ordered after all of those. The hooks still run one at a time, so it also waits for a slower hook ordered before its own.
  - No server's or user's theme is looked up before the `themeFor` class's own hooks have settled, whether in a call, in a function `bindTheme` wraps, or in an answer outside any call. A lookup follows what Discord has been told of its interaction, as the call does: once Discord has an acknowledgement or an answer, it waits as long as the hooks run; while one is on its way, it waits for the outcome, neither going ahead nor warning; told nothing, as without `@Defer`, it waits until 2 seconds after the interaction was created, or 2 seconds from the first wait for it for one with no creation time or one ahead of the clock, which its warning then reads as "after waiting 2.0 s", then goes ahead with a warning, at once if those have passed. A call and the lookups for its interaction waiting at once go ahead together, on one decision: the call first, its warning naming the hook, and the lookups then without one of their own; a lookup that starts once that decision is made follows the rule afresh. An autocomplete's waits 1 second the same way. `@Defer({ mode: 'auto' })`'s acknowledgement counts as on its way from the call's start until it is sent or an answer's Discord call replaces it; an answer still waiting for its theme doesn't hold it back, and goes out after it, as an edit, the acknowledgement as private as that answer, whatever `@Defer`'s `ephemeral` says. The warning: `PrefsThemes looked up a theme before onReady in Prefs had settled, 2.0 s after the interaction was created, as long as an interaction Discord has been told nothing of waits. Make onReady in Prefs faster.`
  - The call waits after `@Defer` acknowledges it and before its guards, so a deferred command is acknowledged at once and waits as long as its hooks run; `@Defer({ mode: 'auto' })` keeps its timer running through the wait.
  - An interaction without `@Defer` waits until 2 seconds after it was created and an autocomplete 1 second, then runs, with one warning per hook naming it, whatever `warnSlow` says: `PricesController.price ran before onReady in PriceCache had settled, 2.0 s after the interaction was created, as long as an interaction without @Defer waits. Add @Defer to PricesController.price to have it wait for the hook, or make onReady in PriceCache faster.` A message, a reaction and an event wait as long as the hooks run.
  - That wait and the wait for `themeFor` share one deadline, 2 seconds after the interaction was created (1 second for an autocomplete), leaving the handler the last second for its answer. With a hook that runs past it, a resolver the hook holds back misses the call even when it answers quickly: the answer goes out at 2 seconds in the handler's theme, and the next call reads the theme from the cache. A call whose hook was late logs the hook's warning alone, not the theme lookup's.
  - Under `@Defer({ mode: 'auto' })`, with `waitForReady` on or off, an answer still waiting for its theme, such as from a slow `themeFor` resolver, no longer cancels the acknowledgement: the interaction is acknowledged on time, as privately as that answer, and the answer then edits it in. A test whose theme resolver outlasts the timer sees `deferReply` then `editReply` (`deferUpdate` then `editReply` for a component) where it saw `reply` or `update`.
  - A private answer sent as an edit of a private deferral, such as `send()` with `MessageFlags.Ephemeral` after `@Defer({ ephemeral: true })` or a raw `deferReply({ flags: MessageFlags.Ephemeral })`, no longer logs "Dropped flags Ephemeral, which an edit cannot take", as a `followUp()` already didn't: the deferral is already private.
  - A hook that throws counts as settled.
  - A stop (`app.stop()`, a signal's shutdown, or `MeoCordTestingModule.close()`) decides every call still waiting where it stops waiting for the calls under way, before the `onShutdown` hooks: by the end of the event loop iteration's timers and I/O, before its immediates. A call whose hooks have settled by then, or whose bound is due, runs first; any other never starts, nor does one held for a hook the stop keeps from running, which is dropped as soon as the hooks' pass ends. A dropped call runs no guard, handler, filter or fallback, and nothing more is sent to Discord for it: an acknowledgement `@Defer` made stays, `@Defer({ mode: 'auto' })`'s timer is cancelled without acknowledging, and an answer an observer began in `onStart` goes out once, in the handler's theme.
  - Observers get `onSettled` for a dropped call with the outcome `'error'`, `handled: false` and an error saying `The bot stopped before this call started.` The `onShutdown` hooks wait for that, and for an answer an observer made in `onStart`, only as long as the calls have, `shutdownTimeout` less the hooks' reserve, so the hooks always get their reserve and the stop resolves after them. A dropped call whose answer to Discord, or in a testing module an observer's `onStart`, is still running then tells its observers when that settles, which can be after the stop. A dropped call still finishing then is warned about: `Calls dropped at the stop still had an answer to Discord or an observer under way after 7500 ms; running the onShutdown hooks in the 2500 ms left.` (with the default `shutdownTimeout`). A testing module's `dispatch()` and `invoke()` resolve with `ran: false` and that error; `emit()` doesn't count the handler.
  - The bot names dropped calls in a warning of their own: `Calls dropped before they started, as the stop came while they waited: interaction "/quote" for onReady in Cache.` A start whose login fails while the gate holds calls drops them the same way, and names them as `Calls dropped before they started, as the login failed while they waited: interaction "/quote" for onReady in Cache.` A dropped call still finishing then is warned about as `Calls dropped at the failed login still had an answer to Discord or an observer under way after …`. A dropped call is not running: the drain's `Calls still running` warning leaves it out, and a drain that waited only on dropped calls counts as finished, so a cooldown store's operations settle before its `onShutdown`.
  - With it on, the slow `onReady` warning says that the calls using the hook wait for it, where it says calls are already being handled.
  - A `MeoCordTestingModule` takes it from the app: a `dispatch`, `invoke` or `emit` made while `init({ ready: true })` runs the hooks waits for them, under `useStrictMocks()` for the same hooks as the bot's. Without `init({ ready: true })` no hook runs and nothing waits. A mock interaction was created when it was made, or at its id's time when the test gives one, so a bound counts from there. With the option on, an `invoke` whose argument its `@Command` handler can't take is refused at once rather than after the wait, so its guards, interceptors and pipes don't run first, and an outcome a filter handles reads `ran: false`; with it off, or once the hooks have settled, nothing changes.

  See [Lifecycle hooks](https://meocord.dev/docs/4.3/lifecycle-hooks).

- [#983](https://github.com/meocord/meocord/pull/983) [`3e69d04`](https://github.com/meocord/meocord/commit/3e69d04145c8ec128c93b74687ab25868973c99e) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `@MeoCord({ warnSlow })` names work slow enough to cost a member something, and is on unless set to `false`; a `MeoCordTestingModule` turns it on only when the app sets it to `true`, since a test's fake clock can pass these times inside a handler.

  - An `@Autocomplete` handler that takes 2 seconds or more of Discord's 3 is named once per run, with the time, counted from the earlier of the interaction's creation and its arrival. One whose `interaction.respond()` Discord refuses as expired is named with its time and "the member saw no suggestions", at warn, where it was logged as `Error handling …` at error; a close of its menu Discord refuses as expired is logged at warn too, where it was at debug. Other Discord errors are logged as before.
  - A slow `onReady` warning now names the hook, how long it has run, how many hooks wait behind it, and what to do: `onReady in ReportService has run for 10.0 s, holding back 3 hooks after it; calls are already being handled. Start long work without awaiting it in onReady, and stop it in onShutdown.`
  - `messages.slowHandlerWarning` follows `warnSlow` when unset, so one `warnSlow: false` silences every slow warning, and wins for message handlers when set.

  One behaviour changes for a handler that is already broken: an `@Autocomplete` handler that returns without calling `interaction.respond()` now has its menu closed with no choices, where the member saw it fail to load, and is named once per run in production too, whatever `warnSlow` says: `SearchController.query returned without answering its autocomplete, so MeoCord closed the menu with no choices.` With `warnUnanswered` on, this warning takes the place of its warning for that handler. A testing module does the same under `useStrictMocks()`; without them it leaves the interaction untouched, as before, still names the handler, and warns once a run that the bot closes the menu. A handler that calls `interaction.respond(choices)` without awaiting it counts as answering: MeoCord waits for each such answer and reports each one that fails, also when the handler then throws, unless the handler reads its outcome itself, with `await`, `then`, `catch`, `finally` or `Promise.all`. The promise `respond()` gives the handler is a `Promise` subclass that notes those reads, so it is not the promise the interaction's own `respond` returned. Since MeoCord waits for each such answer, one that never settles holds its call, and a stop waits for that call up to its shutdown time. Answer within the three seconds. See [Autocomplete](https://meocord.dev/docs/4.3/autocomplete) and [Lifecycle hooks](https://meocord.dev/docs/4.3/lifecycle-hooks).

### Patch Changes

- [#1025](https://github.com/meocord/meocord/pull/1025) [`303e623`](https://github.com/meocord/meocord/commit/303e62390a62e3947dd441154bb076c728401993) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A handler under `@Defer({ mode: 'auto' })` whose interaction was answered with a raw discord.js call logged the development warning "An interaction under `@Defer` was answered with a raw discord.js call" twice for one answer, once when the timer fired and again when the handler returned. It now logs it once, when MeoCord first finds the answer: at the timer, at the next answer made through `respond()`, or when the handler returns. A raw answer followed by one through `respond()` before the timer, which logged nothing, now logs it too.

- [#1025](https://github.com/meocord/meocord/pull/1025) [`2f4d2c5`](https://github.com/meocord/meocord/commit/2f4d2c58fde5216fb683cb06e5d626b58733bcfd) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A test using fake timers, such as Vitest's `vi.useFakeTimers()`, now draws the loading view of a `lock()` that is pending when `@Defer({ mode: 'auto' })`'s timer fires in the handler's theme: its `@UseTheme` layers and the server's and user's themes from `themeFor`. Before, fake timers ran the timer outside the call, so the view showed the app's theme. Nothing changes in a running bot, where the timer already ran inside the call. A timer your own handler arms still runs outside the call under fake timers; wrap its callback in `bindTheme()` to keep the handler's theme.

- [#1006](https://github.com/meocord/meocord/pull/1006) [`c174735`](https://github.com/meocord/meocord/commit/c1747357085563ebe9144e8c7a69f1b31de8d8a5) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `CheckedParams` and `PIPED_BRAND`, exported from `meocord/interface`, are marked deprecated. Both are internal, and the next major version (5.0) stops exporting them; nothing replaces them. Code that imports either keeps compiling, with the name struck through in your editor.

- [#979](https://github.com/meocord/meocord/pull/979) [`62c0fa2`](https://github.com/meocord/meocord/commit/62c0fa20ec6982bb3eb35550de756dbac2f201ae) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `meocord/eslint` now names the packages it needs as optional peer dependencies: `eslint`, `typescript`, `prettier`, `typescript-eslint`, `@typescript-eslint/parser`, `eslint-plugin-import-x`, `eslint-plugin-prettier`, `eslint-config-prettier`, `eslint-import-resolver-typescript` and `globals`. A project that adopts the config by hand, rather than through `meocord create`, found each of them only through a `Cannot find package` error.

  The peers constrain no version, so installing or upgrading `meocord` changes nothing in a project, whichever versions of these packages it has, prereleases included. To use the config, install them at least at the versions it works with:

  ```bash
  npm install --save-dev "eslint@>=8.57.0" "typescript@>=4.8.4 <6.1" "prettier@>=3.0.0" "typescript-eslint@>=8.0.0" "@typescript-eslint/parser@>=8.0.0" "eslint-plugin-import-x@>=4.13.2" "eslint-plugin-prettier@>=5.0.0" "eslint-config-prettier@>=7.0.0" "eslint-import-resolver-typescript@>=4.0.0" globals
  ```

  `typescript` stays below 6.1 until typescript-eslint supports TypeScript 7. See [ESLint](https://meocord.dev/docs/4.3/eslint).

- [#1034](https://github.com/meocord/meocord/pull/1034) [`7526809`](https://github.com/meocord/meocord/commit/7526809834aac71c9c785d3782862e85539dedb3) Thanks [@l7aromeo](https://github.com/l7aromeo)! - An interaction Discord has been told nothing of no longer misses its 3 seconds waiting for its themes. Its wait for `themeFor` now ends 2 seconds after the interaction was created (1 second for an autocomplete). Once it passes, the call goes on in its handler's theme and keeps it to its end. The lookup goes on within `themeForTimeoutMs`, and its result is kept for later calls.

  - Before, a command without `@Defer` waited for the whole lookup, up to `themeForTimeoutMs`, so a `themeForTimeoutMs` of 3 seconds or more missed the window by itself.
  - A cut is not a failure: it starts no backoff. One warning names each lookup in flight, the server or user and the first call cut, and says the lookup goes on.
  - With `@Defer`, nothing changes while the acknowledgement goes through. If it fails after the deadline, the call goes on at once: a `@Defer({ mode: 'auto' })` acknowledgement failing at its latest, 2.5 seconds after creation, leaves the first answer that late.
  - When a bot's stop or a testing module's close ends its shutdown, the lookups still in flight end with it. A call still waiting on one goes on in its handler's theme, and whatever the lookup gives later is not logged, counted or kept.
  - Messages, reactions and events have no deadline. See https://meocord.dev/docs/4.3/theming and https://meocord.dev/docs/4.3/lifecycle-hooks.

- [#1030](https://github.com/meocord/meocord/pull/1030) [`d82bd12`](https://github.com/meocord/meocord/commit/d82bd121b17f664544ff4e72b02ca599fff5c9d8) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A translator whose catalog type is written by hand in either of two shapes now translates. Each refused every key, with "Argument of type '"greet"' is not assignable to parameter of type 'never'" or "Expected 2 arguments, but got 1.":

  - `Record<string, string | { one: string; other: string }>`, a type for JSON files that hold plurals. Every key is taken, with optional params, `count` among them, since a key may be a text or a plural. `t.localizations` takes none of its keys, as it needs a single text.
  - An interface that extends `CatalogShape` and names its messages. Its named keys are taken, and a message written as literal text has its params checked, as in a literal catalog.

  A message typed `string` takes any params, which only `expectCompleteCatalog` checks. Translators that compiled before still do, and assign as they did. See [Localisation](https://meocord.dev/docs/4.3/localisation).

- [#1046](https://github.com/meocord/meocord/pull/1046) [`033e257`](https://github.com/meocord/meocord/commit/033e2579951554af58b1a46025d42fe3e092e972) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A provider whose factory settles after a stop stopped waiting for it now has its value shut down. A stop while the bot starts waits for the factory under way at most `shutdownTimeout`, then shuts down without it, as before. When that factory returns a value later, its own `onShutdown` now runs as it arrives, within `shutdownTimeout`, and `start()` rejects after that. A value with an `onReady` hook is the exception: that hook never ran, so by the rule for `onShutdown` at any stop, it gets none. Before, the value was left open: a connection or a timer it held kept a stopped bot's process running. What the value injects was shut down by the stop already, so its `onShutdown` may find that closed.

  The testing module follows the bot. A `close()` while `init()` makes the providers waits for the factory under way at most `shutdownTimeout`, then warns, naming that factory, and shuts down without it; before, it waited for as long as the factory took, so a factory that never settles left `close()` pending. A value the factory returns later is shut down once it arrives and `close()` is done with the rest, within `shutdownTimeout`, with or without an `onReady` hook, as `close()` shuts down any value it made.

  Once `close()` has begun, `init()` makes nothing after the factory under way: no other factory, no listed service, and no `onReady` hook runs. It still resolves. Before, it went on to make all of them, and `close()` shut them down afterwards. A test that calls `close()` while `init()` runs and then reads something `init()` would have made after that point finds it not made by `init()`, and not shut down by `close()`. A `get()`, `dispatch()`, `invoke()` or `emit()` that needs the value of a factory `init()` skipped doesn't run that factory: `get()` throws and a call rejects, naming the token: "close() ended init() before it made 'TOKEN'; its factory doesn't run after close().". An `emit()` made after that `close()` runs its handlers, as `dispatch()` and `invoke()` do, listing the event sources from the classes and provided values `init()` made, without running a factory.

  After `close()`, `get()` returns what was shut down as before, without a word. When `get()`, `dispatch()`, `invoke()` or `emit()` makes an instance with an `onShutdown` only then, such as a listed service an `init()` that `close()` ended did not make, it now warns once, naming it, since nothing shuts that instance down. See https://meocord.dev/docs/4.3/testing.

- [#1036](https://github.com/meocord/meocord/pull/1036) [`f216132`](https://github.com/meocord/meocord/commit/f21613270920d2042a9f5a9922b66112b9410595) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `Logger` no longer throws when it is given a value whose inspection throws, such as an object whose own `[util.inspect.custom]` throws. That value prints as `[value could not be inspected: <reason>]`, and the rest of the line prints as before. Such a value, thrown by your own code, could end a running bot: an observer's `onStart` rejecting with it or its `onSettled` throwing it left a rejection nothing handled, so the process exited 1, and an `onShutdown` hook throwing it kept a stop by signal from destroying the client and exiting cleanly.

  A bot also no longer depends on its reports to keep going in those places:

  - An observer whose failure can't be reported, as a class whose `name` getter throws, is reported in its place, and the other observers still run.
  - A stop by signal destroys the client and exits even when something in the stop fails: with 0 when an `onShutdown` hook failed, as before, and with 1 when the stop itself failed, as when reporting a hook's failure throws.
  - A cooldown store's failure is logged as `failed`, without the reason, when what it failed with can't be read as text, and the policy you set still decides the call.

  Nothing changes for a value that prints today.

- [#995](https://github.com/meocord/meocord/pull/995) [`abf867f`](https://github.com/meocord/meocord/commit/abf867fdbe26e758552853038daca2fb145ebc52) Thanks [@l7aromeo](https://github.com/l7aromeo)! - The examples your editor shows on hover for these members now compile as written: `TestingModule`'s `init`, `close`, `themeCache`, `invoke`, `dispatch` and `emit`; `TestingModuleBuilder`'s `overrideProvider`, `overrideGuard`, `overrideInterceptor`, `overrideFilter`, `overrideTheme` and `overrideThemeFor`; `HandlerRegistry.messageHelp`; `ExecutionContext.getHandlerParams`; `RedisCooldownStore.using`; and the `messages.handlers` option. Each declares the controllers, guards and services it uses instead of naming ones it never shows, and `messages.handlers`' gives `@MeoCord` the `clientOptions` it requires. `RedisCooldownStore.using` shows node-redis and ioredis as two examples, so either can be copied alone, and `TestingModule.close`'s shows a factory's value closed after the class that injects it. Nothing changes at runtime.

- [#977](https://github.com/meocord/meocord/pull/977) [`9c317b3`](https://github.com/meocord/meocord/commit/9c317b3675f9e74f50be18fbf0300754a6ca4adb) Thanks [@l7aromeo](https://github.com/l7aromeo)! - The JSDoc of `createMockInteraction()` and `useStrictMocks()` now says that a mock interaction's `fetchReply()`, `editReply()` and `followUp()` each resolve to a new message object, the message as it stands then, never one an earlier call gave, with or without strict mocks. discord.js does the same: `fetchReply()` and `followUp()` return a copy or a new object, never its cached `Message`, and `editReply()` returns a copy of a message it has cached. So two `fetchReply()` calls are not `===`, and a message held from before an edit keeps its old content. Compare messages by `id`, and tell two edits apart by `editedTimestamp`. Nothing the mocks return changes. See [Mocks](https://meocord.dev/docs/4.3/mocks).

- [#1012](https://github.com/meocord/meocord/pull/1012) [`dd4c05d`](https://github.com/meocord/meocord/commit/dd4c05d97d7c259d7073f8fa02f80d5931b91e30) Thanks [@l7aromeo](https://github.com/l7aromeo)! - The mocks `meocord/testing` makes with its own mock function no longer stay in memory until a test yields to the event loop. A test that made thousands of mock interactions in one loop, awaiting only promises, kept about 290 KB for each, and could run out of heap. `clearAllMocks()` and `resetAllMocks()` now reach each of meocord's own mocks the next time it is used: called, read through `fn.mock` or a matcher, or set. One difference: an array a test read before the clear, as in `const calls = fn.mock.calls`, keeps its entries until the mock is next used, then empties in place. Reading `fn.mock.calls` again, or a matcher, sees the cleared state at once. With `useMockFn(vi.fn)`, Vitest holds each of its mocks until the test yields, so a test making thousands of them yields between batches with `await new Promise(resolve => setTimeout(resolve, 0))`. See [Mocks](https://meocord.dev/docs/4.3/mocks).

- [#987](https://github.com/meocord/meocord/pull/987) [`12203df`](https://github.com/meocord/meocord/commit/12203df206608396d9a06d18ab946f341087b6bd) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Under `useStrictMocks()`, a mock interaction or message is now on one client with what it holds, as in discord.js: its user, member, channel and server, a message's author and the users it mentions, the channel of an interaction's reply, the users, members, roles and channels an interaction's options or a select menu resolve to, and a user context menu's `targetUser`. A user its options or a select menu resolve to is cached on the mock client it is on unless one with its id is there already, as discord.js keeps the one cached first, and `options.getUser()` still returns the user the test gave; a `targetUser` given is the one cached on the interaction's client. Each takes the `client` given, else the mock client that a message or a message context menu's `targetMessage`, a channel or a guild given to it already holds, in that order, else a new one, so `createMockMessage({ channel })` is on the channel's client. A structure given that is already on another client keeps it. A real `Client` given as `client` is the mock's own client, which caches an interaction's user, server and channel and a `targetUser` given; what the mock holds keeps mock clients of its own, except the server and channel a message makes for itself, and a real `Client` a structure given holds is never taken nor written to. One client means a collector made on `interaction.channel.client`, as `channel.createMessageComponentCollector()` makes one, hears a click on the interaction's reply. Without strict mocks each keeps a client of its own, as before, and code that reads one where strict mocks would give another warns once; the next major version (5.0) shares them without the call. See [Mocks](https://meocord.dev/docs/4.3/mocks).

- [#1045](https://github.com/meocord/meocord/pull/1045) [`d70532c`](https://github.com/meocord/meocord/commit/d70532ca271b8661367b252f8af1cf90c7a13369) Thanks [@l7aromeo](https://github.com/l7aromeo)! - An `onShutdown` hook that awaits `app.stop()`, or a testing module's `close()`, no longer waits for itself. Before, the shutdown under way waited for the hook, the hook waited for the shutdown, and nothing moved until `shutdownTimeout` gave up on the hooks with a warning: the hooks after it then ran after `stop()` had resolved, against a destroyed client, and after a Ctrl+C or a SIGTERM they never ran, as the process exited 0. Now the stop the hook awaits resolves for it at once, the hooks after it run in order, and the shutdown ends with no wait and no warning. This holds whether the hook calls `stop()` before or after its first `await`, or through code it calls, and whether or not it awaits it. The stop it asks for still runs as any stop does: in a shard, it asks the manager to stop every shard. A `stop()` called by work the hook started counts as the hook's while the hook runs; once the hook has returned, a `stop()` from work it left running waits for the whole shutdown, as does a hook awaiting another app's `stop()`. See https://meocord.dev/docs/4.3/lifecycle-hooks.

- [#1025](https://github.com/meocord/meocord/pull/1025) [`cf4932c`](https://github.com/meocord/meocord/commit/cf4932c6087a4cd6722922bed027b24ae1e9686c) Thanks [@l7aromeo](https://github.com/l7aromeo)! - An answer an observer's `onStart` sends through `respond()`, including an error or a component's loading view, now has the server's and user's themes from `@MeoCord({ themeFor })`, as the handler's answers do; it went out in the handler's theme alone. It waits for those themes to be found, so with a slow resolver it goes out later than before, still ahead of the handler's answers; under `@Defer` the acknowledgement does not wait for it and goes first. The resolver is asked where it was, after `onStart` has started; a value it returns, rather than a promise, is applied as soon as it returns instead of a few ticks later, as a theme already cached is, so nothing waits and the calls Discord gets are the same as before. A test asserting the order of what runs after the lookup may notice the earlier settling. `useTheme()` in `onStart` reads the handler's theme until they are found, as the JSDoc of `DispatchObserver.onStart` now says.

- [#976](https://github.com/meocord/meocord/pull/976) [`d0be101`](https://github.com/meocord/meocord/commit/d0be1013aa571b3fae41549305ffda92a82034a8) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `meocord register` and a process-sharding manager now register through your `clientOptions.rest`, as the bot's own requests always have, so a REST proxy, another `api` or a `timeout` set there applies to registration too. A bot that sets no `rest` option registers exactly as before.

- [#1062](https://github.com/meocord/meocord/pull/1062) [`7145a7f`](https://github.com/meocord/meocord/commit/7145a7f439174076b3e0dc420fd82c2678c47b6a) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Two component calls holding one message with `@Defer`'s lock no longer leave it locked wrongly when one finishes as the other locks it. Until now, depending on which edit reached Discord last, the call still running could have its control enabled again with no loading view, letting the user click it twice, or the call that had finished could keep its control disabled until the other one ended. Edits to a locked message now go out one after another, each drawn as the lock stands when it is sent, so the message always shows the calls still holding it. While several calls hold a message, it shows the loading view of the call that locked it last, also once another call releases it.

- [#1051](https://github.com/meocord/meocord/pull/1051) [`04f3c48`](https://github.com/meocord/meocord/commit/04f3c48fb0230e2cc1692481fa2d1688cdcbbaf2) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A production build made on a fresh install starts again. `@rspack/core` 2.3.2 minifies a class that names itself in a static field, such as `static instance = new Registry()`, into code that stops at startup with `ReferenceError: Cannot access '…' before initialization`. discord.js has such classes, so every self-contained build (`bundleDependencies`) stopped there, and so did an ordinary build of an app with such a class of its own. An app installed while `@rspack/core` 2.3.2 was current may hold it in its lockfile beside `@rsbuild/core` 2.3.0 to 2.3.2, so MeoCord now asks for `@rsbuild/core` 2.2, or 2.3.3 and later, which needs `@rspack/core` 2.3.3 or later, where the minifier keeps such a class working. Upgrading and installing is enough: the package manager moves both packages off the broken releases by itself.

- [#1079](https://github.com/meocord/meocord/pull/1079) [`b29df91`](https://github.com/meocord/meocord/commit/b29df91505fdb958ec277c54c4a3b966c536c057) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A MeoCord decorator run as a standard (TC39) decorator now throws at once, naming the decorator, what it was applied to and what to change: set `"experimentalDecorators": true` and `"emitDecoratorMetadata": true` in tsconfig.json. A runtime that strips types without checking them, such as Bun, applies decorators that way when the tsconfig.json it reads doesn't set `experimentalDecorators`. Such a decorator used to warn that it was on a method named `[object Object]` and apply nothing, so the bot failed later, far from the cause; on a method, it threw a TypeError from inside MeoCord. A new app from `meocord create` sets both options already.

- [#975](https://github.com/meocord/meocord/pull/975) [`7cc2b86`](https://github.com/meocord/meocord/commit/7cc2b86d364a42634a8041aadca9a97cb1d72b07) Thanks [@l7aromeo](https://github.com/l7aromeo)! - An observer's `DispatchResult.startedAt` follows the system clock, as its documentation says. It was read from the monotonic clock offset by the process's start, which drifts from the system clock by about half a second a day, and by more after the host sleeps, so a bot that had run for a week reported calls several seconds early. `durationMs` is still measured with `performance.now()`. Nothing to change in your code.

- [#1043](https://github.com/meocord/meocord/pull/1043) [`a31543f`](https://github.com/meocord/meocord/commit/a31543fdc4cc65f8aa2a1d2842436576e9bc5361) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A stopped app no longer asks its theme resolver, and a stop no longer leaves a slow `onReady` warning behind.

  - Once a bot's stop or a testing module's `close()` has ended its shutdown, a theme lookup asks no `themeFor` resolver: an answer outside any call and a testing module's `dispatch()` after `close()` answer in the handler's theme, or the app's outside a call, and nothing is logged for the lookup. The `onShutdown` hooks have closed what a resolver uses by then, and in a test its timeout warning landed in a later test. A start that fails and is retried looks themes up as before.
  - A stop that gives up on an `onReady` still running ends that hook's 10-second slow warning. It used to fire after the stop had resolved, and its timer kept a process with nothing else left alive. A stop that waits the hook out still warns.

  See https://meocord.dev/docs/4.3/lifecycle-hooks.

- [#1040](https://github.com/meocord/meocord/pull/1040) [`a692cda`](https://github.com/meocord/meocord/commit/a692cda2894bbc534ee2f97327422800b7bcc4e4) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A start that `stop()` ends now rejects only once the stop is done with the `onShutdown` hooks of what the start made, and `stop()` resolves after it, on every runtime. Done means the hooks have finished, or `shutdownTimeout` has ended the wait for them. Before, the order came from promise timing: on Node it was usually this one, but on Bun `start()` rejected before the values it made were closed, and on Node too when an `onShutdown` hook awaited anything. Code that awaits `start()` and acts on its rejection now finds what the start made shut down. One start is the exception: one still awaiting a provider's factory when the stop's `shutdownTimeout` wait for it ends. The stop resolves without it, and that start rejects once the factory settles. A `stop()` that an `onShutdown` hook calls while a failed start shuts down what it made joins that shutdown, which closes everything in order before the start rejects; the promise the hook gets resolves at once, as for any hook that stops its own app. See https://meocord.dev/docs/4.3/lifecycle-hooks.

- [#983](https://github.com/meocord/meocord/pull/983) [`691c718`](https://github.com/meocord/meocord/commit/691c718259e8f681d333c629ecb2042c12b4cc3a) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Under `useStrictMocks()`, `MeoCordTestingModule`'s `init({ ready: true })` and `close()` run the lifecycle hooks of a class that only a guard, an interceptor, a pipe, a filter or the presenter injects in the bot's order: its `onReady` after the controllers' and observers', and its `onShutdown` before theirs. Without strict mocks, the order is unchanged. The one change is a warning, once per run, naming the first class whose hooks would run in another order; it is logged only when such a class has the hook that is about to run. MeoCord 5.0 uses the bot's order without the call. See [Mocks](https://meocord.dev/docs/4.3/mocks).

- [#1024](https://github.com/meocord/meocord/pull/1024) [`f462750`](https://github.com/meocord/meocord/commit/f4627504a3ceb879b78d4b8648b3f0f281d40c8f) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `t(key, params)`, `t.default`, `t.locale(l)`, `t.for(…)` and `t.forGuild(…)` take params for a message typed `string`, as in a translator typed `Translator<any>` or typed by hand from a JSON file's shape, and a plural whose forms are typed `string` takes params besides its `count`. Such a call failed to compile, though it fills its params at run time. A translator now also assigns to one typed with a catalog of plurals written by hand, such as `Record<string, { one: string; other: string }>`, whose forms typed `string` take any params beside `count`. Params stay optional for a message typed `string`, and a plural still requires its `count`. `Translator<never>`, as `createTranslator(… as never)` gives, takes any params on any key, where the published types refused the call. So does `Translator<Record<string, never>>`. Neither is a catalog type anyone writes, and every assignment of either, and every reader of their key types, compiles as before. `Translator<Record<string, never>>`, a translator of an empty catalog and one of a union of catalogs that share no key also assign to a translator typed with any catalog, since they take any params; none of the three has a message a call could read. Calls that compiled before still do. `MessageParams` of a message typed `string` is any params, so a type reading `keyof MessageParams<string>` sees `string`. See [Localisation](https://meocord.dev/docs/4.3/localisation).

- [#1051](https://github.com/meocord/meocord/pull/1051) [`ba6da50`](https://github.com/meocord/meocord/commit/ba6da50ab9d03517d0a4225caefaf6aad3f7ae60) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A new app from `meocord create` starts on the latest stable releases of its dependencies and tools that are at least a day old: discord.js 14.28.1, dotenv 18.0.10, `@types/node` 26.6.6, eslint 10.15.0, typescript-eslint and `@typescript-eslint/parser` 8.73.0, prettier 3.10.1, eslint-plugin-import-x 4.18.1 and globals 17.14.0. TypeScript stays at 6.0.3, as typescript-eslint supports no later version, and vitest at 5.1.0, so an app runs its tests on Bun without Node.js. An existing app is unchanged.

- [#1056](https://github.com/meocord/meocord/pull/1056) [`8176265`](https://github.com/meocord/meocord/commit/817626578980720368248eb632250dc556badd25) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A new app from `meocord create` runs its tests on a machine with Bun and no Node.js again. vitest 5.1.1 starts each test worker in a way Bun can't yet run (oven-sh/bun#33593), so `test` and `test:coverage` stopped before any test with `TypeError: child.channel?.unref is not a function`. The template now asks for vitest and `@vitest/coverage-istanbul` at exactly 5.1.0, unlike its other dependencies, which take the latest release. That holds until a vitest release carries vitest-dev/vitest#12039 or a Bun release ships `channel.unref`. An existing app with vitest 5.1.1 can set both packages to `5.1.0` in its `package.json`, or run its tests with Node.js installed.

- [#1058](https://github.com/meocord/meocord/pull/1058) [`e7cebda`](https://github.com/meocord/meocord/commit/e7cebdaeba37a470febe12af89587070e5d15ef1) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A testing module's `close()` called from a call it is running, such as a command handler that awaits `module.close()`, no longer waits for that call. Before, in a module whose cooldown store has an `onShutdown`, the close drained the calls under way, the handler awaiting it among them, so it waited out `shutdownTimeout` less the hooks' reserve, warned `Calls still running after … ms`, and only then ran the `onShutdown` hooks and resolved. Now it leaves that call out, as the bot's `app.stop()` does for a handler that awaits it: the close goes on at once and the other calls still drain. See https://meocord.dev/docs/4.3/testing.

- [#1074](https://github.com/meocord/meocord/pull/1074) [`1cdbd95`](https://github.com/meocord/meocord/commit/1cdbd95c9499828c7e817a7d1d2aa64ea0da96ea) Thanks [@l7aromeo](https://github.com/l7aromeo)! - The declarations of `TestingModule` and `TestingModuleBuilder`, from `meocord/testing`, no longer name the internal types MeoCord makes a module from, such as `ProviderMap` and `LifecycleUnit`. Each constructor parameter is declared `unknown`, so your editor's hover shows none of them. Nothing stops compiling: code that calls `new` on either class, extends it or passes it as a constructor type compiles as before. The constructors stay undocumented: make a module with `MeoCordTestingModule.create(…).compile()` or `MeoCordTestingModule.fromApp(…).compile()`. See https://meocord.dev/docs/4.3/testing.

- [#1074](https://github.com/meocord/meocord/pull/1074) [`ff1485b`](https://github.com/meocord/meocord/commit/ff1485b364cdd6ddc387eb4e9c2ef53a118d01bf) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A testing module closed during `init({ ready: true })` now runs the `onReady` and `onShutdown` hooks as the bot does when it stops before or during its ready hooks. Once `init({ ready: true })` is asked, `close()` lets no further `onReady` start, and runs no `onShutdown` for a unit whose `onReady` hasn't settled when `close()` lists what it shuts down, such as one still running or one that never started because `close()` came first, nor for anything that depends on it. A unit whose `onReady` failed has settled and is shut down. Before, the module went on with the `onReady` hooks after `close()`. Once `close()` stopped waiting for them, at its `shutdownTimeout` less the hooks' reserve, it ran `onShutdown` for every unit it had made, one still in its `onReady` included, and the units the later hooks made had nothing to shut them down. A `close()` before the hooks started, while `init()` made the providers, waited for every factory, then did the same. A test that calls `close()` before the `onReady` hooks finish now sees the bot's shutdown: if it expected the later hooks to run, or a unit whose `onReady` hasn't settled to be shut down, await `init({ ready: true })` before `close()`. Without `init({ ready: true })`, nothing changes: `close()` still shuts down every unit the module made. See https://meocord.dev/docs/4.3/testing.

- [#976](https://github.com/meocord/meocord/pull/976) [`379365f`](https://github.com/meocord/meocord/commit/379365ffad6b63ff887c06f912310aad6863489d) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `meocord/testing` no longer loads `cli-table3`. A test file that imports the testing toolkit loads only what testing needs, so a test environment that bundles or stubs its dependencies, such as an in-browser sandbox, works without `cli-table3`, which only the startup table of registered commands uses.

- [#1024](https://github.com/meocord/meocord/pull/1024) [`1ba4a77`](https://github.com/meocord/meocord/commit/1ba4a7781761658da54c0319137ed68aa688323c) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A `Translator` injected without its catalog type, as `constructor(private readonly t: Translator)`, still translates no key, and its compile error now says what to write: "This Translator has no catalog type: type it as Translator<typeof enUS>, with your default catalog, to translate with it". It said "Expected 2 arguments, but got 1." for a key alone in `t.default`, `t.locale(l)`, `t.for(…)` and `t.forGuild(…)`, and "… is not assignable to parameter of type 'never'" for `t.localizations` and for a key given params. Every method that takes a key gives that sentence: `t.default`, `t.locale(l)`, `t.for(…)`, `t.forGuild(…)` and `t.localizations`. Such a translator passes on as before, as to `translateError`, and typed translators assign to and from it as before. `MessageKey` and `LocalizationKey` of `CatalogShape`, a bare `Translator`'s catalog type, or of an index signature with no keys that takes any catalog, are that sentence instead of `never`. See [Localisation](https://meocord.dev/docs/4.3/localisation).

- [#1019](https://github.com/meocord/meocord/pull/1019) [`527f4e8`](https://github.com/meocord/meocord/commit/527f4e802f8a366df0ee4bfa3070be09c8df4468) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `useMockFn()` now always refuses once a mock has been made, whether or not that mock is still in use. Before, a mock made before it and then dropped made it throw until the garbage collector took the mock, and pass after, so the same setup could pass on one run and fail on the next. If a setup file throws `useMockFn() goes before any mock is made`, move the call ahead of anything that makes a mock, such as a helper that builds a mock interaction when it is imported: call `useMockFn()` first, in the test runner's setup file. See [Mocks](https://meocord.dev/docs/4.3/mocks).

## 4.2.3

### Highlights

- **Stopping during startup is clean.** A Ctrl+C, SIGTERM or `app.stop()` before the bot is online exits 0 (your own `app.stop()` once `main.ts` is updated, see Upgrading) and closes what the startup made, such as a connection pool a provider opened. A start that fails closes what it made too, so the process can end ([docs](https://meocord.dev/docs/4.2/lifecycle-hooks)).
- **`@On` and `@Once` reach every instance the app makes,** including a service only a guard or the presenter injects, a provider's `useClass`, `useValue` or `useFactory`. They were never attached there ([docs](https://meocord.dev/docs/4.2/gateway-events)).
- **Clearer message command replies.** The usage reply names the word a message left out or got wrong, quotes it as typed, and a pattern's own `--word` is matched where the pattern has it ([docs](https://meocord.dev/docs/4.2/message-commands)).
- **Mocks closer to discord.js.** Mocks fill in more of what Discord always sends, in both modes, and `useStrictMocks()` covers about twenty more behaviours that 5.0 makes the default. Upgrading your tests, below, lists them ([docs](https://meocord.dev/docs/4.2/mocks)).
- **One process, two builds.** A bot whose dependencies load both MeoCord's ES module and CommonJS builds shares one theme, one shutdown, one set of warnings and one exit code between them.

### Upgrading from 4.2.2

- **`main.ts` and exit codes.** A stop during startup now exits 0, and a built bot exits 1 when `MeoCordFactory.create` refuses its app. New apps' `main.ts` sets the exit code only for an error MeoCord didn't explain. In an existing app, have the catch in `src/main.ts` return early for `isExplainedError(error)`, from `meocord/common`, before it logs and sets `process.exitCode = 1`, or an `app.stop()` of your own during startup still exits with your catch's code ([docs](https://meocord.dev/docs/4.2/lifecycle-hooks)).
- **`onShutdown` runs on a stop during startup,** for each class and provided value that was made and whose `onReady`, and that of everything it depends on, has finished or doesn't exist. If an `onShutdown` of yours assumed `onReady` had run, give the class an `onReady`, or guard the hook. A failed start closes what it made by the same rule; a `useValue` value stays open until the bot stops. A stop while a failed start shuts down waits for it, within one `shutdownTimeout` ([docs](https://meocord.dev/docs/4.2/lifecycle-hooks)).
- **`@On` handlers that never ran now run,** on a service only a stage or the presenter injects and on provided instances. Check what they do before upgrading. Handlers of one event attach in lifecycle order, so two listeners of one event can swap ([docs](https://meocord.dev/docs/4.2/gateway-events)).
- **`@On('interactionCreate')` stages get no `context.response`.** A guard, interceptor or filter there that answered through it should answer through `context.getInteraction()`; MeoCord also dispatches that interaction to its handler.
- **A message command that works only in a server,** by its `scope`, a `member`, `role` or `channel` param, or such a required flag, answers a DM that starts with a prefix or mention with "This command works in a server only." whatever words it gives, and gives no reply to one without. One with no such param and only optional such flags is listed in a DM's help, and `HandlerRegistry` gives it `scope: 'any'` ([docs](https://meocord.dev/docs/4.2/message-params)).
- **Observer durations for message and reaction handlers** start when dispatch received the message or reaction, as for interactions, so a listener that waited behind another one reports that wait ([docs](https://meocord.dev/docs/4.2/observers)).
- **Guards and observers, as now documented.** A guard with `types: ['interaction']` doesn't run before `@Autocomplete` handlers; declare `types: ['interaction', 'autocomplete']` to run it there. `deniedBy` also comes with `outcome: 'error'` when the answer to a denial fails to build, so an observer that counts denials checks `outcome` too ([docs](https://meocord.dev/docs/4.2/guards)).
- **New startup warnings to act on.** A missing `clientOptions.partials` entry that an `@On` handler's event needs now names the partial to add; without it, discord.js drops the event. `app.registerCommands()` before the bot is online says why it registers nothing; run `meocord register` instead.
- **`meocord start --prod` and `register` exit 128 plus the signal** when the bot is killed by one the CLI didn't pass on, such as 137 for SIGKILL, where `start --prod` exited 0. A process supervisor now sees the crash ([docs](https://meocord.dev/docs/4.2/cli)).
- **A referenced TypeScript project's files** resolve imports through the root `tsconfig.json`'s `paths`, not their own. A bot that references another project builds now; one that relied on a referenced project's own `paths` moves them to the root ([docs](https://meocord.dev/docs/4.2/project-structure#imports)).

### Upgrading your tests

- **More behaviours under `useStrictMocks()`.** Each warns in default mode and becomes the default in 5.0. Call `useStrictMocks()` in your test setup to see your suite's results under them now ([docs](https://meocord.dev/docs/4.2/mocks)):
  - an autocomplete's `respond()` a test set marks it `responded`, a second one is refused, and `getResponse()` reports it as `'replied'`;
  - `launchActivity()` and `sendPremiumRequired()` count as the first answer, and `update()` on a modal submitted from a command is refused;
  - `followUp()` and `editReply()` mark the interaction `replied` once they land;
  - an autocomplete's entity options read as ids, `getMentionable()` returns the member in a server, and the focused option is read by name;
  - a user context menu's `targetMember` is its `targetUser`'s member;
  - `client.users.createDM()` gives each user their own DM channel, on the user's client, and `client.users.send()` resolves to the message sent;
  - `guild.channels.create()` makes the type named, `create()` and `edit()` apply `name`, and `edit(id)` resolves to that item;
  - a thread made by a channel's thread manager puts that channel in its server's `channels.cache`, a channel's `messages.cache` holds the messages made or sent in it, and `messages.fetch()` with no id lists them, newest first;
  - a member's `joinedTimestamp` and a client's `readyTimestamp` are when the mock was made;
  - a testing module without a presenter answers with the default on a client another module used, and `emit()` sets the module's presenter, theme and translator on the client;
  - `dispatch()` reports a call whose answer can't be built once, as `'error'`, and `invoke()` runs an unrouted `@On` handler as an `'event'`;
  - `compile()` refuses an app whose own providers give `Client`, `CooldownStore`, or `Translator` with `i18n`, as the bot does;
  - `inspectHandler()` lists only the guards, interceptors and observers dispatch runs for the handler's context types, and its `inheritedRoutes` names an inherited `@On` or `@Once` event;
  - `resolveRoute` reads a message without `dm` as sent in a server, and returns `undefined` with `dm: true` for a command that works in servers only.
- **Mocks fill in more of what Discord sends, in both modes.** A component interaction has the bot's message holding its component, a modal has empty `fields`, a user's `dmChannel` and its `recipient` are set, a mock given only a `guildId` reads a placeholder server with that id, `messages.fetch(id)` finds a message made with that id, and channel types, display colours and `roles.resolve()` read as discord.js gives them. Promise-returning mock methods such as `member.kick()` resolve. A test that asserted a placeholder there sees the real value ([docs](https://meocord.dev/docs/4.2/mocks)).
- **The testing module matches the bot more closely.** `init()` makes the app's presenter, after the providers; `close()` shuts down what it injects. `overrideProvider(ShardContext)` and `overrideProvider(HandlerRegistry)` replace MeoCord's binding. An app providing `HandlerRegistry` or `ShardContext` is refused at `compile()` with the bot's message ([docs](https://meocord.dev/docs/4.2/testing)).
- **Routing in tests.** `invoke()` checks an autocomplete against the `@Autocomplete` handler it names, warning in default mode and rejecting under `useStrictMocks()` where dispatch would pick another. A controller replaced with `overrideProvider(Controller).useValue(stub)` now gets its autocompletes. `dispatch()` of a mock message made without `content` runs no handler, where it threw ([docs](https://meocord.dev/docs/4.2/invoke-and-dispatch)).
- **Changed texts and types.** `fromApp()`, `resolveRoute()` and `findRouteConflicts()` name an `undefined` or module-namespace app, often a circular import, where each threw an empty `TypeError`. `invoke` on a patterned `@MessageHandler` with an empty message says to give the mock content; `respond()`'s dropped-flag warning and the theme refusal reword their advice. `ResponseCall['method']` gains `'respond'`, `'launchActivity'` and `'sendPremiumRequired'`, and `MockResult['type']` gains `'incomplete'`, so an exhaustive `switch` gains those cases ([docs](https://meocord.dev/docs/4.2/invoke-and-dispatch)).

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

### Fixes to 4.2.2 behaviour

- **Running the bot**
  - A failed start is no longer among the apps a signal stops, so a later Ctrl+C stops only the running ones.
  - With process sharding, `stop()` during the start ends it: a registration already sending the commands finishes, nothing more asks Discord, no shard is spawned, and `start()` resolves; a failed shard-count request no longer exits the process.
  - A controller whose constructor throws fails only its own handlers; other controllers' message and reaction handlers still run, and the error goes to the filters.
  - One method with `@Command`s of two interaction types, such as a slash command and a button, runs for each route, including an override that adds a route type and calls its base method through `super`; it threw.
  - A subclass that re-declares `@On` or `@Once` for the same event runs once per event, not twice.
  - A `Translator` given through `@MeoCord({ providers })` is accepted wherever it sits in the list.
  - `@Inject` on a method parameter is refused with MeoCord's message, naming the method, not inversify's.
  - With both builds loaded, one shutdown and one pair of signal listeners stop every app, a failed shard ends once, and a later login clears an earlier failed login's exit code.
- **Message commands**
  - The usage reply names the word a message left out or replaced, such as `close is missing`, and a missing required flag beside it, such as `--in is missing`, and quotes a word with its spaces as typed. With no reason MeoCord has a text for, it's the usage line alone.
  - A pattern's own word starting with `--`, such as `--force` in `deploy --force {env} {--dry}`, is matched where the pattern has it.
  - A refused pattern names the rule it breaks and quotes its params as written.
  - `!"help" mute` answers as `!help mute` does.
  - A `{name:duration}` too long to add up is a usage error, not `Infinity`; `number` and `duration` words are read in time linear in their length.
  - A pattern over 16 words type-checks the handler's params past the sixteenth.
  - A param or flag named like an `Object` member, such as `{__proto__}`, `{constructor:int?}` or `{toString?}`, is its own key in the handler's params; `{__proto__:int}` and a left-out `{constructor:int?}` threw on every message.
  - `@MeoCord({ controllers })` is typed as a list of classes, so a string or symbol there is a type error rather than a stop at startup.
- **Components**
  - The warning about a customId param that shares a name with a modal field or choice is given per handler, as `Controller.method`.
  - A component pattern whose shortest customId is over 100 characters is warned about, counting each typed param's shortest value.
  - `{café}` in a customId pattern is literal text in the types, as at runtime, so `build({ café })` no longer compiles and then throws.
- **Themes and translations**
  - A call keeps its theme for its whole run when another app in the process claims the theme outside calls.
  - `@On('messageReactionAdd')`, `messageReactionRemove` and other events about a `User` run with that user's `themeFor.user` theme.
  - A `themeFor` result that throws while being read is left out with a warning and cached, rather than failing every call.
  - A translation is read by the default catalog's shapes, so a group with an `other` message isn't taken for a plural, while plural forms given for a plain default message are still read as plurals; an empty translation of MeoCord's own text falls back to English.
  - `expectCompleteCatalog` reports a `null` translation as missing, where it threw.
- **Cooldowns**
  - A built-in store's `consume()` refusal carries `retryTimestamp`, so a custom store built on it no longer DMs a cooldown twice in one wait.
  - A `ShardedCooldownStore` verdict's `release()` undoes its call once, however often it's called.
  - `testCooldownStore` passes a correct store built from the other module format.
- **Logging**
  - Log lines escape U+061C, U+200E and U+200F in text a user wrote, as they escape other bidirectional controls.
- **Builds and the CLI**
  - An `externals` pattern with the `g` or `y` flag keeps every matching import out of the bundle.
  - With `bundleDependencies`, `os`, `cpu` and `libc` are read as npm reads them, and the bot registers its commands in the mode the `meocord` command runs in.
  - `build` reads `tsconfig.json` as `tsc` does: `extends` on Windows or naming a package, `${configDir}` in `baseUrl`, and `references` now build. One the CLI can't read is reported as `tsconfig.json`.
  - A `tsconfig.json` or `package.json` with a UTF-8 byte order mark is read.
  - A runtime that can't be started is reported and exits 1, not an unhandled error.
  - A config that fails to load is told whether it can't be parsed or its own code threw, on Node and Bun alike; a leftover `webpack` hook gets one message.
  - On Bun, a `.env` value Bun expanded is no longer passed to the bot as a shell variable, so `start --dev` picks up edits to it.
  - `start --dev` runs reloads one at a time, and with `bundleDependencies` no longer runs packages a previous `build` packed.
  - Every `meocord` command prints its help after a usage error.
  - A new app from `meocord create` starts on the latest stable releases of its tools that are at least a day old, such as vitest 5.0.4, eslint 10.12.0 and typescript-eslint 8.71.2; TypeScript stays at 6.0.3, the newest typescript-eslint supports.
  - The package lists `discord-bot-framework` and `discord-framework` among its npm keywords.
- **Testing**
  - `createMockFn`'s `mock.results` follows call order for a call that calls the mock again inside it.
  - Without strict mocks, a mock channel without a server reads its permissions as `undefined` with a warning, where `permissionsFor()` threw.
  - A mentioned channel or role in a mock message is a full mock of the message's server.
  - `HandlerRegistry.messageHelp()` lists only controllers' message commands from the start.
  - The startup warning about a handler on a class that isn't a controller covers every class the app makes, in the testing module too.
  - Default-mode warnings stay quiet when MeoCord itself reads a mock to answer, such as a mock's `guildId` for the reply or a DM channel MeoCord sends a cooldown DM through.
- **Documentation**
  - `Jsonified` and `ShardContext.call` say an object arrives with its own fields only: JSON leaves a class's getters out. Return a plain object, or give the class a `toJSON`.
  - `sourceMappedStacks` says what it maps under Bun: `error.stack`, and so every trace the `Logger` prints, not what Bun prints itself.
  - `ExecutionContext.getMessage()` says it reads an event's first argument when that is a message: for `@On('messageUpdate')`, the message as it was before the edit. A reaction event returns `undefined`.
  - `createMockGuild()` says what the `@everyone` role may do in each mode: nothing by default, and a new server's permissions under `useStrictMocks()`.
  - `MessageParamTypes`' `role` says an optional `role` param that another optional param follows takes a mention or an ID, not a role's name. Ask for a mention or an ID, or move the role param to the end.
  - `resolveRoute`'s `dm` says dispatch answers a server-only command in a DM with "This command works in a server only." when the message used a prefix or a mention, and with nothing otherwise.

### Security

- **A handler a subclass overrides keeps its base method's guards and other method-level stages** ([GHSA-r9qr-grw6-8jpx](https://github.com/meocord/meocord/security/advisories/GHSA-r9qr-grw6-8jpx)). In 4.1.0 to 4.2.2, a controller or service subclass that overrode a decorated handler method kept the base method's route but lost its method-level stages. A base `@UseGuard` didn't run for the subclass's route, so the handler ran for users the guard was meant to refuse, and the base method's `@Cooldown`, `@Defer`, `@UseInterceptor`, `@UseFilter`, `@UsePipe` and `@Validate` didn't apply either. This happened whether or not the override had decorators of its own. In 4.0.x, the override's own body ran without the base guard, though a `super` call into the base method still ran it. Class-level and global stages were never affected.
  4.2.3 runs the base method's stages for an override, base first, with the override's own added after them, on dispatch and on a direct call. Only a bot that extends a controller or service and overrides one of its decorated handlers is affected. Upgrade; until then, repeat the base method's decorators on the override, or move the guard to the base class with a class-level `@UseGuard`, which subclasses inherit.
- **Other behaviour the fix brings.** An override's own `@UseTheme` goes over the base method's, and its own `@Validate` or `@Defer` takes the place of the base method's; when the override calls `super`, each guard still runs once per call. A direct call to an `@On` or `@Once` handler runs its guards for the `'event'` context type, as dispatch does, so a guard's `types` decide the same way for both. A handler a service declares runs the class-level guards of the classes it extends on a direct call, as a controller's does.

## 4.2.2

### Patch Changes

- [#658](https://github.com/meocord/meocord/pull/658) [`e67cd51`](https://github.com/meocord/meocord/commit/e67cd51a6fdef4a21f1db6541e54b2bb421fbeb1) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A button, select menu or message modal whose guard returns `false` is now acknowledged invisibly, with or without `@Defer`, so the user no longer sees "This interaction failed". The call still reports `ran: false`, and observers still see the outcome `'denied'`. A command, and a modal opened by a command, are left as they were: their only acknowledgement is a reply of their own.

  A test that expects `getResponse(interaction).calls` to be `[]` after a denied click now sees `['deferUpdate']`, as a test of a handler with `@Defer` already did.

  A guard that answers the click itself before returning `false` should await that answer. A reply still on its way when the guard returns races the acknowledgement, and Discord refuses whichever comes second, possibly the reply.

  An app with both a route and a collector for one customId, where the guard returns `false` so the collector answers the click, should leave the click to one of them. Otherwise the two acknowledgements race, and the collector's can fail with "already acknowledged".

- [#653](https://github.com/meocord/meocord/pull/653) [`fcd7cbf`](https://github.com/meocord/meocord/commit/fcd7cbf703618541ff3f42497254cfa33b729939) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `warnUnanswered` now names an `@Autocomplete` handler that returns without calling `interaction.respond()`, as it names any other handler that leaves its interaction unanswered. The user sees the autocomplete options fail to load in that case. The warning is shown once per handler: under `meocord start --dev`, and in tests whose app sets `warnUnanswered: true`. `@MeoCord({ warnUnanswered: false })` turns it off. Nothing about the answer itself changes.

- [#656](https://github.com/meocord/meocord/pull/656) [`b951297`](https://github.com/meocord/meocord/commit/b9512974067160eddb0029a69e52ff228ba36e76) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `bindTheme`'s documentation now says that a bound function runs in the whole theme of the call that bound it, the server's and user's themes included. Every later call, such as another member's click on a collector, is answered in the starting member's theme. Its example comment said "the handler's theme", which left that out. Nothing about the behaviour changes.

- [#652](https://github.com/meocord/meocord/pull/652) [`f8369b6`](https://github.com/meocord/meocord/commit/f8369b6e556ab317331ca70a14a093a0dbc4af2d) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A catalog group whose keys include `other`, such as `reasons: { spam: 'Spam', other: 'Other' }`, is read as a group, as the types and `expectCompleteCatalog` read it. Reading the group's own key, `t('reasons')`, shows the key, and in development logs the warning, as any other group does, where it showed the `other` text. Only untyped code, such as code reading a JSON catalog, can make that call; to show the text, read `t('reasons.other')`. A plural is an object whose every key is a plural category, and a translation's plural without an `other` form still falls back to the next catalog.

- [#659](https://github.com/meocord/meocord/pull/659) [`e9d25a4`](https://github.com/meocord/meocord/commit/e9d25a4bd27bf1e3adaa0506c1b165e8fe6ff20c) Thanks [@l7aromeo](https://github.com/l7aromeo)! - The built-in `help` reply over 2,000 characters is now split into messages Discord shows as written:

  - A line longer than a message is cut after the last whole character that fits. An emoji, a flag, a joined emoji or a letter with its accent is no longer split across two messages.
  - A message that would be only whitespace isn't sent. Discord refused it as empty, and the rest of the reply was lost with it.

  A help text with no long line and no blank stretch at a cut is split as before.

- [#665](https://github.com/meocord/meocord/pull/665) [`1a224e8`](https://github.com/meocord/meocord/commit/1a224e89d747b1dc0a29858f5bae8969d8657091) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Under `useStrictMocks()`, a mock interaction is marked `replied`, `deferred` or `responded` once its answer resolves, as discord.js marks it after Discord takes the answer, rather than when the answer is called. Code that doesn't await an answer now fails in a test as it would on a bot:

  - an `editReply()`, `followUp()` or `deleteReply()` made before the first answer resolves rejects with `InteractionNotReplied`;
  - a second answer sent while the first is in flight passes discord.js's check and is refused with Discord's 40060, unless the first one failed;
  - `replied`, `deferred`, `responded` and `ephemeral` read in the same run as an un-awaited answer are as before it.

  This catches overlaps within one synchronous run of the test's code. A mock answer resolves on the next microtask, so an answer still in flight across an `await`, as a guard's `void interaction.reply()` followed by `return false` is on a bot, isn't caught.

  In both modes, an answer that fails no longer undoes an answer made after it. A test could make the first of two un-awaited replies reject, and the interaction then read as unanswered though the second reply went through; it now reads as answered by the second. A failed answer's change is undone once every change after it is undone too, so an interaction whose answers all fail still reads as unanswered.

  In default mode the flags are still set at the call. The first time an interaction does what a bot would refuse, an edit or a second answer while its first is in flight, a warning says what the bot would do. In the next major version (5.0), every mock interaction marks its answers when they resolve, as strict mocks do now.

- [#663](https://github.com/meocord/meocord/pull/663) [`3894f77`](https://github.com/meocord/meocord/commit/3894f77b099bc2bb82bed37b43944f9e6dc09feb) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Under `useStrictMocks()`, a mock interaction's `ephemeral` is `null` until `reply()` or `deferReply()` decides it, as discord.js has it; `update()` and `deferUpdate()` leave it `null`. In default mode it still reads `false` before an answer, and a test reading it there logs a warning once. MeoCord's own reads while it answers log nothing. The next major version (5.0) reads `null` without the call.

- [#651](https://github.com/meocord/meocord/pull/651) [`8a56464`](https://github.com/meocord/meocord/commit/8a56464a42c47bddc3959bddc0748a710f656ffd) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A mock guild's `emojis`, `stickers`, `scheduledEvents`, `autoModerationRules` and `invites` are managers, in both modes, as on a message's guild. Before, calling `create()`, `fetch()` or `cache.get()` on one threw a `TypeError`.

  - `create()` resolves to a mock emoji, sticker, scheduled event or AutoMod rule in the guild, and caches it, as discord.js does.
  - `invites.create(channel)` resolves to an invite for that channel in the guild, keyed by its `code`, and caches nothing, as discord.js does.
  - `fetch(id)` resolves to the cached item, or makes and caches one; a list fetch resolves to an empty collection.
  - Each item is named, and what discord.js formats from it computes: an emoji's mention (`String(emoji)`) and `identifier`, and a scheduled event's and an invite's `url`.

- [#657](https://github.com/meocord/meocord/pull/657) [`8d1d3fc`](https://github.com/meocord/meocord/commit/8d1d3fc6eb0d4f59139ffc3033b1c416a507f804) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `MockedFunction`'s and `MockInstance`'s documentation says what their types check: calling a mock is checked against the function it mocks, and the values its mock API takes and records, such as `mockResolvedValue`'s and each of `mock.calls`' arguments, are not, for any function. A partial fake such as `guild.members.fetch.mockResolvedValue({ id })` type-checks. Types are unchanged.

- [#654](https://github.com/meocord/meocord/pull/654) [`1cc5a4f`](https://github.com/meocord/meocord/commit/1cc5a4fd2243ff00be9ae3d89b389f11df3b337c) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Wherever MeoCord takes a class and is given something else, it now refuses the value and names where it was given, instead of crashing with an empty `TypeError` or reporting "This is a bug in MeoCord". TypeScript already rejects these values, so the refusal matters for plain JavaScript, `any` and casts.

  - **`@MeoCord`'s `presenter`, `cooldownStore`, `controllers` and `services`** refuse an object or a function that isn't a class where the app is declared, for example `App: @MeoCord({ presenter }) takes a class implementing ResponsePresenter, not an object.`
  - **A service listed by a string or symbol token** that no provider provides is refused as the app is created, naming the token.
  - **Stage entries** given to `@UseGuard`, `@UseInterceptor`, `@UseFilter`, `@UsePipe` and `@MeoCord({ guards, interceptors, filters })` refuse an arrow function, a method, an async function or a generator function: "a function is not a class". A `function` declaration still works as a class.
  - **`@Catch`** warns about an arrow function, as it already does for any other value that isn't a class, and treats it as matching no error. Before this fix, every call whose error reached that filter rejected with a `TypeError` from `instanceof`. A bound error class still matches.
  - **A testing module** refuses a controller or an observer that isn't a class, and reports the refusal together with the other startup errors. After `reportAllStartupErrors()`, `fromApp()` on an app whose `@MeoCord` was refused throws the reason, not "is not a `@MeoCord` app".

  A bot that started before starts unchanged.

## 4.2.1

### Patch Changes

- [#577](https://github.com/meocord/meocord/pull/577) [`2b4be88`](https://github.com/meocord/meocord/commit/2b4be88ac101c24e1da1e6cf290e547f76c0a0a1) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Catalog checks read a catalog's own keys and shapes, and a refused builder says what is wrong with a name:

  - `expectCompleteCatalog` reads a group with an `other` key, such as `reasons: { spam, offTopic, other }`, as a group, as the translator's types do. It no longer fails a correct catalog for "lacking" plural forms, and it reports a key such a group misses in a locale.
  - `expectCompleteCatalog` reads only a catalog's own keys, so a missing key named `constructor` or `toString` is reported. It also reports a translation of another shape than the default's, a text for a plural or the reverse, as `n should be a plural, as the default is`.
  - A key with a `.` in its name, such as `'ban.done'`, is never found, because a lookup reads it as a path. `createTranslator` now warns about each one, naming the locale and the key, and `MessageKey`, `StringMessageKey` and `LocalizationKey` leave it out, so using one fails to compile. Nest it as a group: `ban: { done: … }`.
  - `LocaleCatalog<C>` takes a `meocord` group with your translations of MeoCord's own texts, as `createTranslator` does.
  - A builder refused for a name gives Discord's rule for one: letters, numbers, `-` and `_`, lowercase where the script has case, without spaces, up to 32 characters, in every locale.

  A catalog test that passed with a gap of these kinds can now fail and name it. See [Localisation](https://meocord.dev/docs/4.2/localisation).

- [#620](https://github.com/meocord/meocord/pull/620) [`4e395ac`](https://github.com/meocord/meocord/commit/4e395acf4659e30653fe9107cc24598efdc16767) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A testing module asked to `dispatch`, `invoke` or `emit` after `close()` now warns once that it is closed and its services are shut down, or shutting down, including while `close()` is still running. It still runs the call, as before. A misplaced `close()`, such as one in `afterEach` that runs before a test's last call, shows instead of passing quietly on that state. See [Testing](https://meocord.dev/docs/4.2/testing).

- [#605](https://github.com/meocord/meocord/pull/605) [`33d724b`](https://github.com/meocord/meocord/commit/33d724b13fc3a3d4e51be89c1ded7288cdf0009d) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `@Command` warns, naming the handler, about a component pattern no customId can match: one that is empty, or whose shortest customId is over Discord's 100 characters. Such a handler never runs; the bot still starts. `route('').build()` throws a RangeError, as it does for an id over 100 characters, rather than returning an empty customId Discord refuses.

- [#595](https://github.com/meocord/meocord/pull/595) [`cdb8dcf`](https://github.com/meocord/meocord/commit/cdb8dcf51fa6a9b16eb98eb73b94b912e0108ffe) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `meocord start --dev` checks a saved `meocord.config.ts` as startup does: a config with options of the wrong type, or one that fails to load, is reported once, with every problem, and the running bot is left as it is, rather than starting with that config and failing later. A config that exports only named values is refused with "it must export an object as its default export", naming what it exports, instead of a warning for each export. A config that throws as it loads, such as for a variable it requires, is reported with the line in `meocord.config.ts` it threw at, and a built bot whose config throws says to check the environment it reads, rather than to rebuild.

- [#599](https://github.com/meocord/meocord/pull/599) [`e3c727a`](https://github.com/meocord/meocord/commit/e3c727a2d82d2fb96a05df7268c1b1af2373b6a2) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A controller listed twice in `@MeoCord({ controllers })` or `MeoCordTestingModule.create({ controllers })` is one controller: its `@MessageHandler()` listeners run once per message, and its reaction handlers once per reaction, where they ran twice. Commands and components were already routed once.

- [#598](https://github.com/meocord/meocord/pull/598) [`585c076`](https://github.com/meocord/meocord/commit/585c076dedcc91bef09198de93538457d82cf625) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A cooldown's `by` may return any string, one holding half of an emoji included, such as text cut short with `slice`. Such a value made the call fail with "URIError: URI malformed" before the handler ran; it now counts under a key of its own. Every value that worked before keeps its key, so running cooldowns carry on across the upgrade.

- [#598](https://github.com/meocord/meocord/pull/598) [`585c076`](https://github.com/meocord/meocord/commit/585c076dedcc91bef09198de93538457d82cf625) Thanks [@l7aromeo](https://github.com/l7aromeo)! - With `dmOnCooldown`, a cooldown counted per server, per channel or globally tells each author it refuses once per wait, as `per: 'user'` already did. Only the first author refused in a wait was told, and the rest were refused without a word.

- [#579](https://github.com/meocord/meocord/pull/579) [`4aba54d`](https://github.com/meocord/meocord/commit/4aba54dbde09e78c40d9bf9338eee377930f3760) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `@Cooldown` now warns, naming the handler, when it is given a `bypass` that is not a function, such as `true`, which fails every call it counts, or a `seconds` that is not a number, such as `'5'`, which it reads as one. Both get past the types only from JavaScript or through a cast. They still decorate as before, and the next major version (5.0) refuses them; give `bypass` a function and `seconds` a number to silence the warning. A `bypass` of `false` or `null` still means none.

- [#581](https://github.com/meocord/meocord/pull/581) [`150e174`](https://github.com/meocord/meocord/commit/150e174f39787e3440605693aa99d56fc2a801c4) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `testCooldownStore` now catches three ways a store can break the cooldown contract:

  - a `release` that frees the key's other calls too, which resets a user's cooldown whenever `@Cooldown` gives back a call;
  - a batch refusal that names the first cooldown to refuse rather than the longest wait, which tells users to retry too soon;
  - a wait counted from the oldest call in the window, rather than from the oldest of the newest `uses` calls, after a limit is lowered.

  A store that keeps the contract passes as before. A store that gets one of these wrong now fails its own suite run, naming the case. See [Cooldown stores](https://meocord.dev/docs/4.2/recipes/cooldown-stores).

- [#588](https://github.com/meocord/meocord/pull/588) [`27b03a5`](https://github.com/meocord/meocord/commit/27b03a58d1b22a3adaf802f67a6e2993f1fe6673) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `meocord create` folds accented letters into the app's folder and package name instead of dropping them: "Café Bot" gives `cafe-bot`, where it gave `caf-bot`, and "Straße" gives `strasse`. A name with no Latin letters or digits, such as one written only in another script, is refused with a message that says it needs Latin letters or digits.

- [#612](https://github.com/meocord/meocord/pull/612) [`9cb5e9e`](https://github.com/meocord/meocord/commit/9cb5e9e3d563a0919c62855c02dd3ee4d7692b0f) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `respond()` keeps track of which message is the answer, so it no longer edits or deletes a reply that is gone, which Discord refused with 10008 (Unknown Message):

  - After `delete()`, `send()`, `edit()`, an error answer and `followUp()` send a follow-up, which becomes the answer that later `send()`, `edit()` and `delete()` act on. A follow-up that takes the place of an edit is private when the deleted answer was, unless the payload sets `flags`. `message` is `undefined` until something is sent, and a second `delete()` with nothing sent since throws.
  - After a private `followUp()` on a public deferral, which deletes the deferral, the follow-up is the answer: `send()` and `edit()` edit it, `delete()` deletes it, and `message` is it.

  A test that expected `editReply` in these sequences now sees a `followUp`, or an edit of the follow-up by its id.

- [#571](https://github.com/meocord/meocord/pull/571) [`e9fc8bc`](https://github.com/meocord/meocord/commit/e9fc8bcd331271ee564f1467daf06cae363b079e) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `meocord start --dev`, `register --dev` and `build --dev` run as development whatever `NODE_ENV` the shell holds, as their help and the [CLI guide](https://meocord.dev/docs/4.2/cli) say. With `NODE_ENV=production` set in the shell, `start --dev` loaded the config from the production `.env` files, so a token kept only in `.env.development` was reported missing, and `register --dev` registered the commands as production does rather than to `commands.developmentGuild`. `--prod` still keeps a `NODE_ENV` the shell sets.

- [#583](https://github.com/meocord/meocord/pull/583) [`0b4be9c`](https://github.com/meocord/meocord/commit/0b4be9cecf42b7798fb46d2c96a3e9fa543020e4) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A direct call on a controller, `module.get(Controller).method(interaction)`, runs its guards in the testing module that made the instance. With two modules compiled from one controller, a direct call on the first ran the second module's guard stubs, services and container, since the last compiled module was the only one recorded on the class. A bot has one container, so nothing changes there. See [Testing](https://meocord.dev/docs/4.2/testing).

- [#585](https://github.com/meocord/meocord/pull/585) [`5cfb77d`](https://github.com/meocord/meocord/commit/5cfb77dca37858f6be1dd8261f2c67ea7f38e7e8) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A built bot now loads its packages after its config, and so after `.env`: a package that reads `process.env` as it loads, in a build without `bundleDependencies`, gets the values `.env` sets, as a self-contained build already gave it. A package kept out of the bundle loads where the code importing it runs: an ESM `import` is a dynamic `import()`, and a CommonJS `require` stays a `require` at its call site. A package listed in `externals` that a dependency requires inside a `try` therefore no longer stops the bot at startup when it is missing; an ESM import of one still does.

  A self-contained build started on another platform stops with MeoCord's message naming both platforms, before any native addon loads, instead of the addon's own error. The message is now printed before the bot's logger is set up, as a plain `[ERROR] [MeoCord]` line.

  A build without `bundleDependencies` removes the `node_modules`, `package.json` and `meocord.platform.json` a previous self-contained build left in `dist`, so it no longer runs packages from that stale copy. An external named as a file inside a package, such as `externals: ['lodash/fp.js']`, now packs its package.

- [#584](https://github.com/meocord/meocord/pull/584) [`f2a9bf4`](https://github.com/meocord/meocord/commit/f2a9bf417f5ff38142f1f68a102720fdbcc88149) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `emit`'s JSDoc, and `EmitResult.ran`'s, now say what a test sees from a guard's `GuardDeniedError` and a handler's `UserError`: they reject `emit` as any error does, because the bot's event fallback doesn't run in a testing module. On a bot, that fallback skips a refused event, and logs a `UserError`, answering it as a reply when the event carries a message. Check them with `rejects`. See [Invoke and dispatch](https://meocord.dev/docs/4.2/invoke-and-dispatch).

- [#600](https://github.com/meocord/meocord/pull/600) [`4729b10`](https://github.com/meocord/meocord/commit/4729b10e26dd5948c1e2f60f4a5cb9183b6f8fdc) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A primary entry point command is now registered only globally, as Discord requires. Discord refuses a guild update that holds one (400, code 50222), and before, that refusal took every other command in the update with it.

  - A production run sends the entry point in the global update, even with `commands.guilds` set, and ignores a `guilds` restriction on its builder, with a warning. With `commands.guilds`, that global update holds the entry point and replaces any global commands left from an earlier configuration.
  - A development run with `developmentGuild`, and `meocord register --guild`, leave the entry point out of the guild update with a warning, so the rest of the commands register. They send nothing global, as a global update from such a run would delete the application's other global commands. A production run or `meocord register` registers the entry point.

  See [Slash commands](https://meocord.dev/docs/4.2/slash-commands).

- [#575](https://github.com/meocord/meocord/pull/575) [`f8c2a51`](https://github.com/meocord/meocord/commit/f8c2a516eeee194be0515ff751a7fb9e184b4b1a) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Help rendered from your catalog's `meocord.help` texts now keeps its lists apart in every language, on Node and Bun alike: params join with `·` and aliases with `, `, as in MeoCord's English. Before, zh-CN ran them together, ja and ru joined them with a space, and de joined the last two with "und". MeoCord's own English help is unchanged. A test that pins translated help sees the new separators. See [Message commands](https://meocord.dev/docs/4.2/message-commands).

- [#608](https://github.com/meocord/meocord/pull/608) [`772dbd4`](https://github.com/meocord/meocord/commit/772dbd49f6dfb3753771d9748d8bc3e17f872225) Thanks [@l7aromeo](https://github.com/l7aromeo)! - In a built bot, `import.meta.url` names the running bundle in `dist`, as `import.meta.dirname` and `import.meta.filename` already do. It named the source file on the machine that built the bot, so code finding its files from it worked only there, and the bundle carried the build machine's source path. `new URL('./file', import.meta.url)` assets keep resolving beside the bundle, and `import.meta.env.MODE` is still written in.

- [#589](https://github.com/meocord/meocord/pull/589) [`921ff91`](https://github.com/meocord/meocord/commit/921ff917ef602da316a83c44cc68b759a69ce408) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `invoke` checks a handler gets the arguments it declares when it builds none for it, as for a reaction handler given its reaction without its `ReactionEvent`. The call used to reach the handler and fail inside it, with `Cannot destructure property 'user' of 'undefined'`. Now:

  - under `useStrictMocks()`, `invoke` refuses the call before the handler runs, naming the fix: `Stars.star takes 2 arguments, and invoke was given 1: pass its ReactionEvent after the reaction, as { user, action }.`
  - by default, `invoke` warns once with the same words and calls the handler as before, so a handler that never reads its second argument keeps running.

  A handler behind `@UseGuard`, or behind `@Command`'s check, keeps the `length` and `name` it was declared with. See [Testing](https://meocord.dev/docs/4.2/testing).

- [#596](https://github.com/meocord/meocord/pull/596) [`90034c7`](https://github.com/meocord/meocord/commit/90034c74a0bed91253d5f908d2d7abc4cc85585e) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Every service the app makes now gets its lifecycle hooks once, in the bot and in `MeoCordTestingModule`:

  - A service that only a guard, interceptor, filter, pipe or the presenter injects is made as the bot comes online, and its `onReady` and `onShutdown` run, as `@Service` documents. Before, it never got its hooks, and it was made anew for every call that reached its stage. It is now the one shared instance `@Service` promises. A constructor that throws in such a service is reported as the bot comes online instead of failing each call. A class that injects the call's `ExecutionContext` is still made for each call, without hooks. If you worked around the missing hooks by calling an init method from the guard, or by listing the service in `services`, you can remove that.
  - One instance that two tokens reach, such as a factory alias of a service or one value provided twice, runs its `onReady` and `onShutdown` once instead of twice.

- [#610](https://github.com/meocord/meocord/pull/610) [`44a9a8e`](https://github.com/meocord/meocord/commit/44a9a8ef13fa70658f984fa09b38ee9e90e7e345) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `@Command` and `route()` warn about a customId pattern with a brace pair that isn't a param, such as `profile/{café}`: a param's name is ASCII letters, digits and `_`, so the pair is matched as literal text and a click on `profile/123` never reaches the handler. The pattern matches as before; rename the param, such as to `{cafe}`, to capture the segment.

- [#573](https://github.com/meocord/meocord/pull/573) [`c88e7a2`](https://github.com/meocord/meocord/commit/c88e7a26fff4febb60c30d99466b1ede6caf8f73) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `t.localizations()` keeps the default locale's wording where Discord would show another locale's. Discord shows en-US users the en-GB value, en-GB users the en-US one, and es-419 users the es-ES one when their own locale has none. So when your default is en-US, en-GB or es-419 and its partner has a translation, the result now includes the default's own message too. A bot with such a pair re-registers its commands once, and a test that pins `t.localizations()` for one sees the default's entry.

  An empty translation, `''`, which translation tools export for an untranslated string, now counts as missing:

  - `t.localizations()` leaves it out, so Discord shows the default there, and a bot with one now starts instead of stopping at startup;
  - a reply falls back to a related locale or the default, where it was empty;
  - `expectCompleteCatalog` reports it as missing.

  See [Localisation](https://meocord.dev/docs/4.2/localisation).

- [#591](https://github.com/meocord/meocord/pull/591) [`31760bf`](https://github.com/meocord/meocord/commit/31760bfbea3ec661a5e449bca2998b7271ab334f) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Under `meocord start --dev` with process sharding (`sharding: { mode: 'process', development: true }`), a shard that can't log in is reported as a failed login again: watch mode says the bot could not log in and starts it again on the next change in `src` or `.env`, where it reported a plain exit with code 1. Each app now decides once, as it is created, whether its process is a shard, before discord.js's `ShardingManager` writes the variable that marks one into the manager's own process. Nothing to change in your bot.

- [#602](https://github.com/meocord/meocord/pull/602) [`85ff84a`](https://github.com/meocord/meocord/commit/85ff84a6661f5bc17ef47ef5935762ad6f429e60) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A `MemoryCooldownStore` that nothing uses any more is garbage-collected once its calls have expired. Its sweep timer held it for as long as the process ran, so a test run kept one store per testing module that dispatched a cooldown. The sweep now stops when it leaves the store empty and starts again on its next call; counting is unchanged.

- [#603](https://github.com/meocord/meocord/pull/603) [`eee2287`](https://github.com/meocord/meocord/commit/eee22875358f6086cc2f7588ea29f0e9114e59b2) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `@MeoCord({ providers })` now warns about a provider for `ThemeCache` or `ExecutionContext`, tokens MeoCord binds itself: a `ThemeCache` provider silently replaced the app's theme cache. The bot still starts; the next major version (5.0) refuses such a provider. Remove it. A `Translator` provider without `i18n` stays supported, and `MeoCordTestingModule`'s providers are unchanged.

- [#609](https://github.com/meocord/meocord/pull/609) [`0ef1597`](https://github.com/meocord/meocord/commit/0ef15975dd0582b4992f843b0c17d472eacbcb20) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A mock thread's `createdTimestamp` and `createdAt` are read from its id, as another channel's are, in both modes. `createdTimestamp` read a stub and `createdAt` an Invalid Date.

  Under `useStrictMocks()`, a user, server or channel made with a generated id was created when the mock was made, as a message and an interaction already were. That covers `createMockUser()`, `createMockGuild()`, `createMockChannel()` and an interaction's own user, so a test of an account-age check gets a new account. `SnowflakeUtil.timestampFrom(id)` still reads the id's own time.

  In default mode their creation time is still their generated id's, a fixed day in 2025. Reading it warns once, saying to give the mock an id or a `createdTimestamp`, or to call `useStrictMocks()`. An id the test gives decides the time in both modes. The next major version (5.0) reads the time the mock was made without the call.

- [#594](https://github.com/meocord/meocord/pull/594) [`111acdd`](https://github.com/meocord/meocord/commit/111acdd4d356a2ae4869cb9370284ad35fabdbdd) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Mocks give the values discord.js always sets where they gave stubs without methods, and the warnings about placeholders name the right reader.

  - **Calls that threw now work, in both modes.**
    - `String(interaction)` on a slash command writes `/settings email address:a@b.c`, as discord.js does. An interaction made without `options` has an empty resolver.
    - `message.mentions.has(user, { ignoreRepliedUser: true })` answers. `mentions.parsedUsers` and `mentions.crosspostedChannels` are Collections.
    - These are empty collections and bitfields: `message.reactions`, `message.messageSnapshots`, a reaction's `users`, a member's and a user's `flags`, an interaction's `entitlements`, and a server's `presences`. A reaction's `users.fetch()` resolves an empty Collection.
    - A manager's lookups that read discord.js's own cache, such as `guild.presences.resolve(id)` and a thread's `members.resolve(id)`, find what its `cache` holds, else `null`.
    - So in default mode too, these fields hold discord.js's types instead of stubs. A test that relied on a stub's shape there sees the real value.
  - **Under `useStrictMocks()`, data reads as discord.js gives it.**
    - A reaction's `me` is `false`, `mentions.repliedUser` is `null`, and a modal's `message` is `null`.
    - A message's `editedAt` comes from `editedTimestamp`. A member's `presence` is the one its server caches, else `null`. A server's `verified` comes from its `features`. `systemChannel` and a channel's `parent` are the channels their ids name, else `null`.
    - A voice or stage channel's `full` is computed.
    - A reaction made without a message has a whole one of its own, so a dispatched reaction is neither warned about nor fetched.
  - **In default mode, values are unchanged.** Reading one of those values, or a voice channel's `full`, logs a warning once. The warning says what to set, or to call `useStrictMocks()`.
    - When MeoCord's dispatcher reads a reaction's placeholder `partial`, the warning says so. It also says the reaction was fetched because of it, and to set `reaction.partial = false` and `reaction.message.partial = false`.
    - `mentions.has()` reads `repliedUser` without a warning, since that placeholder matches no user.
  - **Under `useStrictMocks()`, a test that asserted `reaction.fetch` or `message.fetch` was called during dispatch changes.** A whole mock reaction is no longer fetched. The next major version (5.0) reads these values as strict mocks do.

- [#597](https://github.com/meocord/meocord/pull/597) [`eef4c72`](https://github.com/meocord/meocord/commit/eef4c725f3ba5dc4ed0501251f1273c31f81fc14) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A mock autocomplete's focused option reads as Discord sends it: a string. `getFocused()`, `getFocused(true).value` and the option's entry in `options.data` now agree, and `data` marks it `focused`.

  - With no value given, as before anything is typed, the focused option reads `''` instead of `null`, in both modes. A test that checked for `null` changes; discord.js's types rule `null` out.
  - The focused option is now in `options.data`, as Discord sends it, so with no value given an autocomplete handler's params are `{ query: '' }` rather than `{}`, in both modes. A test asserting `toEqual({})` there changes.
  - A number given for it reads as its digits under `useStrictMocks()`, keeping its option type. In default mode it stays the number and warns once when read. The next major version (5.0) gives the string without the call.

- [#617](https://github.com/meocord/meocord/pull/617) [`9e10a4e`](https://github.com/meocord/meocord/commit/9e10a4ee7b3a0b4f1aa15147c5f18158e98b4ff6) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A mock interaction holds each message it sends as it was sent, as Discord does:

  - `followUp()` resolves to the follow-up it sent, with the content, embeds, components and flags that `fetchReply(id)` reads back, as discord.js resolves it to the message Discord returns. It used to resolve to a message holding only the id, with a stub `content` and flags of 0, so code reading whether a follow-up was private saw a different value than against Discord.
  - `reply()`, `update()` and `followUp()` build what they send when they are called, so a builder changed afterwards no longer changes what `fetchReply()` reads. Reading a follow-up no longer uses up a generated id.
  - Under `useStrictMocks()`, an answer whose components or embeds discord.js refuses to build, such as a button with no label, rejects at the call with discord.js's error and leaves the interaction as it was. In default mode it still resolves, and it warns once. The next major version (5.0) rejects it without the call.

- [#638](https://github.com/meocord/meocord/pull/638) [`08b990a`](https://github.com/meocord/meocord/commit/08b990a629e6d67963652564243c5f654a2d696c) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Every id a mock generates comes from one count, so a test run gives the same ids each time. A server's `ownerId`, a role made without an id, an interaction's `commandId` and `applicationId`, a thread's `ownerId` and a channel's `guildId` fallback were time-based snowflakes, which differed between runs and sorted apart from every other mock id. A test that matched one of them against a time-based snowflake reads a counter id instead.

  A role made with `createMockInteraction(Role)` and no id gets its id when it is made, as a user does. Its `createdTimestamp` is still the time the mock was made, in both modes.

  In default mode, a reply read again, through `fetchReply()` or as `editReply()` resolves it, has the same author, server and channel each time, where each read made new ones. A test comparing two reads of the same reply sees the same objects, and reading it again uses up no ids.

- [#607](https://github.com/meocord/meocord/pull/607) [`542cd81`](https://github.com/meocord/meocord/commit/542cd8115867a30f5ec82e3533ce65cf26976311) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Under `useStrictMocks()`, a mock interaction is in the place its `message`, `guild`, `member` or `guildId` gives it, as Discord sends it:

  - An interaction given a `message` is in the message's channel and server. A button built on a default `createMockMessage()` is in that message's server, no longer a DM. When the test also gives the interaction a `channel`, `guild` or `guildId`, a message whose server `createMockMessage()` made itself moves to that place instead.
  - An interaction given a `guild`, or a `member` of a server, is in that server, with its `guildId`.
  - An interaction given a `guildId` alone is in a server the bot isn't in. Its `guild` and `channel` are `null`, and its `member` is a raw member for its user.
  - A `channel`, `guild` or `guildId` that is somewhere other than a message the test placed, by giving it a `channel` or `guild`, is refused, naming both.

  In default mode, placement is unchanged. Where strict mocks would place the interaction elsewhere, reading its `guildId`, `guild`, `channelId`, `channel` or `member` warns once, saying what to give or to call `useStrictMocks()`, and so do `inGuild()`, `inCachedGuild()`, `memberPermissions` and `appPermissions`, each under its own name, where strict mocks would answer otherwise. The same goes for the message, where strict mocks would move one whose place `createMockMessage()` made. The next major version (5.0) places interactions this way without the call.

- [#618](https://github.com/meocord/meocord/pull/618) [`41f908f`](https://github.com/meocord/meocord/commit/41f908f93bebc662fb7d920d86cea2f9f219d140) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Under `useStrictMocks()`, a mock interaction's `memberPermissions` applies its channel's permission overwrites, as Discord computes it, so a guard that checks it denies in a test where it denies in production. The overwrites go on top of `member.permissions`, so a value a test sets there still decides the base. As in discord.js:

  - an Administrator or the server's owner has every permission, `PermissionsBitField.All`;
  - a thread takes its parent's overwrites;
  - a raw member's permissions are kept as given.

  In default mode `memberPermissions` is still the member's own permissions. Where strict mocks would read otherwise, because of the channel's overwrites or an Administrator's or owner's every permission, reading it warns once, naming the permissions strict mocks read without or with. It, and `appPermissions`, also warn once where the server's `@everyone` role has no permissions set, since strict mocks give `@everyone` the permissions Discord gives it in a new server; set `guild.roles.everyone.permissions` to read the same in both modes. The next major version (5.0) applies the overwrites without the call.

- [#613](https://github.com/meocord/meocord/pull/613) [`6f54ab0`](https://github.com/meocord/meocord/commit/6f54ab0cacbb3b7cd7926feadf8f42a18874bd51) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A mock message's `components` and `embeds` are discord.js's classes, as a real message holds them. `createMockMessage({ components, embeds })`, and the messages `editReply()` and `fetchReply()` return, used to keep each one as a bare `{ toJSON }`, so `message.components[0].type` and `message.embeds[0].title` read `undefined`.

  Each one is now built from its JSON at the time of the call, whether it was given as a builder or as API JSON:

  - an action row is an `ActionRow` holding a `ButtonComponent`, a select menu component, and so on;
  - Components V2 are `ContainerComponent`, `TextDisplayComponent` and the rest;
  - an embed is an `Embed`;
  - a type discord.js doesn't know is a plain `Component`, as discord.js builds it.

  A discord.js instance you give is kept as it is. `toJSON()` still returns the same JSON, so no passing test changes.

- [#636](https://github.com/meocord/meocord/pull/636) [`379932f`](https://github.com/meocord/meocord/commit/379932ff4f2dd42d383141740955820f1df2e4b4) Thanks [@l7aromeo](https://github.com/l7aromeo)! - What a mock computes for itself no longer calls a method a test may stub, or caches anything a test can see.

  - A mock message's `member` reads its server's member cache, as discord.js does, without calling `guild.members.resolve()`. A test's `members.resolve.mockReturnValueOnce()` is left for its own code.
  - A mock interaction's `appPermissions` computes the bot's permissions with discord.js's own computation, without calling `channel.permissionsFor()`. Reading it no longer caches the bot's member in `guild.members.cache`. In a thread, it is the bot's permissions in the thread's parent, as Discord gives them, where it was empty.
  - A mock interaction's `channel` is the channel its server caches under `channelId` each time it is read, so a channel a test caches there after a first read is the one read.

- [#590](https://github.com/meocord/meocord/pull/590) [`54d76f9`](https://github.com/meocord/meocord/commit/54d76f9d3e85ca9f9f5ac6b0857475d63a3fffa0) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A mock interaction keeps its reply state, its original response and discord.js's errors whatever a test sets its answers to do.

  - **A test's own value.** An answer given a value with `mockResolvedValue`, `mockResolvedValueOnce` or `mockImplementation` now replies or defers as a real one would: `reply`, `deferReply`, `followUp`, `editReply`, `showModal`, `update` and `deferUpdate`. `getResponse(interaction).state` then reads `'replied'` or `'deferred'` where it read `'unanswered'`. One that rejects still changes nothing.
    - A second answer after such an answer, which discord.js refuses, still runs in default mode, with a warning.
    - Under `useStrictMocks()` it is refused, as discord.js refuses it. The next major version (5.0) refuses it without the call.
  - **The original response.** `fetchReply()` reads back what `reply()` or `update()` sent instead of an empty message. After `deleteReply()`, fetching, editing or deleting the original response rejects with 10008 (Unknown Message), as Discord answers. So does fetching it before any answer. Follow-ups stay reachable by their id: `editReply({ message: id })`, `fetchReply(id)` and `deleteReply(id)` act on the follow-up, where `editReply` edited the original before.
  - **Flags.** `flags` given as an array, a name or a `MessageFlagsBitField` makes a reply ephemeral, as in discord.js; only a number did before. `null` flags are none. A bigint or an unknown name rejects with discord.js's RangeError, where a bigint read as ephemeral before.
  - **Errors.** A second reply, an answer before any reply and a second autocomplete `respond()` throw discord.js's `DiscordjsError`, with the codes `InteractionAlreadyReplied` and `InteractionNotReplied`. They keep their messages, so a test matching the message as a string or a regex keeps passing. One comparing with `new Error(message)` sees the new name and code.

- [#582](https://github.com/meocord/meocord/pull/582) [`3279286`](https://github.com/meocord/meocord/commit/327928614fc930583eb92025ff597b0ea4c946e1) Thanks [@l7aromeo](https://github.com/l7aromeo)! - meocord's mocks now work with each test runner's own mock functions and matchers.

  - Under `useMockFn(jest.fn)`, a method of a `createMock()` double that has no implementation set returns `undefined`, as jest's mocks do. It no longer overflows the stack. Nested methods, and methods whose name starts with `_`, stay mocks as before.
  - jest's call matchers, such as `toHaveBeenCalled`, read a `createMock()` member as a mock, whether or not `useMockFn` is set. They took it for a jasmine spy and failed with `Cannot read properties of undefined (reading 'map')`.
    - To get this, a nested member named `calls` no longer makes `all` and `count` for itself: `x.y.calls.all` and `x.y.calls.count` read `undefined` until a test sets them.
    - Every other name under it, such as `x.y.calls.foo`, is still a nested mock, and a `calls` member at the root, `x.calls.all`, is a mock as before.
  - Without `useMockFn`, Vitest's `toHaveResolved`, `toHaveResolvedWith`, `toHaveResolvedTimes`, `toHaveLastResolvedWith`, `toHaveNthResolvedWith`, `toHaveBeenCalledBefore` and `toHaveBeenCalledAfter` work on meocord's own mocks. `mock` gains `settledResults`, `invocationCallOrder` and `contexts` for them. The new fields stay out of `mock`'s keys, so a test comparing `mock` as a whole sees the same shape. Call order is counted across meocord's own mocks, so compare two of meocord's mocks, or two of the runner's, rather than one of each.
  - A meocord mock whose implementation returns a promise hands back a promise that settles the same way, not the same object. `expect(fn()).toBe(promise)` no longer holds; `toEqual`, `toHaveReturnedWith` and awaiting the result are unaffected. A property set on the given promise, such as a `cancel` method, isn't carried over.
  - `useMockFn(mock.fn)` under node:test gives meocord's refusal, which says to leave meocord's own mock function in place, with node's error as its `cause`, instead of node's internal TypeError.

- [#625](https://github.com/meocord/meocord/pull/625) [`99d9339`](https://github.com/meocord/meocord/commit/99d93399f4f4539c407bd9c529d5949a74d28c56) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Messages a mock sends or fetches are where they belong and hold what was sent:

  - A message from a channel's `send()`, a message's `reply()` or `forward()`, or an interaction's `followUp()`, `editReply()` or `fetchReply()` holds the content, embeds and components of the call that made it. It is in the channel it was sent in and that channel's server. Before, it sat in a generated channel of a generated server, with a stub `content`.
  - A message's `edit()` changes that message and resolves to it, where it resolved to a new one. `crosspost()` resolves to the message itself.
  - A message fetched with `messages.fetch()` is in the channel it was fetched from, with an author other than the bot.
  - A role made with `roles.create()` or fetched with `roles.fetch()` is in its server. A role, channel, thread or application command a manager's `create()` makes is in that manager's cache, as discord.js caches it. `bans.create()` resolves to the member, user or id it was given and caches nothing, as discord.js's does.

  Under `useStrictMocks()`, a message the bot sends is its `client.user`'s, so its `editable` reads `true`. One sent in a DM is in that DM: `inGuild()` is `false`, and `guild` and `member` are `null`. In default mode these keep today's values and warn once when read: the author of a message the bot sent, and the server of one sent in a DM. The next major version (5.0) reads them as strict mocks do.

- [#623](https://github.com/meocord/meocord/pull/623) [`46e974b`](https://github.com/meocord/meocord/commit/46e974bf74ed0f2601a95f2dc5dd8d641882d63c) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A mock message context menu's target is its `targetMessage`, and `targetId` reads that message's id. Without a `targetMessage`, the menu gets a generated id and a message made for it, as a user context menu already did. That message is in the menu's channel and its server, or in the user's DM channel for a menu used in a DM. Setting `targetMessage` after the mock is made moves `targetId` with it, and setting `targetId` makes a message for the new id. A `targetMessage` with no id gets a generated one. If a `targetId` is given that differs from the `targetMessage`'s id, `useStrictMocks()` refuses it, naming both. In default mode it warns once and reads the message's id.

  A user or an attachment made with `createMockInteraction(User)` or `createMockInteraction(Attachment)` has a snowflake `id`, from the same count as every other mock's. Before, the id was a stub that stringified to `[object Object]` for every one of them: two users shared a cooldown key, a mention read `<@[object Object]>`, and `createModalFields` keyed uploads by a stub. A user made this way gets its creation time the same way `createMockUser()`'s does: the time the mock was made under `useStrictMocks()`, and its id's time, with a warning, in default mode.

- [#593](https://github.com/meocord/meocord/pull/593) [`449bfd4`](https://github.com/meocord/meocord/commit/449bfd43cc8018642272c6b8424be6f261fff65a) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `respond().original.components` is typed as the message's top-level components, `readonly APIMessageTopLevelComponent[]`, rather than `readonly unknown[]`, so a handler can hand them back to `send()`, `editReply()` or a builder without a cast, as it already can the `embeds` beside them. Reading them compiles as before. A cast to an unrelated type, such as `Record<string, unknown>[]`, now fails to compile; drop it. Code that builds its own `ResponseState`, such as a test double, with `unknown[]` components in `original` must type them as Discord's `APIMessageTopLevelComponent[]`.

- [#576](https://github.com/meocord/meocord/pull/576) [`9cf754f`](https://github.com/meocord/meocord/commit/9cf754f3774d1f14d7f6d77f5ee5934cb336725c) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A customId pattern that repeats a param name, such as `card/{id}/{id}`, or starts one with a digit, such as `card/{1}`, is refused in words that name the param: `Invalid pattern "card/{id}/{id}": {id} appears twice; give each param its own name.` These patterns were already refused, with the regular expression engine's error and the compiled regex in place of the pattern, so only the message changes, for `@Command` and `route()` alike.

- [#574](https://github.com/meocord/meocord/pull/574) [`793df0f`](https://github.com/meocord/meocord/commit/793df0fa332062db648a84d819215c640a3323d0) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A command, an option or a modal field named like a member of `Object.prototype`, such as `constructor`, `__proto__` or `toString`, now routes like any other name. Declaring `@Command('constructor', …)` used to throw `metas.findIndex is not a function`, and an undeclared command of such a name, say one left registered, failed with an error log instead of "Command not found!". An option or a modal field named `__proto__` now reaches the handler as an own param, and a customId param named `constructor` is no longer reported as colliding with a field that doesn't exist. Nothing to change in your code.

- [#614](https://github.com/meocord/meocord/pull/614) [`f1346ae`](https://github.com/meocord/meocord/commit/f1346ae8c13c6e02f5d4be791cbea5ca2cb101f3) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `createMockInteraction`'s types now refuse a `channel` beside a raw member (`createMockRawMember()`), as the mock already did when built. A raw member is from a server the bot isn't in, where discord.js caches no channel. That covers a server's channel, `channel: null`, a DM channel, and a channel beside `guild: null`. These calls compiled and then threw "leave the channel out" at runtime. `{ guildId, member: createMockRawMember() }` still gives a raw-server interaction.

- [#624](https://github.com/meocord/meocord/pull/624) [`405004f`](https://github.com/meocord/meocord/commit/405004f3c7ef1107efb9a1e99bb1ba69a9bc71ca) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A service whose `onReady` is still running when the bot stops, through `app.stop()` or a signal, now gets its `onShutdown` once that `onReady` finishes, so what it opened, such as a connection pool, is closed. Shutdown waits for it within the same `shutdownTimeout`, leaving the `onShutdown` hooks their reserve. An `onReady` still running then is named in a warning, and shutdown goes on without it. An `onReady` that calls `app.stop()` itself isn't waited for.

  A testing module's `close()` during `init({ ready: true })` waits for the `onReady` hooks within its `shutdownTimeout` in the same way, warning about one that never settles rather than hanging, and an `onReady` that calls `close()` no longer waits for itself.

- [#601](https://github.com/meocord/meocord/pull/601) [`d368e8d`](https://github.com/meocord/meocord/commit/d368e8d9b5db3d9ad3a51f9d9e96407d34943e36) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Command registration keeps in step with what Discord holds:

  - A development start no longer skips a scope as unchanged when the commands were removed, changed or registered again since, from this checkout or another: it checks the scope with one listing first, and sends again when any command's version differs from what it last sent. A scope that `clearOther` cleared, or that a production run wrote, from the same checkout is sent again without the check. Before, only `--force-register` brought such commands back.
  - `meocord register --guild` with a blank guild, as an unset `--guild "$DEV_GUILD_ID"` gives, stops with an error and exits 1, where it registered to `commands.guilds` or globally. That matches what `commands.guilds` already does for an unset id.
  - The warning about commands left in another scope says why they are kept during a development-guild run, instead of advising `commands.clearOther`, which doesn't apply there.
  - The registered-commands table lists only subcommands and subcommand groups under Sub-commands, not a command's plain options.

- [#572](https://github.com/meocord/meocord/pull/572) [`dc7cdb9`](https://github.com/meocord/meocord/commit/dc7cdb9a69cabd363938cfdc0047c0d85fd4acac) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Under process sharding, a call to every shard now reaches each one for any shard count: `ShardContext.broadcastEval`, and discord.js's `client.shard.broadcastEval()` and `client.shard.fetchClientValues()`. They were refused with "Shards are still being spawned." unless the bot ran exactly 4 shards. Nothing to change in your bot.

- [#619](https://github.com/meocord/meocord/pull/619) [`3517d1a`](https://github.com/meocord/meocord/commit/3517d1a312c47781fc8565bb3f1f8e76d8ee73ff) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A process that loads meocord both as an ES module and through `require()`, such as an ES module bot with a CommonJS helper, a jest CommonJS `setupFiles` beside ES module specs, or `node --require ./setup.cjs`, now behaves as one:

  - `UserError`, `GuardDeniedError`, `ValidationError` and meocord's other errors from either build are answered as what they are, and `instanceof` holds across the two. An app's own subclass still matches only its own instances.
  - A handler's `@UseTheme` theme, the app's translator for meocord's own texts, and its presenter apply whichever build answers.
  - `respond()` keeps one answer for an interaction, so a `send()` after a `delete()` from the other build follows up rather than editing the deleted reply, and `getResponse()` reads a mock's answers whichever build made the mock or answered it.
  - `useStrictMocks()` and `useMockFn()` called in a setup file in one format apply to mocks made in the other, and the two never give two mocks one id.

  The two builds share this state only within one installed version. It now outlasts `vi.resetModules()`, `jest.resetModules()` and jest's `resetModules` config, where it was made afresh: mock ids keep counting, and `useStrictMocks()` and `useMockFn()` called in a setup file stay in effect for every test.

- [#587](https://github.com/meocord/meocord/pull/587) [`f0a9ff3`](https://github.com/meocord/meocord/commit/f0a9ff3ffac1835466b1913d9305c730b1a3a23f) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Shutdown now waits for the calls under way before the `onShutdown` hooks, in every bot, and stops taking events first:

  - A handler that awaits `app.stop()`, as an owner-only shutdown command does, no longer holds the shutdown up until `shutdownTimeout`. It isn't waited for.
  - No interaction, message, reaction or `@On`/`@Once` event starts a call once shutdown has begun, and an `@On`/`@Once` handler already running is waited for, as a dispatched call is. Before, a bot whose cooldown store has no `onShutdown` kept dispatching while its hooks ran.
  - An `@On('error')` handler keeps receiving the client's errors until the client is destroyed.
  - `shutdownTimeout` still bounds the whole shutdown. The calls are waited for no longer than the timeout less a reserve kept for the hooks: a quarter of it, at least 1 second and never more than half. A call still running then is named in a warning, and the hooks run in the time left.

  A `stop()` while the bot starts now waits for the providers being made, at most `shutdownTimeout`, and makes nothing more after it, so no service is constructed once the bot has shut down. A factory still pending after `shutdownTimeout` is named in a warning. `MeoCordTestingModule.close()` during `init()` likewise waits for the providers `init()` is making, and closes them.

- [#616](https://github.com/meocord/meocord/pull/616) [`8ea2acf`](https://github.com/meocord/meocord/commit/8ea2acffa07cd061e2c9df7682bb125a5339af59) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `overrideGuard`, `overrideInterceptor` and `overrideFilter` replace a stage that is also a provider. A guard, interceptor or filter listed in `providers`, the app's or the testing module's, made every call fail with `Ambiguous bindings found for service` once it was overridden. Now the stub stands in for it, and wins over an `overrideProvider` of the same class. It runs the `onReady` and `onShutdown` a provider would; a stage applied only with `@UseGuard`, `@UseInterceptor` or `@UseFilter` runs none, as on the bot.

  `compile()` also checks each stub for its stage's method, `canActivate`, `intercept` or `catch`, on the stub or its prototype. Under `useStrictMocks()`, a stub without it is refused with `overrideGuard(G).useValue(…) has no canActivate method.` By default, `compile()` warns with the same words, once per stub and method, and builds the module, so a test that never reaches the stage passes as before. See [Testing](https://meocord.dev/docs/4.2/testing).

- [#604](https://github.com/meocord/meocord/pull/604) [`f30b621`](https://github.com/meocord/meocord/commit/f30b6210a2233b1eacf01f7471799d2cc175a515) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A theme emoji may be the England, Scotland or Wales flag, as theming documents for flags, where the bot stopped at startup calling it "not an emoji".

- [#606](https://github.com/meocord/meocord/pull/606) [`e0d3300`](https://github.com/meocord/meocord/commit/e0d3300fb200ec38691fea457f633c0dbf63bc3d) Thanks [@l7aromeo](https://github.com/l7aromeo)! - The warning for a `themeFor` result the theme can't use shows each value as other log lines show outside text: in double quotes, with control characters and line breaks escaped, and cut short after 200 characters. A role name in it is escaped too. A malformed saved value no longer spans several lines. The startup refusal of a theme written in code reads as before.

- [#592](https://github.com/meocord/meocord/pull/592) [`b0bcb45`](https://github.com/meocord/meocord/commit/b0bcb45bc3332354da71072b56f80522cb3979d0) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `meocord.config.ts` and the build read `tsconfig.json`'s `paths` as `tsc` does, whatever TypeScript version the project uses: paths inherited through `extends`, paths relative to `baseUrl`, and `${configDir}` in `paths`, `include`, `exclude` and `files`. A config that imports through such a path now loads, rather than failing with "Cannot find module", and a `${configDir}` path no longer breaks the build.

- [#586](https://github.com/meocord/meocord/pull/586) [`6fe54a9`](https://github.com/meocord/meocord/commit/6fe54a9fb075288f7a9ed7f711f86000f21dbb45) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A `UserError`, `GuardDeniedError` or `ValidationError` whose message is empty, or longer than Discord takes, is answered as the user's own outcome again, instead of failing as a bot fault with the generic danger-coloured answer and two error logs. The message is fitted before any presenter sees it, your own included:

  - at most 4096 characters for an embed and 4000 for a Components V2 Text Display, title line included, cut to end in `…`;
  - an empty or whitespace-only message becomes MeoCord's generic error text.

  A message command's plain-text reply is cut to 2000 characters, its warning emoji included. `PresentedError.message` documents the limit; a presenter that writes the message as its text needs no change.

- [#488](https://github.com/meocord/meocord/pull/488) [`b29a23c`](https://github.com/meocord/meocord/commit/b29a23c63b1aff1d029b9582b59ea359947666a4) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A `UserError` thrown from a message command or an `@On` message event is answered with a reply that pings no one its text mentions, as MeoCord's other replies to messages already do. Users, roles, `@everyone` and `@here` in the error's message are shown as written. Nothing changes for a bot whose error messages hold no mentions.

## 4.2.0

### Minor Changes

- [#463](https://github.com/meocord/meocord/pull/463) [`4d6b965`](https://github.com/meocord/meocord/commit/4d6b965ced8ecad9aceedb92ab7d084c0c2761bb) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `@MeoCord({ messages: { handlers: 'concurrent' } })` runs a message's matched command and its `@MessageHandler()` listeners together, so a slow or hung command no longer holds back logging, moderation and the other listeners. Each keeps its own guards, interceptors, filters and observers, and the call settles once all have; no order holds between them, so a listener that reads what the command writes for the same message should keep the default, `'sequential'`. ([docs](https://meocord.dev/docs/4.2/message-commands))

  Under `'sequential'`, a running bot now warns, once per handler, when a message's handler takes 5 seconds or more with listeners waiting after it, naming the option. `messages: { slowHandlerWarning: false }` turns the warning off. A `MeoCordTestingModule` doesn't warn unless `slowHandlerWarning` is `true`, so a test whose fake clock passes 5 seconds inside a handler sees nothing new.

- [#460](https://github.com/meocord/meocord/pull/460) [`ded179f`](https://github.com/meocord/meocord/commit/ded179fc74d83e0228f89dc271033d61c04d0809) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `@Controller({ inheritedRoutes: 'replace' })` makes a handler the class re-decorates answer only the routes the class declares for it, dropping the ones its base classes declare for that method. That covers every kind: commands, component patterns, message patterns and listeners, reactions and autocompletes. A slash or context menu command that no handler answers any more is not registered. A method overridden without decorators keeps every route it inherits. `'keep'`, the default, answers both, as before; the next major version (5.0) replaces them by default.

  Two things help with the move, without changing what a bot does:

  - The warning that names a re-declared handler still answering an inherited route now says how to drop that route now.
  - `inspectHandler` reports the routes a handler answers by inheritance, as `inheritedRoutes`.

  See https://meocord.dev/docs/4.2/how-a-call-runs.

- [#459](https://github.com/meocord/meocord/pull/459) [`ff45ac5`](https://github.com/meocord/meocord/commit/ff45ac5b7fedbcfa6a51aef774cbc464c442df19) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `createMockRawMember()` builds the member Discord sends with an interaction from a server the bot isn't in: plain data with `roles` as role ids and `permissions` as a bitfield string, as discord.js keeps it. To test a user-installed command run there, give it as an interaction's `member` with the server's `guildId` and no `guild`:

  - the interaction reads `inRawGuild()` true, `guild` and `channel` `null` (with its `channelId` kept), `user` the member's user and `memberPermissions` the member's;
  - a user option's member is the resolved member Discord sends;
  - the interaction is typed as a `'raw'` one;
  - a guard that reads `member.roles.cache` throws, as it would in Discord.

  A raw member with a `channel`, without a `guildId`, or with a different `user` is refused. Given with a `guild`, it reads as a cached server's member, as before, with a warning once to leave the guild out. A `guildId` given alone builds the interaction as before. See https://meocord.dev/docs/4.2/mocks.

- [#476](https://github.com/meocord/meocord/pull/476) [`586a493`](https://github.com/meocord/meocord/commit/586a493c39b5a834157d9ab084a5607733ba915c) Thanks [@l7aromeo](https://github.com/l7aromeo)! - customId patterns take two new param types: `{id:snowflake}` and `{id:uuid}`. The handler gets each as text, typed `string`, and `route().build()` refuses text that isn't one. `build()` takes either only as a string and throws a `TypeError` for a number, which may have lost an ID's digits before `build()` sees it: `12345678901234567` arrives as `12345678901234568`.

  - `{id:snowflake}` takes a Discord ID: 17 to 20 digits with no leading zero, up to the largest 64-bit value. Every ID Discord has made since 2015-01-28 has at least 17 digits, because an ID's top 42 bits count milliseconds since 2015-01-01. The handler keeps the ID as text: from 17 digits on, a JavaScript number can't hold it exactly.
  - `{id:uuid}` takes a UUID in its canonical 8-4-4-4-12 hex form, in either case, kept as written.

  Both rank ahead of an untyped param, so `ticket/{id:snowflake}` takes an ID before `ticket/{name}` does, whatever the listing. Neither shares a value with `int`, `bool` or the other, so they never tie with those. Shorter digits stay an `int` while a JavaScript number holds them exactly. A 16-digit value above `Number.MAX_SAFE_INTEGER` is neither an `int` nor a snowflake, so it goes to a `number` param or to text. Between a snowflake and a `number` param, which also takes those digits, the snowflake wins. Use `{id:snowflake}` for Discord IDs: `{id:number}` rounds one, giving `12345678901234568` for `12345678901234567`.

  See https://meocord.dev/docs/4.2/components.

- [#462](https://github.com/meocord/meocord/pull/462) [`db96d3d`](https://github.com/meocord/meocord/commit/db96d3ddcdaa940f6f86f32b9fb5c0f2a9f55de9) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `MeoCordFactory.create()` and a testing module's `compile()` report every startup error their checks find, not only the first. These include two handlers of one command, two same-named classes with a cooldown, a provider for a token MeoCord binds itself, and a class nothing can make. Each error is logged with the file it comes from, and then the first is thrown as before: the same error, with the same message, so code and tests that catch it or match its text keep working. A lone error is reported as before.

  A decorator's startup error, such as an invalid customId pattern, is still thrown as its class is defined, with its message unchanged. It now names what it is about and where:

  - `error.declaration` is the handler or class it was applied to, such as `Tickets.close`;
  - `error.file` is the source file it is declared in.

  The built bot's report puts the handler first wherever the message doesn't already name it.

  New, and opt-in: set `startupErrors: 'all'` in `meocord.config.ts` to report every startup error in one run.

  - Decorators keep their errors instead of throwing them as each file loads.
  - `create()` logs those together with its own errors, so a bot with three mistakes shows all three in one run.
  - In a test, call `reportAllStartupErrors()` from `meocord/testing` in the setup file instead.

  The default stays `'first'`, where a decorator throws as its class is defined. The next major version (5.0) makes `'all'` the default. See https://meocord.dev/docs/4.2/configuration.

- [#457](https://github.com/meocord/meocord/pull/457) [`ea32209`](https://github.com/meocord/meocord/commit/ea322096a1050dc725e2ab339a1f3fa3f02320f2) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `useStrictMocks()`, called once in a test setup file, has every mock from `meocord/testing` compute the values discord.js computes, where it reads a truthy placeholder otherwise. Those values include:

  - a message's `editable`, `deletable`, `pinnable`, `crosspostable`, `bulkDeletable`, `hasThread` and `partial`;
  - a member's `manageable`, `kickable`, `bannable` and `moderatable`;
  - a role's `editable`;
  - a channel's and a thread's `viewable`, `manageable`, `deletable` and `joinable`;
  - `partial` on users, channels and reactions.

  `message.thread` is `null` unless the channel caches a thread under the message's id, and no placeholder warning is logged.

  To give those values what Discord would, strict mocks:

  - cache the bot's member in its server from the start;
  - give `@everyone` the permissions Discord gives it in a new server;
  - give a channel or thread made without a server one of its own.

  So a default message from another user is not `editable` or `deletable`, and a member is not `kickable` until the bot's member has a role above theirs with the permission. A value a test sets on a mock still wins. The next major version (5.0) computes these values by default. See https://meocord.dev/docs/4.2/mocks.

  Without the call, mocks read as before. A voice channel's `joinable` and `speakable` and a DM channel's `partial`, which read a placeholder without the warning, now give it too. Every placeholder warning now ends ", or call useStrictMocks() to have the mock compute it now.", so a test that matches a warning's whole text needs the new ending.

- [#455](https://github.com/meocord/meocord/pull/455) [`602285b`](https://github.com/meocord/meocord/commit/602285b5e709909ae9e88ede8d296f6924053f50) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `useMockFn(vi.fn)`, called once in a test setup file, makes every mock from `meocord/testing` with the test runner's own mock function. The runner then treats them as its own: Vitest's `clearMocks` and `mockReset` config, `vi.clearAllMocks()` and `vi.mocked(...)` reach them, and bun's matchers, which accept only bun's mocks, read them with `useMockFn(mock)`. jest takes `useMockFn(jest.fn)`. Without the call, mocks are meocord's own as before. Under jest and bun, whose `mockReset` drops a mock's starting behaviour, reset with meocord's `resetAllMocks()`, which puts it back. node:test keeps meocord's own mock function.

  A new project's `vitest.setup.ts` calls `useMockFn(vi.fn)`. An existing project can add the same line to its setup file, before any mock is made. See https://meocord.dev/docs/4.2/mocks.

### Patch Changes

- [#466](https://github.com/meocord/meocord/pull/466) [`e646771`](https://github.com/meocord/meocord/commit/e646771ca9a92a28fe00cecd6a265b2d7ede409d) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `testCooldownStore` no longer fails a correct store on a slow CI runner. Its sliding-window and `retryAfterMs` cases measured elapsed time against their nominal waits, with margins of tens of milliseconds, so a timer that fired a few hundred milliseconds late failed them. They now check against the times measured around each call, in a 2-second window with a second between calls, and still fail a store that resets fixed buckets or counts from the newest call. The suite takes about 2 seconds longer.

- [#474](https://github.com/meocord/meocord/pull/474) [`4f6b307`](https://github.com/meocord/meocord/commit/4f6b307d6d9a886e9b0bbcaa0439b36e9b4bae62) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Component customId patterns now rank segment by segment, left to right, the way most routers rank paths. When several patterns match an id, the first segment where one pattern spells out literal text and the other leaves a param decides it: the literal one runs, whatever order the controllers are listed in. So `profile/me/{section}` takes `profile/me/edit` from `profile/{userId}/edit`, while `profile/123/edit` still goes to `{userId}`. If that leaves a pair tied, the narrower type at the first param where they differ runs, the same type order as before: words to choose from, then `bool`, `int`, `number`, then text.

  4.1 ranked by how much literal text a whole pattern had. Only these overlapping pairs change handler, and 4.1 named every one of them in its startup warning:

  - A pattern with more literal text, or more literal segments, now loses to one that spells out an earlier segment. For example, `a/{x}` now runs for `a/abcd` instead of `{x}/abcd`.
  - Pairs 4.1 left to listing order, such as `a/{x}/c` and `a/b/{y}`, now go to the earlier literal whatever the listing, which is the handler 4.1's warning said would run in 5.0.
  - Typed params are compared position by position instead of summed. For example, `{n:int}/{s}` now runs for `7/7` instead of the one listed first among it and `{s}/{n:int}`.

  Two patterns that the ranking still can't tell apart log a warning at startup, with an id both match. Such a pair has the same literals and equally narrow params at every position, such as `t/{a:on|off}` and `t/{b:off|no}`, which both take `t/off`, and the one listed first runs. Pairs the ranking decides log no warning.

  `findRouteConflicts` lists only those tied pairs. A test asserting `toEqual([])` passes for every app whose patterns the ranking tells apart. A test expecting a pair the ranking now decides, such as `profile/summary/{uid}` and `profile/{ownerId}/{uid}`, gets `[]` instead.

  The internal `CommandMetadata`'s `specificity` still holds the value 4.1 gave, but routing no longer reads it. It's deprecated and goes in the next major version (5.0).

  See https://meocord.dev/docs/4.2/components.

- [#484](https://github.com/meocord/meocord/pull/484) [`cecfe6a`](https://github.com/meocord/meocord/commit/cecfe6ad53bd2f834d8f17472eb5690a3be9865b) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A new app from `meocord create` turns on strict mocks in its `vitest.setup.ts`, with `useStrictMocks()`, so its mocks compute what discord.js computes, such as a message's `editable` or a member's `kickable`, rather than placeholders. Its sample button and `OwnerGuard` read the owner's id as `{ownerId:snowflake}`, so a customId that isn't a Discord id matches nothing. An existing app can add `useStrictMocks()` to its own setup file, before any mock is made ([docs](https://meocord.dev/docs/4.2/mocks)).

## 4.1.2

### Patch Changes

- [#454](https://github.com/meocord/meocord/pull/454) [`1f71fe1`](https://github.com/meocord/meocord/commit/1f71fe12b96c339bf3e1f19f714f24ebd8e7e853) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A mock interaction's type guards, such as `isButton()` and `isRepliable()`, and its `inGuild()`, `inCachedGuild()` and `inRawGuild()` keep answering as discord.js does after `resetAllMocks()`. They returned `undefined` after a reset, so a mock made once for several tests, such as in `beforeAll`, failed every type check after the first test in a project that resets between tests, as a generated one does.

## 4.1.1

### Patch Changes

- [#424](https://github.com/meocord/meocord/pull/424) [`43b9454`](https://github.com/meocord/meocord/commit/43b945447262405f61cced6660cd1d2be881d4b8) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A mock guild's `members.fetch({ user: ids })` now resolves to a collection of each of those members, found in the cache or made the way `members.fetch(id)` makes one. It resolved to an empty collection, so in a test a message command naming two or more members by ID that the guild hasn't cached refused them all as not members of the server, while one such member resolved. Mentioned members were not affected: they come from the message's mentions.

- [#422](https://github.com/meocord/meocord/pull/422) [`22daff2`](https://github.com/meocord/meocord/commit/22daff26ac4a694a8d70eace38a4c038d3cef0ef) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `createMockClient()` is typed as a logged-in client, `DeepMocked<Client<true>>`, as the mock already behaves. Pass it straight to `createMockInteraction`, `createMockChannel`, `createMockUser` or `module.init({ ready: { client } })`: each of these failed to compile without a cast, since an interaction's client is `Client<true>`. `client.user` is no longer nullable, so `client.user!.id` can be `client.user.id`. Remove any `as unknown as Client<true>` cast on the mock.

- [#430](https://github.com/meocord/meocord/pull/430) [`1d0c0cf`](https://github.com/meocord/meocord/commit/1d0c0cf7d9755e5d24a0f218809a2f95fe403ccc) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Mocks from `meocord/testing` now compute what discord.js computes from them, where they returned `undefined` or a placeholder object:

  - **Lookups:** a manager's `resolve()` and `resolveId()` read its cache, so `guild.members.resolve(id)` finds a member given to `createMockGuild`. `guild.members.me` is the bot's member, the cached one or one with `@everyone`. A guild's roles and channels, and the guilds of a client's messages and interactions, belong where discord.js puts them, and everything in a guild shares its client.
  - **Ranking and permissions:** `role.comparePositionTo()`, `channel.permissionsFor()`, `member.permissionsIn()` and an interaction's `appPermissions` compute from the roles, the channel's `permissionOverwrites` and the bot's member. Being real, they keep working after `resetAllMocks()`.
  - **Messages:** `message.member` reads the guild's member cache, so a test that removes the author's member there gets `null`, as discord.js gives for an author it hasn't cached. A default message now caches its author and the author's member, as Discord's message event does. `message.mentions.has(user)` answers from what the content mentions.
  - **Defaults:** a role is not hoisted, managed or mentionable, with no icon, tags or colours. A member's `joinedTimestamp` is when the mock was made, so `partial` is `false`. A message has no `reference`, `poll` or stickers. `avatarURL()` and `iconURL()` are `null` without an avatar or icon, `displayAvatarURL()` is Discord's default avatar, and a mock client `isReady()`.
  - **User context menus:** `targetUser` is the user with `targetId`, the client's cached one or one made, and `targetMember` that user's member in a server. A `targetId` given later picks its user, and both stay assignable.

- [#431](https://github.com/meocord/meocord/pull/431) [`b24a0bc`](https://github.com/meocord/meocord/commit/b24a0bca78b72c602718a5a8f496251484f37bfe) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A mock still reads some values discord.js computes as a truthy placeholder: a message's `editable`, `deletable`, `pinnable`, `crosspostable`, `bulkDeletable`, `hasThread` and `partial`, a member's `manageable`, `kickable`, `bannable` and `moderatable`, a role's `editable`, a channel's `viewable`, `manageable` and `deletable` and its thread and voice counterparts, and `partial` on users, channels and reactions. A test that reads one now gets a warning, once per run, that 5.0 computes it as discord.js does, and how to set it on the mock, such as `message.editable = false`, to test either way. A value the test sets is read without a warning.

  `message.thread` is the thread the message's channel caches under the message's id, as discord.js reads it. Without one it is still a placeholder thread, with a warning that 5.0 gives `null` there.

- [#429](https://github.com/meocord/meocord/pull/429) [`961455d`](https://github.com/meocord/meocord/commit/961455d86534be61c2b22739240fa48d53564dd7) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Mocks from `meocord/testing` now pass to one another, and to the testing module, without a cast:

  - **A mock reached through a property that may be `null`** keeps its mock API, such as `message.member?.fetch.mockResolvedValue(member)` or `message.guild?.members.fetch`.
  - **An overloaded method's mock** takes what any of its overloads takes or resolves to, such as `guild.members.fetch.mockResolvedValue(member)` and `channel.messages.fetch.mockResolvedValue(message)`, where only the list form compiled before.
  - **`createMockInteraction` given `guild: null`, `member: null` or a DM channel** builds an interaction outside a server, typed so its `guild` and `member` may be `null`.
  - **`createMockMessage`** is typed as discord.js emits a message, so `module.emit('messageCreate', createMockMessage())` compiles.
  - **`createMockChannel(ThreadChannel)`** is typed as a public or private thread, as discord.js types every thread, so it fits an interaction's `channel`, a guild's channels and the `threadCreate` event.
  - **`getResponse(interaction).calls[n].payload`** is typed by the call's `method`: after `call.method === 'reply'`, it is the reply's options. `ResponseCall` itself is unchanged, so code that builds or extends one compiles as before.

## 4.1.0

### Highlights

- **Adds to 4.0.** Upgrading from 4.0, below, lists what may change for a 4.0 bot ([docs](https://meocord.dev/docs/4.1/whats-new)).
- **One way to answer.** `respond()`, `@Defer()` and presenters, in a theme's colours and emojis ([docs](https://meocord.dev/docs/4.1/responses)).
- **A pipeline around every handler.** Global guards, interceptors, filters, pipes, `@Cooldown` and observers, in one order ([docs](https://meocord.dev/docs/4.1/how-a-call-runs)).
- **Message command patterns.** Typed params, flags, aliases, usage replies and a built-in `!help` ([docs](https://meocord.dev/docs/4.1/message-commands)).
- **Sharding, providers and lifecycle.** Sharding in one process or a process per shard, with `ShardContext.call`, async providers, `onReady`/`onShutdown` and `app.stop()` ([docs](https://meocord.dev/docs/4.1/sharding)).
- **Localisation and testing.** Typed catalogs, and `MeoCordTestingModule` with Discord-shaped mocks ([docs](https://meocord.dev/docs/4.1/testing)).

### Upgrading from 4.0

- **Requirements.** Node.js 22.13+, discord.js 14.27.0+ and dotenv 18.0.5+: `npm install discord.js@^14.27.0 dotenv@^18.0.5`. Most 4.0 bots and tests run without edits ([guide](https://meocord.dev/docs/4.1/migrating#upgrading-from-40-to-41)).
- **Class guards cover inherited and autocomplete handlers.** Check guards that read command-only data or reply on denial; an autocomplete denial closes the menu ([guide](https://meocord.dev/docs/4.1/migrating#class-guards-now-cover-inherited-handlers)).
- **Base class stages cover subclasses.** A base controller's guards, interceptors, filters and cooldowns run first on its subclasses' handlers; `@Controller({ inheritStages: false })` opts out ([guide](https://meocord.dev/docs/4.1/migrating#a-base-controllers-class-stages-cover-its-subclasses)).
- **`applyDecorators(A, B)` applies in stack order.** Guards run in the order listed; reverse them to keep 4.0's order ([guide](https://meocord.dev/docs/4.1/migrating#applydecorators-applies-its-decorators-in-the-order-they-stack)).
- **Message keywords ignore case, and one handler runs.** They match word by word; set `caseSensitive: true` to match case. Two handlers on one keyword stop the bot, and an app `prefix` applies to keywords; use `{ prefix: false }` for bare messages ([guide](https://meocord.dev/docs/4.1/migrating#message-keywords-match-in-any-case-and-only-one-runs)).
- **Bot reactions are ignored**, the bot's own included. Add `{ bots: true }` to a `@ReactionHandler` that needs them, and recheck counts that subtracted the bot's own reactions ([guide](https://meocord.dev/docs/4.1/migrating#reactions-from-bots-reach-no-handler)).
- **Duplicate routes stop the bot.** Two component handlers matching the same customIds, two handlers of one command, or two builders of one command (4.0 warned) are refused, naming both. Registering a base controller with its subclass is refused the same way ([guide](https://meocord.dev/docs/4.1/migrating#two-handlers-of-one-command-stop-the-bot)).
- **A re-declared inherited route takes the subclass's options.** Its own builder or `@MessageHandler`/`@ReactionHandler` options apply; to keep the base's, don't re-declare it ([guide](https://meocord.dev/docs/4.1/migrating#a-re-declared-handler-that-keeps-its-inherited-route-logs-a-warning)).
- **Errors after a reply or deferral are answered.** A deferred reply becomes the error, and a replied command gets a private follow-up; an exception filter replaces it ([guide](https://meocord.dev/docs/4.1/migrating#errors-after-a-reply-or-deferral-are-answered)).
- **`Theme` follows the app's theme, with new defaults,** as do MeoCord's own answers: `Theme.errorColor` is `#E3606D`, not `#DC3545`, and the success, info and warning colours change too. Set `@MeoCord({ theme: { colors } })` to keep 4.0's ([guide](https://meocord.dev/docs/4.1/migrating#theme-is-deprecated-and-its-colours-changed)).
- **MeoCord's metadata keys start with `meocord:`.** `SetMetadata` refuses only those and the DI keys (inversify's injectable flag, `design:paramtypes`); read MeoCord's metadata with `inspectHandler` ([guide](https://meocord.dev/docs/4.1/migrating#setmetadata-refuses-meocords-own-keys)).
- **Activities rotate in order, only when set.** Without `activities`, MeoCord leaves the presence alone; with them, it starts at ready.
- **Reactions use the cached message.** `reaction.message` is fetched only when held by id alone; call `reaction.message.fetch()` for fresh data.
- **customId params arrive decoded.** `%2F` and `%25` reach the handler as `/` and `%`; drop your own decoding.
- **Logs and exit codes.** `[DEBUG]` prints only in development unless `logLevel` or `MEOCORD_LOG_LEVEL=debug` asks; `info()`/`verbose()` print `[INFO]`/`[VERBOSE]`, objects as `console.log` does, and a signal after a failed login exits 1. Skip it in a 4.0 `main.ts` catch with `if (!isExplainedError(error))` from `meocord/common`, or a refused token or intent logs twice ([docs](https://meocord.dev/docs/4.1/configuration#logging)).

### Upgrading builds and the CLI

- **A mistyped config option stops `build`, `start` and `register`,** listing every problem; unknown options only warn ([guide](https://meocord.dev/docs/4.1/migrating#a-config-option-of-the-wrong-type-stops-the-cli)).
- **Config and assets load beside `dist/main.js`.** `.env` still loads from the working directory, so set it there when starting elsewhere. Rebuild ([guide](https://meocord.dev/docs/4.1/migrating#smaller-changes)).
- **`NODE_ENV` follows the mode.** `build --prod` compiles `meocord.config.ts` as production, and `start --dev` runs the bot as development whatever the shell sets. On Bun, start production with `NODE_ENV=production`, or `.env.development` loads first, with a warning ([guide](https://meocord.dev/docs/4.1/migrating#smaller-changes)).
- **No `eval` devtool.** Development builds use `cheap-module-source-map`, and `eval-*` becomes its non-eval form with a warning. Set `sourceMappedStacks: false` for trackers that apply uploaded source maps ([docs](https://meocord.dev/docs/4.1/configuration#stack-traces)).
- **`meocord/eslint` flags unawaited promises.** `await`, `return` or `void` them, or turn the rule off ([guide](https://meocord.dev/docs/4.1/migrating#smaller-changes)).
- **The generated rate-limit guard never limited.** Move its map to module level, or use `@Cooldown` ([guide](https://meocord.dev/docs/4.1/migrating#the-generated-rate-limit-guard-limits)).
- **What a 4.0 app can copy.** New apps read every `.env` file and type asset imports; add the `swc` `include` for coverage of untested files. An app created for pnpm adds `reflect-metadata`, `@types/node` and a `pnpm-workspace.yaml`, and one installed with npm 11.16+ adds `allowScripts` to `package.json` ([guide](https://meocord.dev/docs/4.1/migrating#installing-with-pnpm-or-npm-1116-and-later)).

### Upgrading your tests

- **Mocks have distinct snowflake ids.** Pass `{ user: first.user }` to share a user. A mock without `guildId` is a DM, a given channel sets `channelId`, `guildId` and `guild`, and a member given to `createChatInputOptions` fills a `User` param with the `User`, where 4.0 passed the `GuildMember` ([guide](https://meocord.dev/docs/4.1/migrating#smaller-changes)).
- **Handler arguments are type-checked.** Select menu choices and plain-string customId params that never matched now fail to compile ([guide](https://meocord.dev/docs/4.1/migrating#smaller-changes)).
- **Changed messages.** Load-time refusals start with `Class.method:`, and a `@Command` given the wrong interaction names the handler, not "Invalid interaction type passed to `@Command`". A modal mock's `isFromMessage()` needs a `message`, and autocomplete `respond()` rejects over 25 choices.
- **Option mocks resolve as Discord's.** `getMember()` returns the member, `null` in a DM. A getter of another type, `getInteger()` on a fraction (use `getNumber()`), `getChannel()` on a channel type the option doesn't allow, or `getSubcommand()` with no subcommand throws discord.js's error, where 4.0's mock returned `null` (`getSubcommand(false)` reads none as `null`); only a user or member read as a role, or the reverse, stays `null`.
- **Load `.env` in tests yourself,** in the vitest setup or with `dotenv`, if a suite relied on an earlier build for it.

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
- **`ThemeResolver` classes** look themes up with the app's services: `themeFor` takes one, resolved from the container, cached as the functions are ([docs](https://meocord.dev/docs/4.1/theming#per-server-and-per-user)).
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
- **`meocord create`** commits the lockfile, adds `npm start`, writes samples whose specs test what they answer, and makes its first commit by running git directly, so MeoCord no longer installs `simple-git`.
- **`meocord generate`** adds observers, filters, interceptors and pipes, a customId per component, and specs that test the answer.
- **`meocord start --dev`** restarts on source, config, `tsconfig.json` and dev `.env` changes, one bot at a time, keeping the last good build while code doesn't compile ([docs](https://meocord.dev/docs/4.1/cli)).
- **`.env` files**: a new app reads `.env.<mode>.local`, `.env.local`, `.env.<mode>` and `.env` on every runtime.
- **Self-contained builds** pack native addons from any package manager and run on Bun too; `optionalExternals` covers optional packages ([docs](https://meocord.dev/docs/4.1/self-contained-builds)).
- **Source-mapped stacks and `logLevel`**: traces name your source lines in production too, and `logLevel` or `MEOCORD_LOG_LEVEL` sets what prints ([docs](https://meocord.dev/docs/4.1/configuration)).
- **`dist/cli.json`** describes every CLI command and option as data.

### Deprecations

- **Names removed in 5.0.** Each still works and its JSDoc names the replacement. A new app's ESLint config sets `@typescript-eslint/no-deprecated` to warn outside specs, which finds them; add it to a 4.0 app's config.
  - `Theme`: use `useTheme().colors` and `@MeoCord({ theme })`; reading or setting a colour warns once ([guide](https://meocord.dev/docs/4.1/migrating#theme-is-deprecated-and-its-colours-changed)).
  - `SetMetadata` and string metadata keys: use `createMetadata` and `ExecutionContext.get(decorator)`; each warns once ([guide](https://meocord.dev/docs/4.1/migrating#setmetadata-and-string-metadata-keys-are-deprecated)).
  - `ReactionHandlerOptions`: renamed `ReactionEvent` ([guide](https://meocord.dev/docs/4.1/migrating#reactionhandleroptions-is-now-reactionevent)).
  - `MetadataKey`, `CommandMetadata`, `AutocompleteMetadata`: internal; drop the import ([guide](https://meocord.dev/docs/4.1/migrating#metadatakey-commandmetadata-and-autocompletemetadata-are-deprecated)).
- **`@Autocomplete<void>` loses its type parameter in 5.0.** Lint misses it: search for `@Autocomplete<` and write `@Autocomplete(…)`.
- **Retrying `start()` after a failed login warns,** logging in again with its handlers, and rejects in 5.0. Make a new app with `MeoCordFactory.create` per attempt; retrying after a provider failure stays supported ([guide](https://meocord.dev/docs/4.1/migrating#retrying-start-after-a-failed-login-is-deprecated)).
- **`@Controller`, `@Service`, `@Guard`, `@CommandBuilder` or `@MeoCord` on a method** applies nothing, as in 4.0, and warns; 5.0 refuses it. Move it to the class ([guide](https://meocord.dev/docs/4.1/migrating#a-class-decorator-on-a-method-logs-a-warning)).
- **`@MessageHandler('')` warns,** and 5.0 refuses it. Write `@MessageHandler()` ([guide](https://meocord.dev/docs/4.1/migrating#messagehandler-logs-a-warning)).
- **Handlers that never run warn at startup,** and 5.0 refuses to start:
  - a command or autocomplete handler Discord never sends, such as an unregistered subcommand path, a renamed builder or an option without autocomplete ([guide](https://meocord.dev/docs/4.1/migrating#a-command-handler-discord-never-sends-logs-a-warning));
  - a second `@Autocomplete` for one option ([guide](https://meocord.dev/docs/4.1/migrating#a-second-autocomplete-for-one-option-logs-a-warning));
  - a command, message, reaction or autocomplete handler on a class that isn't a controller ([guide](https://meocord.dev/docs/4.1/migrating#a-handler-on-a-class-that-isnt-a-controller-logs-a-warning)).
- **Changes in 5.0, warned now:**
  - a re-declared handler on another route still answers its inherited one; in 5.0 its own routes replace it ([guide](https://meocord.dev/docs/4.1/migrating#a-re-declared-handler-that-keeps-its-inherited-route-logs-a-warning));
  - between equally specific overlapping component patterns, the first listed runs; in 5.0, the more spelled-out one does ([guide](https://meocord.dev/docs/4.1/migrating#overlapping-component-patterns-meocord-5-prefers-the-one-that-spells-out-more)).

### Fixes to 4.0 behaviour

- **Running the bot**
  - Retrying `app.start()` after a failed login no longer attaches every handler twice.
  - `node dist/main.js` has the config's `.env` values before the app's modules run. Rebuild.
  - A refused privileged intent, or a refused or empty token, is explained in one line with where to fix it.
  - A builder that can't be built is named with its command in the registration error.
  - A builder on a subcommand path is named with the fix, not "Invalid string format"; one naming its own command still works, with a warning.
  - One SIGINT and SIGTERM listener per process: many apps no longer trigger `MaxListenersExceededWarning`.
  - A signal during login stops the bot at once, with "Bot has shut down".
  - A missing or broken built config is reported once, with the file, reason and fix.
  - Reactions in uncached DMs reach their handlers again on discord.js 14.26.2 and later.
- **Routing and dispatch**
  - A click a discord.js collector answers no longer gets "Command not found!".
  - A user and a message context menu of one name each reach their own handler.
  - Overlapping component patterns are warned about at startup, not the first click.
  - A subclass controller no longer adds its handlers to its base class.
- **Dependency injection**
  - A subclass with its own constructor gets its own dependencies.
  - `@inject(Token)` on an interface-typed parameter works, not "missing metadata on type Object".
  - An injection cycle is refused naming it, not "Circular dependency found: (No dependency trace)".
  - A constructor parameter with no runtime type is refused naming the class and parameter, not inversify's `emitDecoratorMetadata` error.
  - A class with no decorator whose constructor injects, guards, interceptors, filters and pipes included, is refused as the app starts naming the class and the decorator to add, not inversify's missing-metadata error, which a guard gave only at its first call.
  - A guard in `services` or `providers`, or injected into a service, reads each call's own `params`; one with a setter param or a sealed instance shares them, with a warning.
  - A guarded method called directly on any class the app runs, a provider's class included, or on a subclass of one, runs its guards, not "Cannot read properties of undefined (reading 'get')"; on an instance no app made, it says to inject the class.
- **Handler types**
  - A handler may return a value or take fewer parameters, not "Unable to resolve signature of method decorator".
  - `applyDecorators` passes on what a wrapping decorator returns.
- **Builds**
  - Production builds keep class names, where a clash renamed `Shop` to `shop_controller_Shop`.
  - Imported files land in `dist/assets` under their own names; a WebAssembly module takes a content hash.
  - On Windows, `new URL('./file', import.meta.url)` gives a `file:` URL, not a `c:` path `fileURLToPath` refused with `ERR_INVALID_URL_SCHEME`. Rebuild.
  - A `tsconfig.json` with `extends`, `files`, `typeRoots`, comments or `baseUrl` paths builds as TypeScript reads it, is never rewritten, and concurrent builds no longer clash.
  - Self-contained builds run under Bun and pack each package's installed dependency versions, npm-nested and pnpm-store dependencies, and per-platform binaries, fixing "Cannot find module". Rebuild.
- **The CLI**
  - `meocord start` forwards SIGINT and SIGTERM, so Docker, pm2 and systemd stop the bot cleanly.
  - `start --dev` runs one bot at a time, restarts it through its own shutdown on Windows, starts it again on the next rebuild after it exits on its own, which one Ctrl+C then stops, and keeps it running when a save doesn't compile or an `rsbuild` hook throws.
  - `start --dev --build` builds once, and `start --dev` exits 1 when watching can't start.
  - `create` keeps the app when git can't commit, joins an enclosing Git repository, quotes any app name, and refuses a name with no letters or digits, not `Directory "" already exists`.
  - A created app passes `lint` and `test` on pnpm and installs on pnpm 11+ and npm 11.16+ without warnings; `create` warns on Node.js 22.0 to 22.12.
  - `generate` works on Windows, writes lint-clean files formatted in one ESLint run, and refuses a name outside `src/`, with `\` separating folders on Windows.
  - `build` and `start --prod` don't clear the screen, `start --dev` keeps scrollback, and no command writes screen-clearing codes into piped output.
  - `--help` no longer prints "No available choices.".
  - The CLI runs at the filesystem root, not "Cannot locate the "MeoCord" package directory".
  - `require('meocord/package.json')` resolves, and `meocord/eslint` ignores `coverage/`.
- **Logging**
  - `Logger` prints any value, a `Symbol` included, and colours a line only when its own stream is a terminal.
  - Log lines escape what a user sent, and shorten long message text, with its length.
  - A project that loads meocord with `require()`, as CommonJS code or Jest in CommonJS mode does, logs again: every `Logger` method threw `chalk.bold is not a function`. Built bots were not affected.
  - The CLI and tests no longer read the app's name or `.env` from a stale `dist`.
- **Testing**
  - Mocks have an `'en-US'` locale, `createdTimestamp` and `createdAt`, a working `inGuild()` and resolving promise methods.
  - A mock interaction without a `client` gets one from `createMockClient`, and `getAttachment()` returns the `Attachment` given, or `null`.
  - `createMockChannel` takes `ThreadChannel`, stubs `threads.create` on text, announcement, forum and media channels, and gives a subclass its base's managers.

### Security

- **`Logger` no longer writes the bot token to logs** ([GHSA-62w2-fp4p-4jq8](https://github.com/meocord/meocord/security/advisories/GHSA-62w2-fp4p-4jq8)). In 4.0.0, a discord.js object a bot logged through `Logger`, such as an interaction, a message or the client, printed with every property, the token included. 4.0.1 fixed it, and 4.1.0 has the fix: `Logger` prints objects as `console.log` does and replaces the token with `[redacted]`. Coming from 4.0.1, nothing changes. Coming from 4.0.0, if a bot logged such objects and others can read its logs, reset the token in the Discord Developer Portal.

## 4.1.0-beta.12

### Minor Changes

- [#411](https://github.com/meocord/meocord/pull/411) [`abaf630`](https://github.com/meocord/meocord/commit/abaf630dbb833940238590d71e7efc33809a3fa7) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `@MeoCord({ themeFor })` takes a class implementing the new `ThemeResolver` interface, so a theme can be looked up with the app's services, such as a user's saved choice in a database a provider connects. Its `guild()` and `user()` methods are optional and typed as the functions are. The class is resolved from the app's container like the cooldown store: it isn't listed in `providers`, its constructor injects the app's services and providers, and it runs `OnReady` and `OnShutdown` in dependency order. Its results are cached, timed out and logged as the functions' are, and `ThemeCache` clears them. In tests, `fromApp` binds it, `overrideProvider` replaces it or what it injects, and `overrideThemeFor` takes a class too. See [Theming](https://meocord.dev/docs/4.1/theming).

### Patch Changes

- [#412](https://github.com/meocord/meocord/pull/412) [`c934277`](https://github.com/meocord/meocord/commit/c9342771cf87c894e2f0452e1450b1b6d28a74b5) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A class whose constructor injects but which has no decorator is refused as the app is created, naming the class and the decorator to add, rather than with inversify's `Found unexpected missing metadata on type …` error, at startup or, for a guard, at its first call. The advice is the class's own: `@Controller()` for a listed controller; `@Guard()`, `@Interceptor()`, `@Catch()` or `@Pipe()` for a guard, interceptor, filter or pipe, global or on a handler; `@Service()`, or a provider in `@MeoCord({ providers })` for a class from a package, for any other. Injecting one of MeoCord's classes an app makes itself, such as `Logger` or an error, is refused saying how to make it instead. A subclass whose constructor takes its decorated base's types, a parameter with a default value and a rest parameter are created as before.

## 4.1.0-beta.11

### Minor Changes

- [#401](https://github.com/meocord/meocord/pull/401) [`ae9d548`](https://github.com/meocord/meocord/commit/ae9d548775b552e1af20b12199b56dd87c67c90f) Thanks [@l7aromeo](https://github.com/l7aromeo)! - MeoCord asks for `discord.js` 14.27.0 or later and `dotenv` 18.0.5 or later as peers. A bot on an older `discord.js` 14 or `dotenv` 18 upgrades them with MeoCord: `npm install discord.js@^14.27.0 dotenv@^18.0.5`, or the same with your package manager.

  MeoCord's own dependencies move to their latest stable releases, and `meocord create` makes the new app's first commit by running `git` directly, so installing MeoCord no longer pulls in `simple-git`. A new app starts on the latest stable releases of its tools, with TypeScript held at 6.0.3.

### Patch Changes

- [#403](https://github.com/meocord/meocord/pull/403) [`ec97a2f`](https://github.com/meocord/meocord/commit/ec97a2f4a9172c9ed6b9ddb99f7378353f1a0e7b) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A self-contained build that copies one package into `dist/node_modules` says "holds 1 package", not "1 packages".

- [#407](https://github.com/meocord/meocord/pull/407) [`4d91448`](https://github.com/meocord/meocord/commit/4d91448a936da9c11feb5aa2bca3ddb013b95275) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `require('meocord/common')`, and every other entry point a CommonJS project loads with `require()`, logs again: `Logger`'s `log()`, `info()`, `verbose()` and `debug()` threw `TypeError` there, as the CommonJS build read `chalk`, a package that ships only as an ES module, without its default export. A bot built with `meocord build` was not affected, since its bundle loads the ES module build.

- [#410](https://github.com/meocord/meocord/pull/410) [`ca34a30`](https://github.com/meocord/meocord/commit/ca34a30335d72d0b6fef87628fb667adf8bddd2c) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A decorator applied where it can't work is now named where it applies, directly or inside an `applyDecorators` composite:

  - **A decorator that goes only on a method, on a class,** stops the bot as the class loads, with one line naming the class: `Shop: @Defer goes on a method, not on a class.` This covers `@Command`, `@Autocomplete`, `@MessageHandler`, `@ReactionHandler`, `@On`, `@Once`, `@Validate`, `@UsePipe` and `@Defer`, and `@Inject`, which goes on a constructor parameter or a property. `@Defer`, `@Validate`, `@UsePipe`, `@On` and `@Once` did nothing there, and the handler decorators failed with a `TypeError`.
  - **`@Interceptor`, `@Catch`, `@Pipe` and `@Observer` on a method** stop the bot the same way: `Shop.buy: @Interceptor goes on a class, not on a method.`
  - **`@Controller`, `@Service`, `@Guard`, `@CommandBuilder` and `@MeoCord` on a method** still apply nothing, as in 4.0, and now log a warning once: `@Guard on the method Shop.buy is deprecated; in the next major version (5.0) it is refused. Use @Guard on a class instead.` Move the decorator to the class.

  Decorators that go on a class or a method, such as `@UseGuard`, `@Cooldown`, `@UseTheme` and those `createMetadata` makes, apply as before. See [Custom decorators](https://meocord.dev/docs/4.1/custom-decorators).

- [#409](https://github.com/meocord/meocord/pull/409) [`ca62ec5`](https://github.com/meocord/meocord/commit/ca62ec523545205fedadd4516ed96ae52655e1e7) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `createChatInputOptions` reads options as discord.js does, and throws discord.js's own errors: each a `DiscordjsTypeError` with discord.js's code and message.

  - A getter of another type throws discord.js's type error, such as `Option "x" is of type: 4; expected 3.`, with or without `required`: `getString()` on a number, `getInteger()` on a fraction, `getChannel()` on a user. A user or member read as a role, or a role read as a user or member, is `null`, or that error when `required`, as the option may be a mentionable one.
  - A missing required option throws `Required option "x" not found.`, `getSubcommand()` throws `No subcommand specified for interaction.` unless given `false`, as in discord.js, `getSubcommandGroup(true)` and `getFocused()` throw discord.js's messages, and `getChannel()` checks the channel types it's given.
  - `get()` returns the option as discord.js does, and `getMessage()` reads no option of a slash command.
  - Options assigned to a mock interaction after it is created, as with `interaction.options = createChatInputOptions({ target })`, belong to it, so `getMember()` is the server's cached member, or `null` in a DM.

- [#406](https://github.com/meocord/meocord/pull/406) [`6958c64`](https://github.com/meocord/meocord/commit/6958c6422454bf6b11fe1ebdfc3a9ab20a873f43) Thanks [@l7aromeo](https://github.com/l7aromeo)! - MeoCord keeps its own metadata under keys beginning `meocord:`, so `SetMetadata` takes any key a 4.0 bot used, such as `'guards'` or `'commandType'`, and stores it as 4.0 did. It refuses only a key beginning `meocord:` and the two keys dependency injection reads, `design:paramtypes` and inversify's injectable flag. A 4.1 beta refused `'guards'`, `'commandType'` and `'inversify:container'`, so a 4.0 bot that set one of them failed to load.

  Code that read MeoCord's guard list or a builder's command type under `'guards'` or `'commandType'` no longer finds them there. To read the guards a handler runs, use `inspectHandler` from `meocord/testing`.

  Every key MeoCord keeps its metadata under is now such a string, so a test or a tool that loads both meocord's CommonJS and ES module entries sees a controller one of them decorated from the other, where it found none.

- [#402](https://github.com/meocord/meocord/pull/402) [`2be278a`](https://github.com/meocord/meocord/commit/2be278a504158721fc6ab2f6bb6d2e6773e94ce4) Thanks [@l7aromeo](https://github.com/l7aromeo)! - - **A bot that imports two or more WebAssembly modules builds again.** Each imported module is written to `dist/assets` under a content hash, as `<hash>.module.wasm`. A wasm file read through `new URL('./file.wasm', import.meta.url)` keeps its own name.
  - **`new URL('./file', import.meta.url)` for a bundled file gives a `file:` URL on Windows.** It was built on the bundle's directory as a disk path, which a URL reads as scheme `c:`, so `fileURLToPath` threw `ERR_INVALID_URL_SCHEME`. The URL is now relative to the bundle on every platform.

## 4.1.0-beta.10

### Minor Changes

- [#295](https://github.com/meocord/meocord/pull/295) [`a304494`](https://github.com/meocord/meocord/commit/a304494919b8a4cda5d1cf6609caf534ee8d96cc) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Stop a bot from code with `app.stop()`. It runs the `onShutdown` hooks under your `shutdownTimeout` and closes the client, so an owner-only shutdown command, a graceful restart or an integration test needs no signal. A bot in one process keeps its process running. With process sharding, the manager's `stop()` asks every shard to shut down and waits for it, and keeps the manager running. Called in a shard, `stop()` asks the manager to stop every shard, so it stops the bot whichever process calls it; that shard's process ends with the others. A stop while the bot logs in ends that login, so its `start()` rejects. Calls after the first wait for it, and a stopped app does not start again: use `MeoCordFactory.create` to make a new one. A client that fails to close, or a shard the manager has to kill, sets `process.exitCode` to 1, unless another code is set, so the process exits as a signal's shutdown would. A signal, or a shard manager's request, that comes while `stop()` runs waits for its hooks to finish rather than exiting at once.

  ```ts
  const app = MeoCordFactory.create(App)
  await app.start()
  // later
  await app.stop()
  ```

  A SIGINT or SIGTERM after a failed login now exits with the code the failed login set, 1, where 4.0 exited 0, so a process supervisor no longer reads a bot that never came online as a clean stop. See [the upgrade guide](https://meocord.dev/docs/4.1/migrating#smaller-changes).

- [#310](https://github.com/meocord/meocord/pull/310) [`79015cf`](https://github.com/meocord/meocord/commit/79015cfff42a11e817ab18bb0e66edc5153bab49) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `applyDecorators(A, B)` now applies its decorators as `@A @B` does, stacked in the order written: `B` first, then `A`. It applied them the other way round, so guards listed in it ran in the reverse of the order written, and moving stacked decorators into `applyDecorators` changed what ran first. A method or class a decorator returns in place of the one it was given, as a wrapping decorator does, now reaches the next decorator and TypeScript; it was dropped.

  `applyDecorators(UseGuard(A), UseGuard(B))` now runs `A` before `B`. To keep 4.0's order, write `applyDecorators(UseGuard(B), UseGuard(A))`. The same holds for interceptors, pipes and filters composed this way. See [the upgrade guide](https://meocord.dev/docs/4.1/migrating#applydecorators-applies-its-decorators-in-the-order-they-stack).

- [#326](https://github.com/meocord/meocord/pull/326) [`a3c2a2e`](https://github.com/meocord/meocord/commit/a3c2a2e5f6e116d80ce3112b63df99687dc46c63) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A catalog message shows a brace as text when it is written twice, and a translator says when a key has no message.

  - `{{` and `}}` are one brace each, when the code compiles and when translating, so `'Buttons use ticket/{{id}}'` shows `ticket/{id}` and takes no `id` param. A 4.1 beta catalog that writes `{{name}}` for a param inside braces now shows `{name}` as written; write `{{{name}}}` instead.
  - `localizations(key)` takes only a message without `{params}`, as Discord shows a name or description as written. Another key fails to compile, or, in a catalog the compiler can't read, such as a JSON file, throws as the app loads. A translation with a `{param}` is left out, so Discord shows the default for that locale, and `expectCompleteCatalog` reports it.
  - In development, a key with no message, or one naming a group of messages, logs a warning once, since the key is shown in its place.

  See [Localisation](https://meocord.dev/docs/4.1/localisation).

- [#399](https://github.com/meocord/meocord/pull/399) [`24f33e2`](https://github.com/meocord/meocord/commit/24f33e2bc0652cee90ba5cf436d7cc4808fbbd22) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Fixes in `meocord/common`:

  - **A send Discord could not read is logged as an error.** When a reply, an edit, a direct message or an acknowledgement fails, MeoCord still logs a refusal for something Discord reports at debug level, such as a missing permission, an interaction already answered or a message already gone. A body Discord could not read is logged as an error with its cause: an invalid form body (`50035`), invalid JSON (`50109`) or an empty message (`50006`). Only the code that built the request can fix those, and they were logged at debug, where they went unseen.
  - **`RedisCooldownStore` on Redis Cluster counts a call against all of a handler's keys or none.** When a handler's cooldowns sit in different slots, each key is counted by a script of its own. If a later key's script fails, the uses already counted are now given back before the failure is reported, so the call does not leave earlier keys counted for a call that was refused.
  - **`RedisCooldownStore`'s error for a reply it cannot read** describes the reply it expects, including the wait's end on a refusal.
  - **`meocord/common` exports `ResponseLockOptions`**, the options `respond(interaction).lock()` takes, so a helper that passes them on can type them.
  - **`MemoryCooldownStore` keeps its key count and its sweep to itself.** It dropped expired keys once a minute through a public `sweep()`, beside a `size` getter, both of them for MeoCord's tests. Neither is part of the store's API, and code that called them uses the store as any other `CooldownStore`.
  - **A catalog's `meocord` group with a text where MeoCord has a group** is refused with one message naming it, such as "meocord.usage is a group, not a text", where it named every property of a string.

- [#349](https://github.com/meocord/meocord/pull/349) [`380a2a8`](https://github.com/meocord/meocord/commit/380a2a8d275972f0b8a9aafd9ba2268e08f5e4e7) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A call refused because the cooldown store answered too late no longer costs its caller a use. Under `cooldownStoreFailure: 'deny'`, the default, a store slower than `cooldownStoreTimeoutMs` refused the call with "try again shortly", yet its late answer still recorded it, so the retry was told to wait the whole window although the handler never ran: a `/daily` was lost. Now `@Cooldown` gives that use back.

  `CooldownStore.consumeMany` may return a verdict with `release()`, which undoes the call it recorded. `MemoryCooldownStore`, `RedisCooldownStore` and `ShardedCooldownStore` give it, and `@Cooldown` calls it for any call it has already refused when the late answer arrives. A store of your own can add it to the verdict its `consumeMany` returns; one without it keeps such a call counted, as before, and `testCooldownStore` checks either. Under `'allow'`, the call ran uncounted, so the late count is its own and stays.

  `RedisCooldownStore` now stores each call under its nonce alone, which `release` removes; calls recorded before the upgrade leave their windows as usual. On Redis Cluster, where a handler's keys sit in different slots without `hashTag: 'handler'`, each key is counted by a script of its own: a call counted that way is given back on every key, and a cooldown that refuses it gives back the keys counted before it, so the call counts against all of them or none, as on a single node.

- [#372](https://github.com/meocord/meocord/pull/372) [`efe4518`](https://github.com/meocord/meocord/commit/efe451814b4ebc1fc66357210124abb334ba9b86) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A cooldown store's refusal can say when the next call is allowed: `CooldownVerdict.retryTimestamp`, a Unix timestamp in milliseconds on the store's own clock. Every refusal in one wait gives the same one. `MemoryCooldownStore`, `RedisCooldownStore` and `ShardedCooldownStore` give it, and `messages.dmOnCooldown` tells one wait from the next by it. A store of your own can add it to its refusals; without it, waits are told apart by `retryAfterMs` and the bot's clock, as before. `testCooldownStore` checks a store that gives it.

- [#352](https://github.com/meocord/meocord/pull/352) [`5667989`](https://github.com/meocord/meocord/commit/56679894422c4b962d3a2688b857852b88155208) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A cooldown's wait is shown as a Discord timestamp, so a daily cooldown no longer says "try again in 1440m". The built-in answer to a blocked call, in replies, DMs and the presenter, is the new `meocord.cooldown.until` text, "Slow down: try again {when}.", where `{when}` is `<t:…:R>`: Discord words it in the reader's language and counts it down. The time is rounded up to the second, so it never reads as now while the call is still refused.

  For a bot upgrading from an earlier 4.1 beta: `meocord.cooldown.seconds`, `meocord.cooldown.minutes` and `meocord.cooldown.wholeMinutes` are gone. Translate `meocord.cooldown.until` instead, keeping `{when}`.

  `CooldownError` gains `retryAt`, the `Date` the next call is allowed, and `limit`, the `uses` and `windowMs` of the cooldown that blocked the call, so a filter or presenter needs no arithmetic: `time(error.retryAt, 'R')` from discord.js gives the same timestamp. Its `message`, which reaches logs and tests, stays plain text, now in the two biggest units that fit, and `cooldownMessage()` gives the same. For a wait of an hour or more that changes what it says: "Slow down: try again in 1439m." now reads "Slow down: try again in 23h 59m.", so a test that matches it changes too.

- [#376](https://github.com/meocord/meocord/pull/376) [`5a58dc1`](https://github.com/meocord/meocord/commit/5a58dc14ad346a844baa0f220f8c37784e61634b) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `@MeoCord`'s options and `@Validate`'s pipes have names you can import:

  - **`MeoCordOptions`**, from `meocord/decorator`, is what `@MeoCord` takes, each option documented where your editor shows it as you write the object. Name a base two app classes share with it; its guard, interceptor and filter lists are still checked against the classes they hold.
  - **`ValidatePipes<S>`**, from `meocord/interface`, is the pipes `@Validate` takes for schema `S`, so a decorator of your own that wraps `@Validate` checks the pipes it passes on against the schema, as `@Validate` does.

  A misused decorator's message names it more exactly: `@Command` called with the wrong interaction names the builder it was declared with, as `@Command('stats', StatsBuilder)`, and puts the right article before the class, `an AutocompleteInteraction`; a stage entry that is a string is quoted, `"Allow" is not a class`, and one that is a list, as `guards: [[StaffGuard]]` writes, is named as one, `an array is not a class`, rather than `{ provide } does not name a class`.

- [#296](https://github.com/meocord/meocord/pull/296) [`90d859c`](https://github.com/meocord/meocord/commit/90d859c4ef0733793ce061c68447f1b3fb84cbab) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `ReactionEvent` names the second argument a `@ReactionHandler` method receives, `{ user, action }`. `ReactionHandlerOptions` stays as a deprecated alias of it: every other `…Options` type is something you pass in, to a decorator, a function or a constructor.

  These are deprecated, and removed in the next major version (5.0). Each still works in 4.x, and its JSDoc names what to use instead:

  - `ReactionHandlerOptions`: use `ReactionEvent`. See [the upgrade guide](https://meocord.dev/docs/4.1/migrating#reactionhandleroptions-is-now-reactionevent).
  - `SetMetadata`: use `createMetadata`. It logs a warning once.
  - `ExecutionContext.get(key)` and `getAll(key)` with a string or symbol key, and the same on a `HandlerRegistry` entry: pass a decorator made by `createMetadata`. They log a warning once. See [the upgrade guide](https://meocord.dev/docs/4.1/migrating#setmetadata-and-string-metadata-keys-are-deprecated).
  - `respond()`'s `ephemeral` option: use `flags: MessageFlags.Ephemeral`. It logs a warning once.
  - `Theme` and its colours: read `useTheme().colors`, and set the colours in `@MeoCord({ theme })`. Reading a `Theme` colour now logs a warning once too, as assigning one already did. See [the upgrade guide](https://meocord.dev/docs/4.1/migrating#theme-is-deprecated-and-its-colours-changed).
  - `MetadataKey`, `CommandMetadata` and `AutocompleteMetadata`: internal names with nothing to use instead. In the next major version (5.0) they are no longer exported. See [the upgrade guide](https://meocord.dev/docs/4.1/migrating#metadatakey-commandmetadata-and-autocompletemetadata-are-deprecated).

  Run ESLint with `@typescript-eslint/no-deprecated`, as a new app's config does, to find every use in your code.

- [#367](https://github.com/meocord/meocord/pull/367) [`a497b6e`](https://github.com/meocord/meocord/commit/a497b6e266b199e54b9c0e27646247c1e4fe6043) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `meocord start --dev` fixes:

  - **A save that doesn't compile leaves the bot running.** A build with errors emitted a bundle that throws them, and the bot restarted onto it. Now a build with errors emits nothing and restarts nothing, and the bot keeps running its last good build until the code compiles again.
  - **Ctrl+C while watch mode restarts the bot** joins that shutdown, so the bot's `onShutdown` hooks finish and the session exits 0. A second Ctrl+C still stops it at once.

  A new app reads the same .env files on every runtime and however it is started, `meocord start` or `node dist/main.js` under pm2, systemd or Docker: `.env.<mode>.local`, `.env.local` (not under `test`), `.env.<mode>` and `.env`, a more specific file winning and the shell over all of them, as Bun reads them. An app made before this keeps `import 'dotenv/config'`, which reads `.env` alone under node, as 4.0 did. To read them all, replace that import in `meocord.config.ts` with:

  ```ts
  import { config } from 'dotenv'

  const mode = process.env.NODE_ENV || 'development'
  config({
    path: [`.env.${mode}.local`, ...(mode === 'test' ? [] : ['.env.local']), `.env.${mode}`, '.env'],
    quiet: true,
  })
  ```

  On Bun, set `NODE_ENV=production` where you start a production bot yourself, as with `bun dist/main.js` under pm2, systemd or Docker. With `NODE_ENV` unset, Bun loads `.env.development` and `.env.development.local` before any code runs, and dotenv keeps what is already set, so their values win over `.env.production`. The bot now warns when that happens, naming the variables that hold a development value: "Bun loaded .env.development because NODE_ENV is unset, and this is a production build, so API_URL has its development value; set NODE_ENV=production, or start with `bun --no-env-file`." `meocord start --prod` sets `NODE_ENV=production` already.

  `meocord build --prod` compiles `meocord.config.ts` in production mode, as it builds the bot, so `process.env.NODE_ENV` in the config reads `production` in a production build however the bot is started. It read `development`, the mode the config was always compiled in. So a config that branches on `NODE_ENV`, such as to register commands to a development guild, now takes its production branch in a production build: check what that branch does before you deploy, and rebuild to pick this up.

- [#301](https://github.com/meocord/meocord/pull/301) [`a2991bf`](https://github.com/meocord/meocord/commit/a2991bf65b27b362d78d478da81ea63f9a07acf1) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `meocord/eslint` turns on `@typescript-eslint/no-floating-promises`. A promise nothing awaits, such as `respond(interaction).send()` or a database write left without `await`, rejects outside every handler MeoCord runs, so its error reaches no exception filter and can end the bot. An interceptor's `next.handle()` left that way runs the code after it before the handler starts, so that code never sees the handler's result or error.

  After upgrading, `bun run lint` may report calls like these in your code. Each one is a promise that runs on its own:

  - `await` it, or `return` it, where the code after it should wait, as an interceptor's `next.handle()` always should;
  - or write `void` before it where it is meant to run on its own, and handle its failure with `.catch()`.

  To keep the previous behaviour, set the rule to `'off'` in your `eslint.config.ts`.

- [#320](https://github.com/meocord/meocord/pull/320) [`404ba3c`](https://github.com/meocord/meocord/commit/404ba3c9f320855cc01f6c568f6c2a8434ceaa5d) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `getResponse(interaction)` reports every answer a mock interaction got, whether the handler made it through `respond()` or with discord.js directly, such as `interaction.reply()` or `interaction.followUp()`. Before, it reported only what `respond()` made, so a handler written with discord.js's own methods showed `sent: true` with no `calls`, and a test had to read the mock's methods instead. Each call appears once, in the order made, with what it sent, without `withResponse`, and the `error` of one Discord refused. A test asserting the old `calls` of a handler that mixes the two now sees the direct calls too.

- [#373](https://github.com/meocord/meocord/pull/373) [`e01776a`](https://github.com/meocord/meocord/commit/e01776a3eba3859e4e338c7bc2b587f9bd0e0f85) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `meocord/common` exports `LocalizationKey<C>`, the keys `Translator.localizations()` takes: a single string with no `{params}`. The method's parameter used that type without a name you could import, so a helper that forwards a key to `localizations()` could not type it. `StringMessageKey<C>`'s documentation no longer says it is the type command names and descriptions need, and `TranslatorOptions` and `CatalogDefinition` are listed with the other localisation types.

- [#312](https://github.com/meocord/meocord/pull/312) [`32ede56`](https://github.com/meocord/meocord/commit/32ede56d5a4af6852ad9da9ac43aa11a9b93636e) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `meocord/testing`'s mock channels, and the managers that fetch, answer as discord.js does, and `createMockMessage` takes the `channel` it was sent in.

  - An interaction's `channel` is a text channel of its server, the one the server caches under `channelId`, or the user's DM channel in a DM. It was a stub, whose `send()` and `isTextBased()` threw. A `channel` given still wins.
  - A message's `channel` is a text channel of its server, cached there, or the author's DM channel for a DM. It was a bare text channel with no managers. Pass `createMockMessage({ channel })` to send it in another.
  - A mock channel's type guards, such as `isTextBased()`, `isDMBased()`, `isThread()` and `isSendable()`, run discord.js's own logic. They returned `undefined`, so `if (!channel.isTextBased()) return` returned early. A voice channel carries its text chat, and a forum its tags, as discord.js tells them apart by.
  - A manager's `fetch(id)` resolves to its cached item with that id, such as a member given to `createMockGuild({ members })`, or to a new one with that id, which it caches. It returned an item with another id. A member fetched from a guild's `members` is in that guild.

  A test that relied on one of the old answers changes with it; nothing changes in a bot.

- [#291](https://github.com/meocord/meocord/pull/291) [`836e026`](https://github.com/meocord/meocord/commit/836e02680218d9374f6aa75feed3cf85d761f522) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `meocord/testing` adds `createMockMember({ user, guild, roles, nickname })`, and its mock users and members answer as discord.js does.

  - `createMockMember()` makes a member with the roles given. `roles.cache` holds the server's `@everyone` role, then those roles; `roles.add()`, `remove()` and `set()` change them and resolve to the member; `roles.highest` is the role that ranks highest, by position, then the lower id. `permissions` are its roles' permissions combined, `@everyone`'s included, or every permission for the server's owner. Pass the member to `createMockGuild({ members })`, and an interaction or a message from its user in that server has it as its `member`. See [Mocks](https://meocord.dev/docs/4.1/mocks).
  - Every mock member has a `roles` manager and `permissions`, with only `@everyone` unless given roles (for an interaction with a `guildId` but no `guild`, an `@everyone` with that id), instead of stubs that threw on `roles.cache.has()` or `permissions.has()`. A mock role has an id, `position` 1, above `@everyone`, and no permissions unless given.
  - A mock guild has an `@everyone` role, `roles.everyone`, in `roles.cache`: the role given to `createMockGuild({ roles })` with the guild's id, or one at position 0 with no permissions. A guild's `roles.cache` therefore holds one more role than the roles given, unless one of them has the guild's id.
  - An interaction in a server has the member's permissions as `memberPermissions`, and `null` in a DM, instead of a stub whose `has()` threw.
  - Every mock user is a person, `bot: false`, however it is made. `createMockInteraction(User)` gave a truthy `bot`, so a message from that user reached no handler.
  - A DM sent to a member goes through its user's `send()`, and a user's through its one DM channel, so `user.send`, `member.send` and `(await user.createDM()).send` each see it. `createDM()` resolves to that channel; it returned `undefined`.
  - In `createChatInputOptions`, a user option's `getMember()` is the user's member in the interaction's server, and `null` in a DM, instead of the user; a member given resolves `getUser()` to its user. A whole number is an Integer option and a fraction a Number one: `getInteger()` returned `1.5` for a fraction, which only a Number option holds, and now returns `null`.

  A test that relied on one of the old answers changes with it; nothing changes in a bot.

- [#324](https://github.com/meocord/meocord/pull/324) [`3b41afd`](https://github.com/meocord/meocord/commit/3b41afda3c9f57ed19f4147334372907b836f4fc) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `meocord/interface` names the options of the stage decorators, `GuardOptions`, `InterceptorOptions`, `ObserverOptions` and `ValidateOptions`, so a decorator of your own that wraps one can type what it passes on, instead of `Parameters<typeof Guard>[0]`. It also exports `PrimaryEntryPointCommandData`, the body an entry point command's builder returns, which could otherwise be written only as `CommandBuildResult<CommandType.PRIMARY_ENTRY_POINT>`.

- [#354](https://github.com/meocord/meocord/pull/354) [`1eb4fa0`](https://github.com/meocord/meocord/commit/1eb4fa0ca7643e85c3e68c71648b1807869b6d96) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A presenter can draw its views, such as with a canvas library, and attach what it draws:

  - **`ResponseView.files`** carries files, an `AttachmentBuilder` or `{ name, data }`, which MeoCord sends with the view and shows for you. In an embed, the first image is the embed's image. In a Components V2 container, images go in galleries of up to 10 below the text, and other files as file components. A file the view's own `components` show by `attachment://<name>` is not shown again.
  - **`ResponseView.image` and `thumbnail`** name one of the files, or a URL, to use as the embed's image or thumbnail, or the container's leading image and the text's thumbnail.
  - **`loading()` and `error()` may return a promise.** A slow drawing never misses Discord's three seconds. The loading view is drawn after `@Defer` acknowledges the click. An interaction not yet acknowledged is acknowledged privately before a drawn error view, which then replaces the acknowledgement; should that drawing fail, MeoCord's own view answers instead. Discord refusing the acknowledgement, as for an interaction past its three seconds, is logged once as the refused send, never as the presenter failing, and an interaction Discord no longer knows is not answered again.
  - **A view past Discord's limits is sent without its files**, with a warning: more than 10 attachments on the message, counting those it keeps, or a file over the interaction's attachment size limit, 20 MiB without one. A send Discord refuses as too large, as one with a file whose size could not be checked first, is sent again without its files. The user still gets the answer.
  - **A presenter's optional `messageError()` draws a message command's error replies**: the usage reply, a guard's or validation's reason, a `UserError`'s message, and the DMs `dmOnError` and `dmOnCooldown` send, as embeds with its files. It receives a `MessageResponseContext`, with the `message` in place of an interaction. A presenter without it, such as the one a new app is generated with, leaves those replies plain text, exactly as before. Should `messageError()` throw, reject or return a view an embed cannot hold, the reply or DM is sent as that plain text, and the failure is logged as the call's fault, so a testing module's `dispatch` rejects with it.

  Edits that add a view's files keep the message's own attachments, and a drawn loading view's files leave when the lock does.

- [#377](https://github.com/meocord/meocord/pull/377) [`f543e78`](https://github.com/meocord/meocord/commit/f543e78009df4d18bd3a07a668355b1cb1e8f5c1) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `ShardContext.call` types each result as it arrives: through JSON, as every mode passes it. `meocord/core` exports `Jsonified<T>`, the type a value has after that trip: a `Date` is a `string`, a `Map` or a `Set` is `{}`, a class with `toJSON()` is what it returns, and a function or `undefined` property is left out. A method returning `Promise<Date>` now gives `ShardCallResult<string>[]`, where it said `Date` and gave a string. Code that read the value as the method's own type changes to the JSON form.

  The arguments take the same trip, so `call()` refuses a method whose params JSON would change, such as one taking a `Date`: the compile error says the argument arrives as JSON and names the type to declare (`string` for a `Date`). An `undefined` argument now arrives as `undefined`, where it arrived as `null`. `ShardContext` is new in 4.1, so only beta users see these changes.

- [#350](https://github.com/meocord/meocord/pull/350) [`1f39632`](https://github.com/meocord/meocord/commit/1f39632c0aed5fcfcae9c753da417954699cbb49) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `MeoCordTestingModule.create()` and `fromApp()` take `shutdownTimeout`, which mirrors the option of that name in `meocord.config.ts`: from 0 to 2147478647 ms, refused otherwise, with the message `meocord.config.ts` gets for it. `close()` runs the bot's own shutdown sequence, so before the cooldown store shuts down, the calls `invoke`, `dispatch` and `emit` have under way finish. It waits up to `shutdownTimeout`, 10 seconds unless set, for the calls, the store's operations and the `onShutdown` hooks. Then it stops waiting and logs that it did, as the bot does, and still rejects with any hook that failed before then. A test whose fake store never answers, or whose `onShutdown` never settles, sets it short:

  ```ts
  const module = MeoCordTestingModule.create({
    app: App,
    providers: [{ provide: CooldownStore, useValue: silent }],
    shutdownTimeout: 50,
  }).compile()
  ```

- [#325](https://github.com/meocord/meocord/pull/325) [`c5ca2b9`](https://github.com/meocord/meocord/commit/c5ca2b9bd79ff2734e7d5bd3548e1fac5a9cb35f) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `createTranslator` and `defineCatalog` read as `createTranslator(options: TranslatorOptions<Locales, Default>)` and `defineCatalog(catalog: CatalogDefinition<T>)` in your editor and on the API pages, instead of spelling out the compiler checks they make. `TranslatorOptions` and `CatalogDefinition` are exported from `meocord/common`, each documented with what it refuses. The checks are unchanged. Nothing to change in your code.

### Patch Changes

- [#297](https://github.com/meocord/meocord/pull/297) [`94b573c`](https://github.com/meocord/meocord/commit/94b573c0e90130de8943c88e151f826ddc061280) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A bot without `activities` keeps the presence it sets. 4.0 rotated through `activities` every 10 seconds whether or not any were set, and with none it cleared the bot's activity each time, so a status set in `onReady`, in `clientOptions.presence` or by a command disappeared 10 seconds after ready, and an empty presence update was sent every 10 seconds. Now MeoCord touches the presence only when `activities` lists some, and shows one as soon as the bot is ready rather than 10 seconds later. With `activities` set, they cycle in order, as documented: the first once the bot is ready, then the next every 10 seconds, starting again after the last. 4.0 picked one at random each time. A timer that set the status again to work around it can go. See [the upgrade guide](https://meocord.dev/docs/4.1/migrating#smaller-changes).

- [#329](https://github.com/meocord/meocord/pull/329) [`94c8b2c`](https://github.com/meocord/meocord/commit/94c8b2c7ab12ef6fec9480da00b5d9b084d754a2) Thanks [@l7aromeo](https://github.com/l7aromeo)! - An asset import resolves beside the bundle, wherever `dist` is run from. `import logo from './logo.png'` gave the absolute path of the folder the build ran in. So a `dist` built in CI, on a laptop and then copied to a server, or in an image stage with another `WORKDIR`, read its assets from a path that wasn't there, and failed with ENOENT at the first attachment. The path is now set when the bot starts, from the bundle's own location. It's still an absolute path on disk, now the right one. Rebuild to pick this up.

- [#314](https://github.com/meocord/meocord/pull/314) [`4c0a815`](https://github.com/meocord/meocord/commit/4c0a81534204c5e52e6894392f08793b658b79a0) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `bundleDependencies` packs every package a bot needs into `dist/node_modules`, each with the dependency versions it was installed with, from a pnpm project as from npm, yarn and bun.

  - A package listed in `externals` or `optionalExternals` was packed without the packages it depends on, in a pnpm project. pnpm keeps those beside the package in its store, not in your project's `node_modules`, so they were left out, and the bot failed at startup with "Cannot find module". They're packed now.
  - A native package that ships its binary as a per-platform package, as napi-rs packages do, is recognised as native in a pnpm project and packed with that binary, whether you list it in `externals` or the bot imports it. Before, a listed one was packed without its binary, and an imported one stopped the build, asking for it in `externals`.
  - Each packed package loads the version of each dependency it was installed with. When packages need different versions of one package, the first stays at the top of `dist/node_modules`, and each other version is nested where Node, resolving from the package that needs it, finds it first. Before, every package got the first.
  - A package npm nested under another, because another version of it holds the top of `node_modules`, is packed with the packages it needs from the top. Before, they were left out, and the bot failed at startup with "Cannot find module".

  Rebuild to pick these up.

- [#316](https://github.com/meocord/meocord/pull/316) [`d2284d9`](https://github.com/meocord/meocord/commit/d2284d95fc1927ad3ab1237e6c9987d12e94b36f) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `respond()` could see a locked message's content as changed when it wasn't. It compares the message with what MeoCord last wrote by sorting keys with the runtime's collation, which ranks two different keys equal when they differ only in Unicode normalization, such as `café` written with `é` and with `e` and a combining accent. Their order then followed the input, so equal content could compare unequal. Keys are now sorted in code-unit order, which needs no locale. This also no longer loads the runtime's ICU data on the first lock or restore. Nothing to change in your code.

- [#395](https://github.com/meocord/meocord/pull/395) [`d5d07cb`](https://github.com/meocord/meocord/commit/d5d07cb96dac7757503a3b1aa68f6886c9db80c5) Thanks [@l7aromeo](https://github.com/l7aromeo)! - CLI and build fixes:

  - **Every imported file lands in `dist/assets` under its own name.** A pdf, txt, webmanifest or wasm import was written to `dist/static/assets` with a content hash, unlike images, fonts and media. Its import gives that path as before, so nothing in your code changes; rebuild to pick it up. Two imported files of one name in different folders stop the build with Rspack's conflict error, naming the file.
  - **`meocord start --dev` runs the bot on the development .env files whatever `NODE_ENV` your shell holds**, as its development build's config reads them: it watches them, and starts the bot with `NODE_ENV=development`. With `NODE_ENV=production` in the shell, it watched the production files, and a bot on Bun read the production values.
  - **A production bot on Bun warns about another mode's .env values for any `NODE_ENV` but `production`.** Bun reads the development files for every `NODE_ENV` except `production` and `test`, so a bot started with `NODE_ENV=staging` ran on development values without the warning an unset `NODE_ENV` gets.
  - **`meocord create` warns on Node 22.0 to 22.12**, below the `>=22.13` the package requires. It compared the major version alone.
  - **The CLI finds an installed package in the filesystem root's `node_modules`**, as with a project directly under `/` in a container.

- [#319](https://github.com/meocord/meocord/pull/319) [`218b6c5`](https://github.com/meocord/meocord/commit/218b6c5739d8dce0c34f4e013f528ac10ae1958f) Thanks [@l7aromeo](https://github.com/l7aromeo)! - The CLI clears the screen only where it helps: as `meocord start --dev` begins, in a terminal. `meocord build` and `meocord start --prod` no longer clear it, so the output of the commands before them, such as a failing test run, stays on screen. No command writes escape codes into piped output any more, such as CI logs, `docker logs`, pm2 or systemd. When `start --dev` clears, it keeps your scrollback.

  A build's output no longer lists the temporary folder the config is compiled in. The line after it still says where the config went.

- [#391](https://github.com/meocord/meocord/pull/391) [`f8dcc1a`](https://github.com/meocord/meocord/commit/f8dcc1ab3211f4379c1c1bdd20f6bb48d5f01b00) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Corrections to comments that ship with the package and in a new app; no behaviour changes.

  - The `meocord/eslint` example ignores generated code, in place of `coverage`, which the config already ignores.
  - In a new app, the comments in `vitest.config.ts` give the reasons that apply to the versions it installs, `src/types/theme.d.ts` explains the theme augmentation in three lines, and the sample message controller's TODO reads correctly. The sample slash, modal and guard spec titles say only what their tests check.
  - `meocord generate`: the guard template lists `'autocomplete'` among the handler kinds it can limit itself to, the interceptor template says interceptors skip autocomplete, and the filter template says `response` is undefined for autocomplete too.

- [#364](https://github.com/meocord/meocord/pull/364) [`23514e7`](https://github.com/meocord/meocord/commit/23514e74966fd470d9749d804f8a4d6c997e1072) Thanks [@l7aromeo](https://github.com/l7aromeo)! - The CLI reads the config the bot it runs reads. `meocord start --dev` uses the `shutdownTimeout` and `sourceMappedStacks` of the config it last compiled, so an edit to `meocord.config.ts` applies from the next restart. Before, it kept the ones from whatever `dist` held when the session began, and waited a shorter `shutdownTimeout` than the bot's own, killing it before its `onShutdown` hooks finished. The token check follows the same rule. `start` and `register` check the source config when they build first. Otherwise they check the compiled config the bundle runs, so `meocord register` without `--build` now stops at a compiled config that fails to load, as `start --prod` does.

- [#394](https://github.com/meocord/meocord/pull/394) [`bfb3e07`](https://github.com/meocord/meocord/commit/bfb3e071747456a56acf040044716ad3869c2e37) Thanks [@l7aromeo](https://github.com/l7aromeo)! - The editor documentation of `meocord/common` and `meocord/interface` matches what the code does:

  - **`respond()`'s state.** `message` is the last reply, update or edit, never a follow-up. `lock()` with `disable: 'none'` leaves the message alone. `error()` puts a locked message back as it was before it follows up.
  - **Errors.** `GuardDeniedError`, `ValidationError`, `CooldownError` and `CooldownStoreError` say how a message command is answered. A message command gets a reply in the channel for a denial or invalid input. For a cooldown or a store outage it gets nothing, or a direct message under `messages.dmOnCooldown` or `messages.dmOnError`. `CooldownStoreError` also says that the recovery is logged once the store has answered for 30 seconds without failing. The constructors and helpers have their `@param` and `@returns`.
  - **`ExecutionContext`.** `getController()` is the class the handler runs on, the subclass for an inherited one. `getParams()` covers pipes too.
  - **Cooldown stores.** `MemoryCooldownStore`, `RedisCooldownStore.using` and the Redis constructor document all their parameters, `hashTag` included. On Redis Cluster, a refused call counts against no key unless giving a use back fails.
  - **`route().build()`** also throws a `TypeError` for a value that is not of its param's type.
  - **Localisation.**
    - `createTranslator` documents `options` and what it returns.
    - `defineCatalog` says which catalogs need it.
    - `LocaleCatalog` says where a locale's `{params}` are checked.
    - A plural needs its `other` form to be read as one.
  - **`createToken`** names what its type checks: `TestingModule.get` and a provider's `useValue` or `useFactory`.
  - **`Logger`.** A string prints in its tag's colour. Each method documents `args`.
  - **App options.**
    - `caseSensitive` covers choice words and flag names.
    - `deleteUsageRepliesAfter` covers a guard's or validation's reason.
    - `replyEmoji` notes that help begins with the info emoji.
    - `help` and `MessageHelp` say that `!help` leaves out hidden and guarded commands.
    - `scope: 'dm'` with a server-only param is refused.
  - **`OnShutdown`** runs on `app.stop()` too.
  - **Examples.** The examples for a param type's and a theme's `declare module` import what they use.

- [#302](https://github.com/meocord/meocord/pull/302) [`e5724e8`](https://github.com/meocord/meocord/commit/e5724e84f6a60135c7ca56cf84cdea64b75e3a0a) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A component handler's params are checked against what a call gets, when the code compiles:

  - **A select menu's choices** have their real types: `values: string[]`, `users: User[]`, `members`, `roles` and `channels` as discord.js resolves them. A declaration no choice can have, such as `values: number` or `users: string`, fails to compile, where it used to compile and then fail on the first selection. A narrower type that a choice can hold, such as `members: GuildMember[]` or `readonly Role[]`, still compiles.
  - **A plain-string customId pattern's keys** are checked as a `route()`'s are. With `@Command('stats/{id}', CommandType.BUTTON)`, a handler declaring `{ uid }` fails to compile, naming `uid`, since that param was always `undefined`. Fix the name to one the pattern captures.
  - **A key a pipe produces** is declared `Piped<T>`, as with `@Validate`, and the check leaves it to the pipe. That covers a choice `@UsePipe` turns into something else, a typed customId param such as `{id:int}` piped into an object, and a `@MessageHandler` pattern's param piped the same way, which no declaration could satisfy before. The check reads only the handler's own type, so it cannot see the pipe. A 4.1 beta handler that writes `@UsePipe('values', ToQuantities)` with `{ values: number[] }` now fails to compile, with a message ending "a key a pipe produces is marked Piped<T>"; write `{ values: Piped<number[]> }` instead.

- [#317](https://github.com/meocord/meocord/pull/317) [`eb6698e`](https://github.com/meocord/meocord/commit/eb6698e81a35887b8e662f78fd276e940dfbde7d) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A built bot finds its config beside its bundle, wherever it's started from. Before, it looked in `dist` under the working directory, so a bot started from elsewhere failed with "MeoCord config not found … Run `meocord build`", even with a fresh build. That covered pm2 without `cwd`, a systemd unit without `WorkingDirectory`, and `cd dist && node main.js`.

  When the config really is missing, the message names the file it looked for and the working directory. When the file is there but fails to load, the message says so, gives the reason and says what to do: install the package it names when one is missing, naming the installed package that imports it if the config does not import it itself, or fix `meocord.config.ts`, then run `meocord build`.

  `.env` is still read from the working directory, through `dotenv` in your `meocord.config.ts`. If you start the bot from elsewhere, set its environment there or point `dotenv` at the file.

  The check that refuses a build made for another platform also reads its record beside the bundle. It now applies when a process manager's wrapper starts the bot.

  A development build (`meocord build --dev`) does the same, also when a process manager such as pm2 starts it through its own wrapper: its config, its asset imports and the script its shards start from are all found beside its bundle.

  Rebuild to pick these up.

- [#363](https://github.com/meocord/meocord/pull/363) [`b38234c`](https://github.com/meocord/meocord/commit/b38234c71ab07e39834161fbc95f6fe5a281c116) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A compiled config that fails to load is reported once, with its reason and what to do: "MeoCord config at … failed to load: <reason>. Fix meocord.config.ts, then run `meocord build`.", or, when the config needs a package that isn't installed, one that says to install it. A built bot printed a separate "[MeoCord] Failed to load …" line before that one, and `meocord start --prod` printed it a third time. `meocord start --prod` without `--build` now stops with that message, rather than check `meocord.config.ts` in its place, which could stop on a missing token without naming the broken config the bot would run.

- [#313](https://github.com/meocord/meocord/pull/313) [`0060a3c`](https://github.com/meocord/meocord/commit/0060a3ce0a1481df831673a76221c74b4ded02c8) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Three mistakes with `@Command` and `@MessageHandler` are now named where they happen:

  - **A command builder whose constructor throws**, such as one reading a translator or the environment in a field, is refused as the class loads, like a builder whose `build()` throws: `Stats.stats: StatsBuilder could not be made for "stats": missing translator.` It used to surface as the bare error at import, naming neither the builder nor the command.
  - **A `@Command` handler called with another kind of interaction**, as a direct call in a test can be, throws `Cards.card: @Command('card/{id}', CommandType.BUTTON) takes a ButtonInteraction, not a ChatInputCommandInteraction.`, or `…; it was given undefined.` for something that is no interaction at all, instead of `Invalid interaction type passed to @Command for method: card`.
  - **`@MessageHandler('')`** still runs for every message, as `@MessageHandler()` does, and now logs a warning naming the handler: `@MessageHandler('') on Chat.every is deprecated; in the next major version (5.0) it is refused. Use @MessageHandler() instead.` See [the upgrade guide](https://meocord.dev/docs/4.1/migrating#messagehandler-logs-a-warning).

  A builder error that ends in a full stop no longer gets a second one in its refusal.

- [#344](https://github.com/meocord/meocord/pull/344) [`7b68f81`](https://github.com/meocord/meocord/commit/7b68f81271790b5da208e7baeb502caf9e5608e8) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `@Cooldown`'s `seconds` is now counted in whole milliseconds, and a window no store can count is refused where the decorator applies.

  - A `seconds` value whose milliseconds weren't a whole number, such as `16.1`, made `RedisCooldownStore` fail every call to that handler with "ERR value is not an integer or out of range", while the memory store used in development and tests counted it fine. `seconds` is now rounded to the millisecond, once, so every store gets a whole `windowMs` of at least 1.
  - `seconds` must be from `0.001` to `4320000000000`. `Infinity` and other values beyond that were accepted, and each store did something different with them: the memory store refused with "try again in Infinitym NaNs", Redis failed every call, and process sharding never limited anything.
  - `@MeoCord({ cooldownStoreTimeoutMs })` must be at most `2147483647`, the longest delay a timer keeps. A longer one fired at once, so every call with a cooldown timed out.
  - `testCooldownStore` checks a store that keeps the default `consumeMany` or `peekMany` against what those defaults do, where its batch and peek cases passed without checking anything. A store whose `consume` lets two concurrent calls take the last use now fails the concurrent batch case as well.
  - The `cooldownStoreTimeoutMs` refusal shows `Infinity` and `NaN` as they are, rather than as `null`.

- [#348](https://github.com/meocord/meocord/pull/348) [`63f9514`](https://github.com/meocord/meocord/commit/63f9514fe2d5351cf0acb74879a30ded6db55f81) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A cooldown's count is kept under a key named for its window, not its position among the handler's cooldowns. A release that added, removed or reordered a `@Cooldown` moved the counts a persistent store such as Redis kept to other cooldowns: adding a short cooldown above a daily one reset the daily for everyone, and a short one could inherit a long one's history. Now a deploy that adds, removes or reorders cooldowns leaves the others' counts where they are. Changing a cooldown's `uses` keeps the calls counted so far, held to the new number; changing its `seconds` starts its count again. A handler's cooldowns with the same `seconds`, `per`, `by` and `bypass` count the same calls, so they share one count, held to the smallest `uses`. The exception is two cooldowns over the same `seconds` and `per`, both with `by` or both without, whose `by` or `bypass` functions differ (two inline functions differ even when written alike): `uses` tells them apart, so for those, changing `uses`, or adding or removing another such cooldown, starts their counts again, and reordering two with the same `uses` swaps their counts. A call that `by` returns `undefined` for is counted apart from a cooldown with no `by` over the same window. For a bot upgrading from an earlier 4.1 beta, counts kept under the old keys are not carried over, so every cooldown's count starts afresh once.

- [#345](https://github.com/meocord/meocord/pull/345) [`a3358e4`](https://github.com/meocord/meocord/commit/a3358e4ebce33ba67e2c0b021bffa2f32e193700) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `messages.dmOnCooldown` now DMs an author once per wait, as documented, however often they retry within it. The notice was counted over the wait left at each refusal, which shrinks with every retry, so it expired halfway through: an author retrying every second during a 60-second wait got six DMs (at 1, 31, 46, 53, 57 and 59 seconds), and about twelve in an hour-long one. Each wait now has a notice of its own, kept for the cooldown's full window. A wait is told apart by when it ends on the store's own clock, so a retry whose answer comes back late, or from another shard sharing the store, finds the notice already taken.

- [#346](https://github.com/meocord/meocord/pull/346) [`3f9d6f7`](https://github.com/meocord/meocord/commit/3f9d6f769046e7da6d7b15a647b010aa88337f90) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A cooldown store that fails some calls and answers others, as a Redis Cluster with one node down does, is now logged as one outage. Any answer ended the outage and the next failure began a new one, so each failing call logged an error with its stack and then a recovery line. An outage now ends when the store answers 30 seconds or more after its last failure, and the recovery line counts every call that failed in it.

- [#350](https://github.com/meocord/meocord/pull/350) [`b36cba3`](https://github.com/meocord/meocord/commit/b36cba326bd13686dee18d60c715d71bcc382df9) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A class you bind with `@MeoCord({ cooldownStore })` now gets its `onReady` and `onShutdown` hooks, as a service does. Before, neither ran, so a store that opens a connection in `onReady` and closes it in `onShutdown` never connected and leaked its connection on every shutdown.

  The order suits a store that connects:

  - Its `onReady` runs before the services'. A call that comes while it runs waits for it, within `cooldownStoreTimeoutMs`. One that would wait longer meets your `cooldownStoreFailure` policy, as a store that doesn't answer does.
  - Its `onShutdown` runs after the services'. The bot first stops taking new calls and lets the ones under way finish, along with every store operation they started, even an answer that came after its call stopped waiting. So the store closes after the last write it is asked for.
  - What the store injects, such as the queries it runs, is ready before it and shuts down after it, so it is there for the store's last write.
  - A store with no `onShutdown`, and nothing it injects with one, doesn't hold shutdown up: the bot waits for the calls under way only when a hook needs the store.

  `MeoCordTestingModule` runs the store's hooks in the same order, in `init({ ready: true })` and `close()`, for the app's store or the `CooldownStore` a test provides in its place.

- [#393](https://github.com/meocord/meocord/pull/393) [`1403136`](https://github.com/meocord/meocord/commit/140313695131f7893a3f5d55b3a393a8eda1c5c3) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Corrected the editor documentation of several public APIs to match what they do:

  - `HandlerRegistry`: `list()` gives the handlers in the order the app makes its classes, not the order they were bound. `messageHelp()` lists by where the message was sent, not by its author, and an entry's `hidden` leaves a command out of help's lists while `!help <command>` still shows it.
  - `useTheme()`: outside a call it reads the app's theme from when its start begins until it has shut down. The chain of `@UseTheme` stops where `inheritStages: false` does, and only the theme's plain objects and arrays are frozen.
  - `MeoCordFactory.create`: with process sharding, the manager logs an error a shard throws.
  - `ShardContext`: `runHere` takes a service's class in a bot of one process, and its name with process sharding.

- [#311](https://github.com/meocord/meocord/pull/311) [`bcda23d`](https://github.com/meocord/meocord/commit/bcda23d5174209539128d400c42b4001a9cdbf12) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `meocord create` writes any app name into `meocord.config.ts` as a valid string. A name with an apostrophe, such as `"Bob's Bot"`, or one ending in a backslash made a config that failed to parse, so the new app never built. A backslash elsewhere changed the name silently: `Back\slash` was read as `Backslash`. The name is now quoted and escaped the way the app's own Prettier config writes it, so the file also passes the app's lint unchanged. An app created with such a name before this needs its `appName` fixed by hand.

- [#306](https://github.com/meocord/meocord/pull/306) [`d04a276`](https://github.com/meocord/meocord/commit/d04a27626b6c13bd8a2a8a89ce365e79ab3f7e66) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `meocord create` keeps the app when git can't make its first commit. Before, a git failure deleted the app it had just written and exited with an error. That happened on a machine where git has no `user.email` (many fresh Linux machines, containers and CI runners) and on one without git. Now `create` finishes, says what happened, and tells you how to finish the commit. Inside an existing Git repository it makes no new one and leaves the files to that repository.

  The first commit now comes after the install, so your lockfile (`bun.lock`, `package-lock.json`, `yarn.lock` or `pnpm-lock.yaml`) is part of it, rather than showing as an untracked file in a new app's first `git status`.

- [#389](https://github.com/meocord/meocord/pull/389) [`6ac2e26`](https://github.com/meocord/meocord/commit/6ac2e26c38f08da270c91aa57b99d9862d9debdb) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `meocord create --use-npm` makes an app that npm 11.16 and later install without the `allow-scripts` warning. Those versions list every dependency install script your `package.json` neither allows nor denies, and a new app listed `@swc/core`, `unrs-resolver` and, on macOS, `fsevents`. An app created for npm now denies all three under `allowScripts`:

  - `@swc/core` and `unrs-resolver` load the native binding npm installs for your platform. Their scripts check that binding and, only where it fails to load, fetch a fallback: `@swc/core`'s installs `@swc/wasm`, which `@swc/core` itself does not load, and `unrs-resolver`'s downloads the binding npm installs anyway.
  - `fsevents` ships its binary prebuilt. Its script rebuilds it from source, which fails because the package has no build files, so npm left the optional `fsevents` out. Denied, it is installed with its prebuilt binary.

  npm before 11.16 ignores the field. An app created with pnpm, yarn or bun gets no `allowScripts`.

  An app created for npm before this gets the same by adding to its `package.json`:

  ```json
  "allowScripts": {
    "@swc/core": false,
    "fsevents": false,
    "unrs-resolver": false
  }
  ```

- [#375](https://github.com/meocord/meocord/pull/375) [`8c212ae`](https://github.com/meocord/meocord/commit/8c212ae5de1d9b0646f1e80479ec110cc2b7c9a8) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `meocord create --use-pnpm` makes an app that installs and passes its own checks on pnpm, 10 and later.

  - pnpm 11 and later refuse to install while a dependency's build script is neither allowed nor denied, so `create` stopped at "Failed to install dependencies" with `ERR_PNPM_IGNORED_BUILDS` for `@swc/core` and `unrs-resolver`. An app created for pnpm now has a `pnpm-workspace.yaml` that leaves both scripts off under `allowBuilds`: each only checks the native binding pnpm installs for your platform, and fetches a fallback without it. The same file lets pnpm install the `meocord` that created the app, which pnpm 11 and later would otherwise hold back for a day after its release (`minimumReleaseAgeExclude`). An app created with npm, yarn or bun gets no such file.
  - The app declares `reflect-metadata` and `@types/node`, which its test setup imports and its tsconfig names. npm and bun hoist them from other packages, but pnpm links only what `package.json` declares, so on pnpm 10 the app's `lint` and `test` failed.

  An app created for pnpm before this gets the same fix by adding both packages to its `devDependencies`, and on pnpm 11 or later this `pnpm-workspace.yaml`:

  ```yaml
  allowBuilds:
    '@swc/core': false
    unrs-resolver: false
  minimumReleaseAgeExclude:
    - meocord
  ```

- [#397](https://github.com/meocord/meocord/pull/397) [`e1168b9`](https://github.com/meocord/meocord/commit/e1168b987609f173d25389652e47176c4207437a) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `@Defer()` written below `@MessageHandler`, `@ReactionHandler`, `@On` or `@Autocomplete` is refused in one line at `create()`, as it is when written above one, rather than printed with a stack trace.

- [#343](https://github.com/meocord/meocord/pull/343) [`87dbef1`](https://github.com/meocord/meocord/commit/87dbef18f0ca4d13bdda9d9b68389d21c1ce6df8) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `meocord start --dev` restarts the bot through the bot's own stop, the one SIGINT and SIGTERM run, on every platform. On Windows, a restart used to end the bot outright, so its `onShutdown` hooks never ran on a save, and whatever they release or flush was left as it was. The dev runner now asks the bot to stop over the channel it already gives it, and the bot shuts down as it does on Ctrl+C, before the new build starts. A bot that doesn't exit within its `shutdownTimeout` and a short grace period is still killed, as before. Rebuild to pick this up.

  When watch mode can't start, it stops a bot it had already started the same way, and exits once that bot has. Before, a bot that held on to its stop signal could outlive the CLI.

  One save no longer restarts the bot twice. An editor's save can produce two builds of the same output, and a bot already running the latest output is now left alone. A change to `meocord.config.ts`, `tsconfig.json` or `.env` still always restarts it.

- [#337](https://github.com/meocord/meocord/pull/337) [`8504f45`](https://github.com/meocord/meocord/commit/8504f45d18ac85a52f82044b307e68e5893fa926) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `meocord start --dev` keeps watching when the bot cannot log in, such as with a wrong token or an intent Discord refuses. It says so, and starts the bot again on the next change, whether to your code or to `.env`.

  `start --dev` also watches `.env`, `.env.local`, `.env.development` and `.env.development.local`: saving one restarts the bot with the values the files now hold, without a rebuild. The bot reads the files itself as it starts, and inherits only what your shell set.

  When watch mode cannot start, for example because an `rsbuild` hook in `meocord.config.ts` throws, `start --dev` exits with code 1, as `meocord build` does, so a script or process manager around it sees the failure.

  A rebuild that can't start partway through a session, such as when you save a `meocord.config.ts` whose `rsbuild` hook or plugin throws, no longer ends `start --dev` with the bot still running in the background. It says the rebuild failed and why, keeps the bot and its last build running, and tries again when you save the file again.

- [#350](https://github.com/meocord/meocord/pull/350) [`b36cba3`](https://github.com/meocord/meocord/commit/b36cba326bd13686dee18d60c715d71bcc382df9) Thanks [@l7aromeo](https://github.com/l7aromeo)! - The startup check now names a `@MessageHandler` with `scope: 'dm'` that can never receive a DM. A DM reaches the bot only with the `DirectMessages` intent, and only with discord.js's `Partials.Channel`, since no DM channel is cached after the bot starts. The generated app's client options have neither, so a DM-only command added to it never ran, and nothing said why. The warning names the handler and what is missing. A command for servers, or for both, gets no new warning.

- [#372](https://github.com/meocord/meocord/pull/372) [`270d315`](https://github.com/meocord/meocord/commit/270d315b41e3f59bb6591aa7f4c98f0a6df6e8b9) Thanks [@l7aromeo](https://github.com/l7aromeo)! - The direct message `messages.dmOnError` sends for a command in a server now says what went wrong. `meocord.dm.error` reads `{command} in {channel} on {server}: {reason}`, where `{reason}` is what the fallback answers the error with: "An error occurred while executing the command." for a fault, and "Cooldowns can't be checked right now: try again shortly." when the cooldown store is down. It said "Something went wrong running {command} in {channel} on {server}. Try again later." for both, so a store outage read as a broken command. The text has the same shape as `meocord.dm.cooldown` beside it. A catalog that translates `meocord.dm.error` adds `{reason}` to it.

- [#355](https://github.com/meocord/meocord/pull/355) [`d642b0c`](https://github.com/meocord/meocord/commit/d642b0c17a924f65e9b25e00c38eb29807f7b2e8) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A reaction in a DM the bot has not cached since it started reaches its handlers again. From discord.js 14.26.2, discord.js makes a channel it has not cached from a gateway event only when the event says the channel is a DM, and a reaction's event names its channel by id alone, so such reactions were dropped before any listener saw them, even with `Partials.Channel`. With the `DirectMessageReactions` intent, MeoCord now fetches that DM channel once, on its first reaction, and hands the reaction back to discord.js, which delivers it to `@ReactionHandler` and to your own `messageReactionAdd` and `messageReactionRemove` listeners alike. Later reactions in that DM need no channel fetch, though the first reaction on a message the bot doesn't hold still fetches that message once, and a reaction discord.js delivers itself is left alone. One window remains: a DM reaction that arrives before the gateway is ready, in the seconds while discord.js waits for the bot's servers, is replayed by discord.js later without a raw event, so it is still dropped.

- [#332](https://github.com/meocord/meocord/pull/332) [`bb22d53`](https://github.com/meocord/meocord/commit/bb22d5307225ed7a804474cee0a8cfe57515dfd8) Thanks [@l7aromeo](https://github.com/l7aromeo)! - On Windows, `meocord generate` in a project installed with npm, yarn or pnpm reported "Failed to create" and exited 1 for every file, though the file was written. Its formatting step spawned `node_modules/.bin/eslint.cmd`, which Node refuses to start without a shell. The project's ESLint now runs through the same runtime as the CLI. A formatting failure never marks a written file as failed.

- [#357](https://github.com/meocord/meocord/pull/357) [`cfb94c8`](https://github.com/meocord/meocord/commit/cfb94c8eb25c1869a3cb06ef9c57fa67695bb5bf) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `meocord generate` formats the files it writes with your project's ESLint in one run, and says so. Before, it started a separate ESLint for each file, all at once. Each built your project's type information, and the command sat silent until the slowest finished: about 2.3 times the CPU for a controller with its spec and builder, enough to stall `generate` on a busy machine. Now it prints "Formatting with your project's ESLint..." after the files are created and waits for that one run. If ESLint can't run, or reports problems it can't fix, `generate` says so, and the files stay as written either way.

- [#332](https://github.com/meocord/meocord/pull/332) [`c95beab`](https://github.com/meocord/meocord/commit/c95beabd3c5bff005d7283618eac95fe766fc4b2) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `meocord generate controller` writes a spec that tests the handler. It invokes the handler with a mock of the interaction, message or reaction it handles, and checks what it answers: how it answers, such as a reply or an update of the message, and the text, such as "Hello from /ping!" or, for a mentionable select menu given a user and a role, "Selected 1 user(s) and 1 role(s)." Before, every spec only checked that the controller existed, and passed whatever the handler did. A generated slash, context menu or entry point builder now takes the command's name from `@Command` (`build(commandName)`), so the two can't drift apart. Files you've already generated are unchanged.

  The sample specs `meocord create` writes check the same way. The slash, context menu, button and modal samples check the text they answer. The message and reaction samples send a message or a reaction through `module.dispatch()`, as the bot routes it, and check the reply, where before they only checked that the controller existed.

- [#400](https://github.com/meocord/meocord/pull/400) [`dcc5087`](https://github.com/meocord/meocord/commit/dcc50871ced6e08b02ebbe41e769edc69cca9bcb) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `MeoCordFactory.create()` and the testing module's `compile()` now warn about each `@MessageHandler`, `@ReactionHandler`, `@Command` or `@Autocomplete` on a class that is not one of the app's `@MeoCord({ controllers })`, such as a service or a class one injects. MeoCord dispatches only to controllers, so these handlers never run, and nothing said so. Move them to a controller: the next major version (5.0) refuses to start with them, as the [upgrade guide](https://meocord.dev/docs/4.1/migrating#a-handler-on-a-class-that-isnt-a-controller-logs-a-warning) describes. A sharded bot warns once, from its manager. The warnings about missing intents and partials no longer name these handlers, since no intent would make them run. `@On` and `@Once` handlers run on any bound class, as before.

- [#300](https://github.com/meocord/meocord/pull/300) [`a4afcf9`](https://github.com/meocord/meocord/commit/a4afcf99a46b22095613f0d1906690d73e12420f) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A handler may return a value. `@Command`, `@MessageHandler`, `@ReactionHandler` and `@Autocomplete` accepted only a method returning nothing, so `return interaction.reply(…)` or `return message.reply(…)`, as discord.js code often ends a handler, failed to compile with "Unable to resolve signature of method decorator". As with `@On`, any return type compiles: MeoCord answers nothing with it, and an interceptor receives it from `next.handle()`. A parameter of the wrong type is still refused.

- [#397](https://github.com/meocord/meocord/pull/397) [`622010c`](https://github.com/meocord/meocord/commit/622010c64cabe82aaa97f232732070b1e8590f4f) Thanks [@l7aromeo](https://github.com/l7aromeo)! - The built-in help, and the list of subcommands a parent command with no handler of its own answers, now run the app's `@MeoCord({ guards })` first, as a command does. A guard that returns `false` leaves the message unanswered, and one that throws `GuardDeniedError` gets its reason as the reply, as a denied command does. They answered whatever the app's guards decide, so a bot its guards close in a channel, or to a user, still answered help there.

- [#334](https://github.com/meocord/meocord/pull/334) [`4de3194`](https://github.com/meocord/meocord/commit/4de319435fb7420968b181e29ad534cb6618318f) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A handler that a subclass re-declares follows one rule for `@Command`, `@MessageHandler`, `@ReactionHandler` and `@Autocomplete`.

  - **On the route it inherits**, the subclass's declaration takes that route's place, so the subclass's options apply: a re-declared `@Command('ping', LoudPingBuilder)`, `@MessageHandler('roll', { description })` or `@ReactionHandler('👍', { bots: true })` uses its own builder, description or settings. In 4.0 the base's applied, since the base's declaration came first. To keep the base's builder or options, don't re-declare that route on the subclass, or declare it with the base's builder. The routes the subclass answers are unchanged.
  - **On another route**, the subclass still answers the route it inherits too, as in 4.0. For example, a subclass overrides `page()`, which its base declares as `@Command('page/{n}', …)`, with `@Command('shop/page/{n}', …)`, and answers both. The bot now names each such handler in one warning as it starts, with the routes it inherits and its own. In the next major version (5.0), a handler's own routes replace the ones it inherits. To keep an inherited route, declare it on the subclass's method as well.

  A class between them that declares nothing changes neither. A subclass that declares every route itself, or none, gets no warning. See [the upgrade guide](https://meocord.dev/docs/4.1/migrating#a-re-declared-handler-that-keeps-its-inherited-route-logs-a-warning).

- [#341](https://github.com/meocord/meocord/pull/341) [`e09926b`](https://github.com/meocord/meocord/commit/e09926b1d0814410ab68c0de0c39eb3d885c3335) Thanks [@l7aromeo](https://github.com/l7aromeo)! - An interceptor that calls `next.handle()` without returning or awaiting it no longer crashes the bot when the handler throws. The handler's error was an unhandled rejection, which ends the process, and the filters, the fallback and the user never saw it, while observers reported the call as `'ran'` and `@Defer()` released the message before the handler finished. Now, when an interceptor returns and leaves what `next.handle()` returns, or a `then` or `finally` chain from it, without a rejection handler, as `next.handle().then(log)` does, the call ends when the handler does and fails with what it throws: its filters and the fallback answer it as they would any handler error. An interceptor that awaits, returns or catches the promise, or races it against a timeout, behaves as before. A promise handed to something else, such as `Promise.all`, is still that one's to handle.

  A handler that an interceptor took on, such as by racing it against a timeout, and that throws after the interceptor has returned is now logged as a warning naming the interceptor, the handler and the error, unless a handler of the interceptor's own, in a chain from `next.handle()`, disposes of it; one that rethrows it, or wraps it in an error of the app's, still leaves it to the warning. The call has ended by then, so nothing else reports it.

- [#328](https://github.com/meocord/meocord/pull/328) [`dffb24d`](https://github.com/meocord/meocord/commit/dffb24d02fa70750895708e99cadbdb9f018df0a) Thanks [@l7aromeo](https://github.com/l7aromeo)! - The editor documentation of three APIs says more about what they do:

  - `TestingModule.invoke` says that a guard's `GuardDeniedError`, a `UserError` and a `CooldownError` reject it, where `dispatch` resolves `{ ran, error }`, and its example shows both.
  - `useTheme` names `themeFor`'s layers: the server's theme, then the user's, over the handler's `@UseTheme`.
  - `createMock` says that a property its type declares as data is a mock function, so truthy, and shows passing the values the code reads.

- [#282](https://github.com/meocord/meocord/pull/282) [`1f8fbf4`](https://github.com/meocord/meocord/commit/1f8fbf44df456135a46036d5680423e36a573c0a) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `Logger` prints as `console.log` does. It redacts the bot's credentials from everything it prints, as 4.0.1 does.

  - **Colour follows each line's stream.** Warnings and errors go to stderr and the other levels to stdout, but colour followed stdout alone, so `node dist/main.js 2>>errors.log` from a terminal wrote colour codes into the file. Each line now takes colour only where its own stream is a terminal, or `FORCE_COLOR` asks for it.
  - **An object is coloured only where the rest of its line is.** An object or other non-string argument was always printed with colour codes, even into a file or a log collector, where they appear as raw escape sequences. It now prints in colour on a terminal, and plain where the output is not one. Set `FORCE_COLOR=1` to keep colour where your log viewer shows it.
  - **Objects print as `console.log` prints them.** A small object such as `{ id, name }` takes one line, where 4.0 printed one property per line. Objects print four levels deep, and without their non-enumerable properties, as 4.0.1 does, where 4.0.0 and the earlier 4.1 betas printed every level and those properties: nested data a bot logs, such as a payload or its settings, still shows in full, and a discord.js structure prints a few hundred lines instead of everything it reaches. An error prints its stack, its own properties such as `code`, its `cause`, and an `AggregateError`'s errors, with its message and stack printed once, as in 4.0.1.
  - **A value of any type prints, and none makes `Logger` throw.** A `Symbol` threw `Cannot convert a Symbol value to a string`, so a handler or an observer that threw a `Symbol` made MeoCord's own log of it throw too, and from an observer that became an unhandled rejection. Anything other than a string now prints as `console.log` prints it: `Symbol(boom)`, `10n`, `[Function: handler]`. A number or a boolean takes `console.log`'s colour rather than the level's.
  - **`logger.info()` and `logger.verbose()` lines are tagged `[INFO]` and `[VERBOSE]`.** 4.0 tagged them `[LOG]`. They still print at the `log` level, so a filter or parser that matches `[LOG]` needs to match `[INFO]` and `[VERBOSE]` too to keep catching them. See [the upgrade guide](https://meocord.dev/docs/4.1/migrating#smaller-changes).

- [#322](https://github.com/meocord/meocord/pull/322) [`1ceb803`](https://github.com/meocord/meocord/commit/1ceb803e4f108254c1bec561ecb7d22651c4f091) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A `@MessageHandler(pattern)` handler whose params don't fit its pattern is now explained in three lines rather than twenty-four. The decorator had one form for each way a handler can be declared, so TypeScript explained the mismatch against every form, and the reason, such as a param the pattern lacks, came last. It now has one form, and the second line names the params that don't fit and what the pattern gives each: `"The handler's params do not fit the pattern": { side: { readonly 'not a param of the pattern': "side" } }`. What compiles is unchanged.

- [#304](https://github.com/meocord/meocord/pull/304) [`31f0f02`](https://github.com/meocord/meocord/commit/31f0f02cf68e4a67f4da33487bb06b5328701e0d) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Two message handlers that can take the same message stop the bot at startup, wherever their starts are known as it starts. One with its own `prefix: '!'` and one using the app's `'!'`, own prefixes that share one (`'!'` and `['!', '?']`), `prefix: false` beside an app with no prefix, or two a mention starts in a server were all taken as different starts, so the order of your `controllers` decided which ran. The refusal names both handlers and their patterns; give one another prefix or pattern. An app whose prefix is a function gives its prefixes only as each message arrives, so a handler using it is refused only beside another that uses it too. Beside one with its own prefix or `prefix: false`, which the function can also give, the handler with its own start runs, whatever the order of your `controllers`.

  A prefix function that finds no prefix for a message, returning an empty list, `undefined` or `null`, now lets no prefix start a command for it; a mention still does when `mention` is on. It took the message as it is, so in a server with no prefix of its own, plain chat starting with a command's word ran that command. Return `''` to take a message as it is. The function's type takes `undefined` and `null` too, so a lookup such as `return prefixes.get(id)` needs no cast.

- [#347](https://github.com/meocord/meocord/pull/347) [`928aa57`](https://github.com/meocord/meocord/commit/928aa578da374301a5388a40b770db2152422712) Thanks [@l7aromeo](https://github.com/l7aromeo)! - With `messages.dmOnError` on, a message command refused because the cooldown store is down now DMs its author, once per outage, the `meocord.dm.error` message, or `meocord.cooldown.storeDown` for a command sent in a DM. Such a command got no answer at all, so while the store was down every `!command` with a cooldown looked like a dead bot. Without `dmOnError` it is still skipped silently, as before.

- [#370](https://github.com/meocord/meocord/pull/370) [`0ff8eba`](https://github.com/meocord/meocord/commit/0ff8ebaba05a1453b90c15f5ac587cf2f8f29034) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `meocord/testing`'s mocks take where they were made, and what a user option carries, as discord.js reads them:

  - **A channel given to `createMockInteraction` or `createMockMessage`** sets the `channelId`, `guildId` and `guild` the test leaves out. A DM channel is no server, so `inGuild()` is `false`, and a server's channel puts the mock in its server. An interaction given a channel kept a `channelId` of its own, so a per-channel cooldown counted each one apart, and a message given a DM channel said it was in a server. A server's channel that names no server is put in the mock's, and a channel in another server than the one the test gives, or a DM's where it gives a server, is refused with both named. The channel is cached on the mock's client, as the gateway caches it.
  - **A mock channel's managers** have it as their `channel`, and a thread's `members` as their `thread`, as discord.js's do.
  - **A user option from `createChatInputOptions`** carries its `user`, and in a server its `member`, as the gateway sends them. A member given carried only `member`, as in 4.0, so a handler's param typed `User` got the `GuildMember`.
  - **A select menu given its `users`, `members`, `roles` or `channels`** has their ids as `values`, as Discord sends them. They stayed empty unless given as well.

- [#333](https://github.com/meocord/meocord/pull/333) [`60e0290`](https://github.com/meocord/meocord/commit/60e0290f69504f8547a00fea9dba46f8090603dd) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A mock select menu from `createMockInteraction` has picked nothing unless the test gives its choices, as discord.js builds one: `values` is an empty array, and `users` and `members`, `roles` or `channels` are empty `Collection`s, the ones its kind picks. They were stubs, so a handler's `interaction.users.map(...)` or `interaction.values.length` threw or read a function on a default mock. Values and collections a test gives are kept.

- [#374](https://github.com/meocord/meocord/pull/374) [`78d444e`](https://github.com/meocord/meocord/commit/78d444e178890d6e5c5327d259b97b311409352b) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A modal Discord refuses as already acknowledged (40060) now leaves the interaction answered, as a refused reply or update does, so the next `respond().send()` edits the answer that was made elsewhere instead of failing the same way. `modal()` still rejects with the refusal.

- [#397](https://github.com/meocord/meocord/pull/397) [`13d8521`](https://github.com/meocord/meocord/commit/13d852149541a2dc9f9bb6aef84e85f44cb39115) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A modal's file upload field reaches the handler's params as an array of the uploaded `Attachment`s, the ones `interaction.fields.getUploadedFiles()` gives. It gave the attachments' ids. For a bot upgrading from an earlier 4.1 beta, a handler that read ids from the field takes them from the attachments: `files.map(file => file.id)`.

  `createModalFields` takes an array of `Attachment`s for a file upload field, so a test can submit one: `createModalFields({ screenshot: [attachment] })`.

- [#358](https://github.com/meocord/meocord/pull/358) [`8773cf8`](https://github.com/meocord/meocord/commit/8773cf887717cb407c70dd31f0d59c2317004aaa) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A presenter that fails to draw a view no longer leaves the user without an answer:

  - **An error view** whose `error()` throws or rejects, or returns a view MeoCord cannot render, such as a colour that is no colour or an empty text, is answered with MeoCord's own error view. The failure is still logged as the call's fault, and a testing module's `dispatch` still rejects with it. An asynchronous `error()` was the only one answered this way before.
  - **A loading view** whose `loading()` fails the same way, or takes longer than a second to draw, is replaced by MeoCord's own loading view, with a warning naming the presenter, so the click is still locked and the handler still runs. A drawing that comes later is left unused.

- [#342](https://github.com/meocord/meocord/pull/342) [`d9a03d0`](https://github.com/meocord/meocord/commit/d9a03d072c550f408bf77f6dbb58a1fc99ce2240) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Three fixes to how `@MeoCord({ providers })` and a testing module wire classes and providers:

  - A provider that would receive `ExecutionContext` is refused as the app is created: a factory provider whose `inject` lists it, or a `useClass` provider whose class injects it. The message names where it is declared and its token, such as `App: @MeoCord({ providers }): the provider for 'audit' uses Audit, which injects ExecutionContext, …`. Such a provider is made once, so the context it received was an empty one, bound for the whole app, and every later call shared it.
  - A class whose own source contains the text `[native code]`, such as one that inspects functions, is injected like any other class of the app. It was taken for a built-in constructor and never bound, so the app stopped at startup with `No bindings found for service`.
  - Providers or classes that inject each other in a cycle are refused as the app is created, naming the cycle, such as `'a' → 'b' → 'a'`. The app failed when the first of them was made, with `Circular dependency found: (No dependency trace)`.

- [#353](https://github.com/meocord/meocord/pull/353) [`bbe1ef2`](https://github.com/meocord/meocord/commit/bbe1ef286981e687385c0d25df60b793c9cc2b1e) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A reaction no longer re-fetches its message from Discord's API when the bot already holds it whole. Every reaction add and remove cost one request, queued behind Discord's rate limits, so a reaction-role or poll message delayed every handler under a burst of reactions. Now `reaction.message` is the copy the gateway keeps current, fetched first only when the bot holds the message by its id alone, and a reaction that arrives without its count (with `Partials.Reaction`) is fetched once, so `reaction.count` is no longer `null`.

  This changes 4.0's behaviour, which fetched the message for every reaction. The cached copy differs from a fresh fetch only rarely: after a reconnect that could not resume and so missed an edit, or for a poll's counts when the bot lacks the `GuildMessagePolls` intent. A handler that needs the message straight from Discord calls `await reaction.message.fetch()` itself.

- [#397](https://github.com/meocord/meocord/pull/397) [`fe021d7`](https://github.com/meocord/meocord/commit/fe021d7a2230d292ce01fb953b6e177e14193907) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `HandlerRegistry.messageHelp()` reads the message commands from the table dispatch routes with, so a help command of the app's own lists exactly what the built-in help lists. It also read `@MessageHandler`s on services, which no message reaches, and listed or described them as commands.

- [#288](https://github.com/meocord/meocord/pull/288) [`6e62061`](https://github.com/meocord/meocord/commit/6e62061bb663ac4d802dcca3d2d7e03bc6e5434d) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `respond()` makes the answers of one interaction one after another, and keeps its state right when Discord refuses one.

  - Answers asked for together, such as two `send()` calls at once or the fallback's error while a `send()` is in flight, run in the order they were made: the first replies and the next edits or follows up, instead of both replying.
  - An acknowledgement that fails leaves the interaction unanswered, so the next `send()` replies instead of throwing that failure again.
  - A reply or an update Discord refuses as already acknowledged still throws, and the next `send()` edits. The error answer MeoCord follows up with after such a refusal now reaches Discord.
  - `send()`, `edit()` and `delete()` after `modal()` throw an error saying to answer the modal's submit, since a modal has no message. `modal()` also throws while another answer is in flight.
  - In `meocord/testing`, a mock command that showed a modal rejects `editReply()`, `fetchReply()` and `deleteReply()` with `Unknown Message` (10008).

- [#335](https://github.com/meocord/meocord/pull/335) [`e524937`](https://github.com/meocord/meocord/commit/e5249372ca2170003a05d96924bf4ab2fb42add3) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Routing fixes for handlers that compete for the same interaction:

  - **Two `@Autocomplete` handlers for one option are named at startup.** Two handlers that complete the same option of a command, or every option of one path, used to start silently, and the first controller listed always won. The warning about command handlers that never run now names the one that never does, and the one that runs instead. Handlers of an option Discord never asks to complete are named for that alone. The bot still starts. In the next major version (5.0), it refuses to start. See [the upgrade guide](https://meocord.dev/docs/4.1/migrating#a-second-autocomplete-for-one-option-logs-a-warning).
  - **The warning about overlapping component patterns names the handler that runs.** For each pair of patterns that can match the same customId, such as `a/{x}/c` and `a/b/{y}`, it now says which handler runs for the ids both match, and why: the more specific pattern, or between equally specific ones, the one whose controller is listed (or handler declared) first, as in 4.0. Where the next major version (5.0) runs the other one instead, preferring the pattern that spells out the first segment where the two differ, the warning says so, and what to do so the bot does the same before and after: list that handler's controller (or declare that handler) first, or make the patterns distinct. See [the upgrade guide](https://meocord.dev/docs/4.1/migrating#overlapping-component-patterns-meocord-5-prefers-the-one-that-spells-out-more).
  - **The overlap warning is given once, as the bot starts.** It is a startup check like the others: `meocord start`, `meocord register` and the shard manager give it once, where each process-sharded shard gave it again, and `MeoCordTestingModule.compile()` gives it without anything being dispatched. Two handlers whose patterns match exactly the same customIds are refused there too: by the shard manager before it spawns a shard, and by `MeoCordTestingModule.compile()`. A test that expected `invoke()` to reject such a module now sees `compile()` throw the same error.
  - `@Command`'s documentation now says that only patterns matching exactly the same ids stop the bot, that overlapping ones are warned about, and how the next major version (5.0) breaks a tie. `@Autocomplete`'s names the two startup warnings about its handlers.

- [#396](https://github.com/meocord/meocord/pull/396) [`5ae9cc1`](https://github.com/meocord/meocord/commit/5ae9cc1b3e3d6ce4adb2a0d411976117b5c62c5f) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Fixes at the edges of shutdown, sharding, themes and the handler registry:

  - With `sharding.development`, a Ctrl+C while `meocord start --dev` restarts the bot joins that stop, as it does in one process; it no longer kills every shard and exits 1.
  - The shard manager's `stop()` sets `process.exitCode` to 1 when it has to kill a shard, unless another code is set, as a bot in one process does when its client fails to close.
  - A shard's `stop()`, and its report of a failed start, wait at most a second for a manager that is gone, where Bun would otherwise wait for ever.
  - An `onShutdown` hook does not run for a class whose `onReady` was still running when shutdown began, even when it finishes while the calls under way are waited for, as the `OnShutdown` docs say.
  - `useTheme()` outside a call reads the app's theme until the app has shut down, so `onShutdown` hooks and the calls shutdown waits for read it too.
  - A `themeFor` lookup that `ThemeCache` forgot while it was in flight logs nothing when it fails.
  - `HandlerRegistry` gives an entry point command, whose builder returns a REST body, its `command` and `description`. A handler without a builder of its own gets the JSON of its own kind of command, by type and name as Discord tells commands apart, and a context menu's by its whole name. A message command's `scope` is narrowed to `'guild'` by a `member`, `role` or `channel` param or flag, as help shows it.
  - A context menu whose name has a space and whose builder cannot be serialised is no longer reported as one no builder registers.
  - A localization under a key that is not a Discord locale is reported once, as an unknown locale, and its value is not checked.

- [#284](https://github.com/meocord/meocord/pull/284) [`204f93f`](https://github.com/meocord/meocord/commit/204f93fba64dbf6a93aa577c754f588ea08ab599) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Message command params, flags and customId segments look up param types and booleans in tables with no inherited keys, so a customId param named like an inherited key, such as `{__proto__:int}`, keeps its type. A word such as `constructor` or `toString` is now an invalid `bool` value, answered with the usage like any other wrong word. A `{name:type}` whose type is such a name is refused at startup as naming no type, whether or not the app adds its own `messages.types`. An app type is matched only by a name the app gave it.

  `route().build()` reads a param's value and type by the param's own name, so a param named `constructor` or `toString` builds from the value given, and asks for one when none is.

- [#327](https://github.com/meocord/meocord/pull/327) [`47069bc`](https://github.com/meocord/meocord/commit/47069bc77b309963bf9cf80a8d18a6716f65799d) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `ShardContext.call` fixes:

  - **Identical concurrent calls run once each.** With process sharding, two identical calls made at once, such as two users triggering the same announcement, used to run once in each shard and share one answer, and a later identical call could get an earlier call's answer. Each call now runs in every shard and gets its own answer.
  - **One process and tests now pass values as JSON, as process sharding does.** In one process, which is how `meocord start --dev` and the testing module run, the arguments and the result were passed as live objects, while process sharding sends them as JSON. A `Date` arrived as a `Date` in development and tests, then as a string in production, and a returned `Map` arrived as `{}`. They're now passed through JSON in every mode, so a test sees what production gets.
  - **A class a provider stands in for can be called.** `call(Payments, 'charge')` with `providers: [{ provide: Payments, useClass: StripePayments }]` answered "Payments is not a controller or service of this app." It now runs `StripePayments.charge`. With process sharding, a call from another shard names the class, so the bot refuses to start when a provided class shares a name with a controller, a service or another provided class, as it already did for two controllers or services.

- [#380](https://github.com/meocord/meocord/pull/380) [`e0631ab`](https://github.com/meocord/meocord/commit/e0631ab6c7f5c7e54688890ed394ee4727446b6a) Thanks [@l7aromeo](https://github.com/l7aromeo)! - The process-sharding manager checks what it can before it does anything:

  - **A build for another platform stops before the manager registers commands or spawns a shard.** The check ran only in each shard, so the manager registered the commands and spawned shard 0 before the build was refused.
  - **A missing bundle is found before anything is registered.** A manager started without a bundle to spawn shards from registered the commands and asked Discord for the shard count before saying it could not find one.
  - **`start()` starts the manager once.** A second call, at once or later, registered the commands and spawned every shard again; it now waits for the first.

- [#321](https://github.com/meocord/meocord/pull/321) [`22e3c3e`](https://github.com/meocord/meocord/commit/22e3c3e5d5da091c42b8c52268f0bb8e88e6e50e) Thanks [@l7aromeo](https://github.com/l7aromeo)! - Process sharding now handles a shard whose start fails:

  - **A failed start ends the shard, so its manager restarts it.** The failure might be a network error at login, a provider factory that rejects, or Discord being briefly unavailable. Before, the shard set exit code 1 and kept running without logging in, so the manager never restarted it and its servers stayed offline until the whole bot was restarted. The shard now exits 1 once `main.ts` has handled the rejection, and the manager restarts it with the usual backoff.
  - **An app MeoCord refuses stops the bot.** Examples are two services with one name, a provider of the wrong shape, or native addons built for another platform. Every shard would refuse it alike, so the shard tells its manager, which logs "Shard N cannot start; stopping every shard." with the reason, and where it is, on lines of its own, stops every shard and exits 1. Under `meocord start --dev`, the session then reports that the application exited with code 1 and waits for a change, rather than that the bot could not log in. Before, the manager restarted the shard about once a minute, forever, while a process supervisor saw a healthy process.
  - **A shard listens to its manager from the start.** A stop request, or the manager going away, while the shard's providers are still being made now stops the shard before it logs in. Before, the shard went on to log in with no manager, and a restarted manager then ran a second copy of it.

  Outside process sharding, a failed `start()` still leaves the process to `main.ts`.

- [#351](https://github.com/meocord/meocord/pull/351) [`2ce5380`](https://github.com/meocord/meocord/commit/2ce5380e54d95e898cb49923dcdb43ca71cc16c0) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A shard whose manager is gone no longer crashes on a call with a cooldown. When the manager died, each shard began its graceful shutdown, but `ShardedCooldownStore` still sent to the closed IPC channel. On Node, that send raised an unhandled `'error'` event, so the shard exited 1 at once and skipped its shutdown hooks. On Bun, the message was dropped, and the call waited out `cooldownStoreTimeoutMs`. Now the store checks the channel before sending and reports a failed delivery to the call, so the call fails with `CooldownStoreError` at once on both runtimes, and the shutdown carries on. A call sent just before the manager died fails as soon as the channel closes, too, rather than waiting out `cooldownStoreTimeoutMs`.

- [#369](https://github.com/meocord/meocord/pull/369) [`951d5ac`](https://github.com/meocord/meocord/commit/951d5ac8eecf60df5acb7f1feaa5e4c5aec12292) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `shutdownTimeout` in `meocord.config.ts` is at most 2147478647 ms. Node fires a timer longer than 2147483647 ms at once, and the shard manager and `meocord start --dev` wait up to 5 seconds past `shutdownTimeout`, so a larger value made the bot or those two give up on shutdown at once. The config now refuses such a value as it loads, as it refuses a negative one. A bot started without the CLI, whose config is not checked, waits the default 10 seconds instead and warns, naming the value it was given.

  `@MeoCord({ themeForTimeoutMs })` names `Infinity` or `NaN` in its refusal, where it said `null`, and words it as `cooldownStoreTimeoutMs` does.

- [#315](https://github.com/meocord/meocord/pull/315) [`f12857d`](https://github.com/meocord/meocord/commit/f12857d509aa72dd564102d64deda90f44153900) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A `@Catch` given something that is not an error class, such as an `undefined` from an import cycle, is named in a warning as the filter loads, and now matches no error: `Broken: @Catch's first entry, undefined, which matches no error, is deprecated; in the next major version (5.0) it is refused. Use an error class, such as @Catch(CooldownError), instead.` It used to throw "Right-hand side of 'instanceof' is not an object" at the first error to reach the filter, which hid the handler's own error and handled the call a second time. The bot still starts; in the next major version (5.0) it is refused. See [the upgrade guide](https://meocord.dev/docs/4.1/migrating#a-catch-entry-that-isnt-a-class-logs-a-warning).

- [#336](https://github.com/meocord/meocord/pull/336) [`1e442d1`](https://github.com/meocord/meocord/commit/1e442d11a3fd92735975ac1b86bde414288892d6) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A base controller's class stages now wrap the classes that extend it, as global stages wrap controllers. Guards and interceptors run the top base's first, then each subclass's, then the method's. Filters are tried the other way: the method's, then the subclass's, then each base's, then the global ones. In the 4.1 betas the subclass's guards ran before the base's, so a guard a subclass added ran even for callers the base's auth guard would refuse. For a handler the subclass declared itself, the base's filters were also tried first, so a catch-all on the base hid the subclass's own, more specific filter. Class cooldowns keep their order, and `inspectHandler` and the `MetadataKey.Guards` metadata list the stages in the order they now run.

- [#287](https://github.com/meocord/meocord/pull/287) [`dea37a4`](https://github.com/meocord/meocord/commit/dea37a41444c0ba00eef95864dace1d2eada49e5) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `start()` sets the bot up once. Calling it again after a failed login used to attach every event handler a second time, so each command, message and reaction ran twice, `onReady` ran twice, and an app with a presenter could no longer answer the built-in `help`. Now a retry logs in again with the handlers it already has. Two calls at once share one start, and a call once the bot is online does nothing.

  After a retry logs in, the client works as a fresh one would: `isReady()` reports it, shutdown closes the gateway, and configured cache sweepers run again. A failed login makes discord.js destroy its client, so MeoCord undoes that before trying again.

  A retry that logs in now clears the exit code the failed login set to `0`, which Bun keeps, rather than to `undefined`, which Bun ignores. It also gives code that runs outside a handler, such as a scheduled job calling `useTheme()`, the app's theme again, which the failed login had dropped.

  Retrying `start()` after a failed login is deprecated; in the next major version (5.0) it rejects. Use `MeoCordFactory.create` to make a new app instead. It logs that warning once. A retry after a provider's factory failed stays supported, with no warning. See [the upgrade guide](https://meocord.dev/docs/4.1/migrating#retrying-start-after-a-failed-login-is-deprecated).

- [#379](https://github.com/meocord/meocord/pull/379) [`d5a2e03`](https://github.com/meocord/meocord/commit/d5a2e03e3fafd599a4081964b3e3d2b5eeda0e45) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A class that injects `CooldownStore` gets the app's store, and nothing else is made of it.

  - **The store's hooks run once.** A service that injected `CooldownStore` beside `@MeoCord({ cooldownStore })` made the token count as a class of its own, so the store's `onReady` and `onShutdown` each ran twice, and the first `onShutdown` came before the calls under way had finished. The token now stands for the app's store, so the service depends on the store, and the store's hooks run once, after the last call.
  - **`MeoCordTestingModule` binds the app's store first, as the bot does.** A module made with `fromApp()`, or with `app`, whose app has a `cooldownStore`, failed to compile with "Ambiguous bindings found for service: CooldownStore" when one of its classes injected the token.
  - **A cycle through the token is named.** A store that injects a class which injects `CooldownStore` is refused where it is declared, naming the classes, as any other cycle is, rather than failing with inversify's "Circular dependency" as the bot starts.

- [#330](https://github.com/meocord/meocord/pull/330) [`c62618f`](https://github.com/meocord/meocord/commit/c62618fa7fff13dd07b28701020f030d014c2e3c) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `MeoCordTestingModule.create({ app })` counts cooldowns in the app's `cooldownStore`, as `fromApp` and the bot do. It counted them in a store of its own in memory, so a test of a cooldown never reached the app's store. A `CooldownStore` in the module's `providers` still takes the app's place, and the app's own store is then never built, so what it injects needs no provider. A store of the app's that injects something the test doesn't list needs it in `providers`, or a `CooldownStore` provider in its place.

- [#392](https://github.com/meocord/meocord/pull/392) [`421081b`](https://github.com/meocord/meocord/commit/421081b9bc86caf5dbb7b0539b5ee4407795abd5) Thanks [@l7aromeo](https://github.com/l7aromeo)! - The documentation your editor shows for `meocord/testing` and `meocord/decorator` now matches what the code does. Nothing to change in your code.

  - **Mocks:** `createMockClient` says only a mock message gets a client of its own; give an interaction its `client` when the code under test reaches it. `createMockGuild` says what a manager's `fetch(id)` makes: a member or channel in the guild, a role with that id, or a ban. `createMockUser` is for a user, and `MockProps` names only a property the mock does not let you assign. `createMock`, `createMockGuild` and `createChatInputOptions` document their parameter.
  - **Testing module:** the `invoke`, `themeCache` and `overrideThemeFor` examples compile, and `expectCompleteCatalog`'s example passes. `observers` and `init()` name `dispatch` beside `invoke` and `emit`. `inspectHandler`'s `app` says the app's filters are tried after the handler's own. `resolveRoute`'s `dm` says when a handler outside its scope is returned. A `testCooldownStore` case title claims only what it checks.
  - **Decorators:** `@Cooldown`, `@Validate` and `cooldownStoreFailure` say how a message command over its limit, with invalid input or with the store down is answered. `@Defer` describes `mode: 'auto'` and when a misplaced `@Defer` is refused. `@Service` says when to list a class in `services`. `@Controller` says which handlers its class stages reach. `@Command` lists everything it refuses as it applies, and `@Autocomplete` says a handler's own guards run. `@Guard`, `@Interceptor`, `@Observer` and `@Validate` document their options.

- [#398](https://github.com/meocord/meocord/pull/398) [`14f6d3c`](https://github.com/meocord/meocord/commit/14f6d3ce63a758437b3d7eb57d1d2a5a74ae4958) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `meocord/testing` mocks and `resolveRoute` behave as the bot does in four more places:

  - **A mock interaction has a client.** `createMockInteraction` gives an interaction made without a `client` one from `createMockClient`, as a mock message has, with the interaction's user in `client.users.cache` and its channel in `client.channels.cache` once read. Code that reaches `interaction.client`, such as `interaction.client.users.cache` or `interaction.client.user.id`, reads real caches and the mock bot's id rather than stubs.
  - **`getAttachment()` returns an attachment option.** `createChatInputOptions({ file })` with an `Attachment` makes `options.getAttachment('file')` return it, and `null` for an option not given.
  - **Resolved media never takes the bot's id.** A thumbnail, image or media gallery item an edit resolves gets an id no other mock has, the mock bot's included.
  - **`resolveRoute(app, { content, dm: true })` returns nothing for a handler that works only in a server,** by its `scope` or a `member`, `role` or `channel` param in its pattern, as dispatch answers such a message with its usage and never runs the handler.

- [#289](https://github.com/meocord/meocord/pull/289) [`1659e78`](https://github.com/meocord/meocord/commit/1659e78b9c00e004be4c36888daf7a10246edd58) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A build resolves your `paths` from `compilerOptions.baseUrl` when your `tsconfig.json` sets it, as TypeScript does. Before, the build read every `paths` target from the project root, so an alias such as `"@lib/*": ["lib/*"]` with `"baseUrl": "./src"` typechecked but failed to resolve in `meocord build` and `meocord start --dev`. A `baseUrl` your `tsconfig.json` only inherits through `extends` isn't applied to the `paths` it sets itself, so declare those `paths` relative to your project's own `tsconfig.json`. TypeScript 6, which a new app pins, deprecates `baseUrl`, and `tsc` stops with TS5101 where it is set. Without `baseUrl`, TypeScript and the build both read `paths` from the folder `tsconfig.json` is in, as a new app's `"@src/*": ["./src/*"]` does, so write each target from there, or keep `baseUrl` and set `"ignoreDeprecations": "6.0"`.

  `meocord start --dev` rebuilds when you save `meocord.config.ts` or `tsconfig.json`, and each rebuild writes a copy of your `tsconfig.json`. Those copies now share one temporary directory and one exit listener for the session, instead of one each. On Node, a session with several such saves no longer prints `MaxListenersExceededWarning` for `exit`.

  A build or `start --dev` that stops before it can clean up, such as one killed, crashed or closed with its terminal, left its directory in your system's temp directory for good. The next build or `start --dev` on the same machine now removes it. Directories left by earlier 4.1 betas, named `meocord-tsconfig-` and six characters, can't be told apart from a build that is still running, so they stay: delete them yourself while no MeoCord build or `start --dev` is running.

- [#338](https://github.com/meocord/meocord/pull/338) [`b6a34af`](https://github.com/meocord/meocord/commit/b6a34af3da9535d538a134203d66086d10fc6e31) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `warnUnanswered` now also warns when an interceptor returns without calling `next.handle()` and leaves the interaction unanswered, or deferred by `@Defer()` with no follow-up, as an interceptor that answers from a cache can. The warning names the interceptor: `Shop.buy: its interceptor Cached returned before the handler ran, without answering the interaction, …`. It warned only when the handler itself ran, so this case passed silently while the user saw "The application did not respond".

  An interceptor that returns before the handler finishes, as one racing `next.handle()` against a timeout does, is named the same way, the outermost when several do, `… returned before the handler finished, …`, rather than the warning blaming the handler for an answer it was still about to send.

- [#323](https://github.com/meocord/meocord/pull/323) [`ef58d97`](https://github.com/meocord/meocord/commit/ef58d97c38be3d12c878e682ace20ff2bb613118) Thanks [@l7aromeo](https://github.com/l7aromeo)! - The startup warning about command handlers that Discord never sends now also covers `@Autocomplete` handlers. One is named when:

  - no builder registers its command;
  - its path isn't a subcommand that its command's builder registers;
  - it names an option the builder doesn't register, or one built without `setAutocomplete(true)`;
  - it completes every option of a subcommand that has no option with autocomplete on.

  A handler of the whole command is checked against every option of the command, its subcommands' included, since MeoCord falls back to it for all of them. The bot still starts. In the next major version (5.0), these refuse to start. See [the upgrade guide](https://meocord.dev/docs/4.1/migrating#a-command-handler-discord-never-sends-logs-a-warning).

  `MeoCordTestingModule.compile()` names the same cases, apart from a command no builder registers, as it already does for `@Command` handlers.

  `meocord generate controller autocomplete <name>` now ends by saying what to add to `/<name>`'s builder, the `query` option with `setAutocomplete(true)`, since the generated handler completes that option and Discord never asks it to until the command declares it.

- [#307](https://github.com/meocord/meocord/pull/307) [`db19771`](https://github.com/meocord/meocord/commit/db19771873e3c4b66c8c0ee2072f93a21d676422) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A command handler that Discord never sends an interaction to now gets a warning when the app is created, so `meocord start`, `meocord register` and the shard manager report it. Before, such a handler was dead or misrouted with no sign at startup. One warning names every such handler, what is wrong and what to do:

  - a subcommand path that the command's builder doesn't register: `@Command('settings notfy', CommandType.SLASH)` beside a `settings` builder with `view` and `notify`. Before, `/settings notify` silently ran the `settings` handler;
  - a customId pattern, such as a `route()`, given to a slash, context menu or entry point handler, which is matched by its command name;
  - a builder that registers another name than its `@Command`'s, such as `setName('ping')` under `@Command('pong', PingBuilder)`;
  - a slash, context menu or entry point command that no builder registers at all.

  The bot still starts. In the next major version (5.0), these refuse to start. See [the upgrade guide](https://meocord.dev/docs/4.1/migrating#a-command-handler-discord-never-sends-logs-a-warning).

  `MeoCordTestingModule.compile()` gives the same warning, apart from the last case: a handler with a `CommandType` and no builder is how a test fixture is written.

- [#339](https://github.com/meocord/meocord/pull/339) [`d2fb9cf`](https://github.com/meocord/meocord/commit/d2fb9cfc09371cd3fccbe2e9c803dd1ed33847b4) Thanks [@l7aromeo](https://github.com/l7aromeo)! - How MeoCord logs and echoes what users send:

  - **Autocomplete and reactions log their users' outcomes at debug level**, as commands do. An autocomplete call that a guard denies, or whose handler throws a `UserError` or a `ValidationError`, still closes its menu, and is no longer logged as an error with its stack. The same holds for a guard that denies a reaction. `TestingModule.dispatch` resolves for such an autocomplete call or reaction, where it rejected; read what stopped it from the result's `error`.
  - **Log lines quote what a user sent on one line.** A message's text, a reaction's emoji and a component's customId are quoted with line breaks, control characters and quotes escaped, and a message's text is cut short after 200 characters, with its length. So are the messages of the debug lines for a refused, denied or invalid call.
  - **Usage and help replies show the user's words as typed.** A param's value, a flag's name or value, and the command a `help` query names are quoted with their markdown escaped and on one line, so `**up**` or `[text](https://example.com)` reads as written instead of rendering as bold text or a link.

## 4.1.0-beta.9

### Minor Changes

- [#280](https://github.com/meocord/meocord/pull/280) [`c79cd44`](https://github.com/meocord/meocord/commit/c79cd44c4badc87f26a936e57fa1cc33f4cc4136) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A translation's `{params}` are checked against the default catalog's. Until now only its keys were, so a translation that misspelt a param, such as `'Diblokir {usr}.'` for `'Banned {user}.'`, compiled and showed the user `{usr}` as written.

  - **When the code compiles**, `createTranslator` refuses a message that uses a `{param}` its default message doesn't take, and a plural's form may use `{count}` besides. The error names each one, such as `id: ban.done takes no {usr}; the default is "Banned {user}."`. A translation may use the default's params in any order, and leave some out. The compiler reads a message's params only from a catalog whose text it keeps: one made with `defineCatalog`, written with `as const`, or written inline.
  - **When a test runs**, `expectCompleteCatalog` from `meocord/testing` reports the same mistakes from the catalogs' own strings, so a catalog from a plain variable or a JSON file is checked too. It also reports a `{param}` that a translation of MeoCord's own texts uses and MeoCord's English doesn't take.

  A `{param}` is the same thing in every check and when translating: ASCII letters, digits or `_` between braces. Other text in braces, such as `Wrap text in { and }.`, is the message's own. So a default message with such braces no longer makes `t('wrap')` ask for params it doesn't use. A message may also hold hundreds of params: one with 47 or more failed to compile with "Type instantiation is excessively deep and possibly infinite".

  If your build or a test now fails, rename the param to the one the default message uses. A translation may leave a param out, but it can't add one: the translator only fills the params the default message names.

- [#281](https://github.com/meocord/meocord/pull/281) [`c59ddc2`](https://github.com/meocord/meocord/commit/c59ddc28ab25a123c87fbb4f6c6dd7f394a63efb) Thanks [@l7aromeo](https://github.com/l7aromeo)! - `createMockMessage` takes an `author`, so a test can send several messages as one user. Before, every mock message came from a new person, so a per-user `@Cooldown` or a check on who sent a message couldn't be tested through `dispatch()` without assigning `message.author` by hand.

  ```ts
  const author = createMockUser()
  await module.dispatch(createMockMessage({ author, content: '!daily' }))
  await module.dispatch(createMockMessage({ author, content: '!daily' })) // refused by the cooldown
  ```

  - The author is cached on the message's client, so a mention of it resolves to the same user.
  - In a server, the message's `member` is the guild's cached member for that user, such as one given to `createMockGuild({ members })`, or a new member with the author's id, which is then cached. Every message from that author in one server (the same `guild` given to each) has the same member.
  - `author: client.user` gives a message the bot itself sent.
  - An interaction's `member` works the same way: for a `user` the test gives, it is the `guild`'s cached member for that user, or a new member with its id, user and guild, which is then cached. A message and an interaction from one user in one server share the member, whichever is made first.
  - A message built without `author` is unchanged.

### Patch Changes

- [#277](https://github.com/meocord/meocord/pull/277) [`55fe3e4`](https://github.com/meocord/meocord/commit/55fe3e4db223b342b7951e8e36e83cd479cfd21d) Thanks [@l7aromeo](https://github.com/l7aromeo)! - More mistakes MeoCord refuses as the bot loads are reported as one line, naming what to change first, instead of `Error during startup:` and a stack. This covers two classes of one name when either uses `@Cooldown` or `@Once`, `@Validate`, `@UsePipe` or `@Cooldown` on a handler they don't apply to, two component `customId` patterns that match the same ids, `sharding` settings in `meocord.config.ts` that `clientOptions` contradicts, and a self-contained build started on a platform its native addons weren't built for.

  - Two component patterns that match the same ids, and the warning about two that can, are now reported by `MeoCordFactory.create()`, before `start()` attaches anything, and `meocord register` reports them too.
  - The messages lead with the class, handler or file they are about, such as `Shop: two classes have this name; …`. A test that matches the old wording needs updating.

- [#278](https://github.com/meocord/meocord/pull/278) [`2d26fc3`](https://github.com/meocord/meocord/commit/2d26fc397808f6888405690a5dbeedf3e912f93e) Thanks [@l7aromeo](https://github.com/l7aromeo)! - A production build keeps every class's own name. Before, when two modules declared a class of the same name, even a helper that never reaches MeoCord, `meocord build --prod` renamed one of them, such as `Shop` to `shop_controller_Shop`. A development build and your tests kept `Shop`. So in production, cooldowns were counted under the renamed class, errors and logs named it, and `ExecutionContext.getClass().name` returned it.

  - If a controller was renamed this way, its cooldowns start over once, when you deploy this version. Nothing to do: the counts under the old name expire on their own.
  - Two classes of one name are now refused in production as they already were in development and tests. That covers two controllers where either uses `@Cooldown` or `@Once`, and any two controllers or services under process sharding. If your bot stops at startup with this refusal, rename one of the two classes; the message names it.

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
