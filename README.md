# MeoCord Framework

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/meocord/meocord/main/docs/assets/brand/banner-dark.webp">
  <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/meocord/meocord/main/docs/assets/brand/banner-light.webp">
  <img alt="MeoCord: a controller method with @Command, @UseGuard and @Cooldown, answering with respond()" src="https://raw.githubusercontent.com/meocord/meocord/main/docs/assets/brand/banner.webp" width="1280">
</picture>

[![npm version](https://img.shields.io/npm/v/meocord.svg)](https://www.npmjs.com/package/meocord)
[![CI](https://github.com/meocord/meocord/actions/workflows/release.yml/badge.svg?branch=main)](https://github.com/meocord/meocord/actions/workflows/release.yml)
[![node](https://img.shields.io/node/v/meocord)](https://www.npmjs.com/package/meocord)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

**MeoCord** is a decorator-based framework for Discord bots, built on discord.js. Controllers handle slash commands, context menus, buttons, selects, modals, message commands and reactions; guards, interceptors, pipes and exception filters run around them; services reach them through dependency injection. A CLI scaffolds, builds and runs the bot, and `meocord/testing` drives its handlers without Discord.

If you know NestJS, the shape will feel familiar.

**Documentation:** [meocord.dev](https://meocord.dev)

> **Upgrading from 3.x or 4.0?** Follow the [migration guide](https://github.com/meocord/meocord/blob/main/docs/MIGRATING.md).

---

## Table of Contents

- [Features](#features)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Create a New App](#create-a-new-app)
  - [Quick Example](#quick-example)
- [Project Structure](#project-structure)
- [Configuration](#configuration)
  - [meocord.config.ts](#meocordconfigts)
  - [Environment variables](#environment-variables)
  - [Command registration](#command-registration)
  - [ESLint](#eslint)
- [CLI Reference](#cli-reference)
- [Command Types](#command-types)
- [Command Parameters](#command-parameters)
- [Subcommands](#subcommands)
- [Autocomplete](#autocomplete)
- [Message commands](#message-commands)
  - [Typed params](#typed-params)
  - [Flags and lists](#flags-and-lists)
  - [Usage errors](#usage-errors)
  - [Aliases, descriptions and scope](#aliases-descriptions-and-scope)
  - [A help command](#a-help-command)
  - [Prefixes](#prefixes)
  - [Which handler runs](#which-handler-runs)
- [Reactions](#reactions)
- [Interaction responses](#interaction-responses)
  - [Where the interaction happened](#where-the-interaction-happened)
  - [Presenters](#presenters)
- [Theming](#theming)
  - [Tokens](#tokens)
  - [Adding tokens of your own](#adding-tokens-of-your-own)
  - [Defaults](#defaults)
  - [Valid tokens](#valid-tokens)
  - [Setting the theme](#setting-the-theme)
  - [Reading the theme](#reading-the-theme)
  - [What `respond()` themes](#what-respond-themes)
  - [Themes per server and per user](#themes-per-server-and-per-user)
  - [Replies to messages](#replies-to-messages)
  - [Migrating from `Theme`](#migrating-from-theme)
- [How a handler runs](#how-a-handler-runs)
- [Guards](#guards)
  - [Passing options to a guard](#passing-options-to-a-guard)
  - [Reading handler metadata](#reading-handler-metadata)
  - [Guards on autocomplete, and denying with a reason](#guards-on-autocomplete-and-denying-with-a-reason)
- [Interceptors](#interceptors)
- [Exception filters](#exception-filters)
  - [User errors](#user-errors)
- [Validation and Pipes](#validation-and-pipes)
- [Cooldowns](#cooldowns)
- [Observers](#observers)
  - [Where calls are counted](#where-calls-are-counted)
  - [Checking a store](#checking-a-store)
  - [Store recipes](#store-recipes)
- [Custom Decorators](#custom-decorators)
- [Gateway Events](#gateway-events)
- [Handler Discovery](#handler-discovery)
- [Providers](#providers)
- [Lifecycle Hooks](#lifecycle-hooks)
- [Localisation](#localisation)
- [Testing](#testing)
  - [Running tests](#running-tests)
  - [MeoCordTestingModule](#meocordtestingmodule)
  - [Running a handler with invoke](#running-a-handler-with-invoke)
- [Deployment](#deployment)
  - [Self-contained builds](#self-contained-builds)
  - [Which runtime the bot runs on](#which-runtime-the-bot-runs-on)
  - [Sharding](#sharding)
- [Contributing](#contributing)
- [Release Notes](#release-notes)
- [License](#license)

---

## Features

- **Decorator-based controllers** — Handle every Discord interaction type — slash commands and their subcommands, autocomplete, buttons, modals, all five select menus, context menus, activity entry points, messages, and reactions — with `@Command`, `@Autocomplete`, `@MessageHandler` and `@ReactionHandler`. No routing boilerplate.
- **Dependency injection** — Built on Inversify. Services are wired into controllers automatically; no manual instantiation or service locators. Providers add values, classes and async factories under any token, injected with `@Inject`.
- **A request pipeline** — [Guards](#guards) decide whether a handler runs, [interceptors](#interceptors) wrap it, [validation and pipes](#validation-and-pipes) check and transform its input, [cooldowns](#cooldowns) limit how often it runs, and [exception filters](#exception-filters) decide what the user is told when something throws. Each applies to a method, a controller, or the whole bot.
- **Interaction responses** — `respond(interaction)` answers every interaction type correctly from any state, deferred or replied, wherever a user-installed app is used; a presenter styles MeoCord's own answers.
- **Cooldowns** — `@Cooldown` limits how often a handler runs, per user, server, channel or for everyone, with a pluggable store to share the count across shards.
- **Observers** — `@Observer` classes hear about every dispatched call once it has settled, with its outcome and duration, for metrics and audit logs, without ever delaying one.
- **Gateway events** — `@On` and `@Once` handle any discord.js client event on a controller or service, with typed arguments and the same pipeline. `HandlerRegistry` lists every handler for a `/help` command or generated docs.
- **Lifecycle hooks** — `onReady` and `onShutdown` on any controller or service, in dependency order, for schedulers, cache warm-up and clean shutdown.
- **Localisation** — One typed catalog per locale for command names, descriptions and replies, checked at compile time.
- **Command registration and sharding** — Register globally, to guilds or to a development guild, from startup or CI; shard in one process or across processes with one setting.
- **Full CLI** — `meocord create`, `build`, `start`, `register` and `generate`, which scaffolds controllers, services, guards, interceptors, filters, pipes and observers, each with a spec. Builds with Rsbuild for development and production.
- **Testing utilities** — `MeoCordTestingModule` runs a handler through its whole pipeline with `invoke` and sends events with `emit`; `inspectHandler`, `createMockInteraction`, `createMock` and the other mocks test controllers without a Discord connection. Type guards and reply state machines work out of the box.
- **TypeScript-first** — Strict types throughout: handler parameters checked against validation schemas and event types, typed metadata and catalogs, and typed config.
- **Extensible build** — An Rsbuild hook in `meocord.config.ts` to adjust the build without ejecting, and a self-contained build that runs without `node_modules`.

---

## Getting Started

### Prerequisites

- **Runtime**: Node.js 22.13 or newer, or Bun 1.x+
- **TypeScript**: 5.0+ with `skipLibCheck` enabled, as generated apps have it; 5.8+ with it off
- **Package manager**: npm, yarn, pnpm, or bun
- **Peer dependencies**: `discord.js` 14 and `dotenv` 18 — `meocord create` installs both

MeoCord ships dual ESM/CJS builds. New projects generated by the CLI are preconfigured for ESM.

### Create a New App

```shell
npx meocord create <your-app-name>
```

The CLI detects installed package managers and prompts you to choose, or you can pass a flag directly:

```shell
npx meocord create <your-app-name> --use-bun
npx meocord create <your-app-name> --use-npm
npx meocord create <your-app-name> --use-pnpm
npx meocord create <your-app-name> --use-yarn
```

The generated project is named after what you passed, pins the framework version that
created it, and comes with a working slash command, button, select menu, modal, context
menu, message and reaction controller, plus a guard, a presenter, a service and a spec for
each. The samples answer through `respond()`, defer slow work with `@Defer`, and limit how
often each command runs with `@Cooldown`.

Add your bot token and start:

```shell
cd <your-app-name>
cp .env.example .env       # then put your token in DISCORD_TOKEN
npx meocord start --dev    # development with live-reload
npx meocord start --build --prod  # production build + start
```

The token is read from the environment rather than written into `meocord.config.ts`,
which is committed — `.env` is gitignored so a token cannot be pushed by accident.
Building needs no token; only starting does. A token Discord refuses, or none at all, stops
`start` and `register` with a line saying so and where to get a new one: Developer Portal →
your application → Bot → Reset Token. Under `start --dev`, a bot that cannot log in ends the
watch session with exit code 1, as no code change fixes it; after any other exit, it waits for
the next change and starts the bot again.

### Quick Example

A minimal slash command. A command Discord knows about needs a builder — that is what gets registered. The
builder receives the name from `@Command`, so the two cannot drift apart:

```typescript
import { SlashCommandBuilder } from 'discord.js'
import { CommandBuilder } from 'meocord/decorator'
import { CommandType } from 'meocord/enum'

@CommandBuilder(CommandType.SLASH)
export class GreetingCommandBuilder {
  build(commandName: string) {
    return new SlashCommandBuilder()
      .setName(commandName)
      .setDescription('Greets someone')
      .addStringOption(option => option.setName('name').setDescription('Who to greet').setRequired(true))
  }
}
```

```typescript
import { respond } from 'meocord/common'
import { Controller, Command, Cooldown } from 'meocord/decorator'
import { type ChatInputCommandInteraction } from 'discord.js'
import { GreetingCommandBuilder } from '@src/controllers/slash/builders/greeting.builder.js'
import { GreetingService } from '@src/services/greeting.service.js'

@Controller()
export class GreetingSlashController {
  constructor(private readonly greetingService: GreetingService) {}

  @Command('greet', GreetingCommandBuilder)
  @Cooldown({ uses: 3, seconds: 10 })
  async greet(interaction: ChatInputCommandInteraction) {
    const name = interaction.options.getString('name', true)
    const message = await this.greetingService.buildGreeting(name)
    await respond(interaction).send({ content: message })
  }
}
```

The service it injects is a plain class:

```typescript
import { Service } from 'meocord/decorator'

@Service()
export class GreetingService {
  async buildGreeting(name: string): Promise<string> {
    return `Hello, ${name}!`
  }
}
```

Register the controller in `src/app.ts`:

```typescript
import { MeoCord } from 'meocord/decorator'
import { GatewayIntentBits } from 'discord.js'
import { GreetingSlashController } from '@src/controllers/slash/greeting.slash.controller.js'

@MeoCord({
  controllers: [GreetingSlashController],
  clientOptions: { intents: [GatewayIntentBits.Guilds] },
})
export default class App {}
```

`GreetingService` needs no listing: a controller that injects it is enough. `services` is for a service nothing injects that still has to exist, such as a scheduler or a queue consumer.

---

## Project Structure

<details>
<summary><b>The generated file tree</b></summary>

```
.
├── README.md
├── .env.example
├── .gitignore
├── .prettierrc.mjs
├── meocord.config.ts
├── eslint.config.ts
├── vitest.config.ts
├── tsconfig.json
├── tsconfig.eslint.json
├── tsconfig.test.json
├── package.json
└── src
    ├── main.ts                         # Entry point — bootstraps the app
    ├── app.ts                          # Root module — registers controllers and services
    ├── controllers
    │   ├── slash
    │   │   ├── builders/               # Slash command option/subcommand builders
    │   │   ├── sample.slash.controller.ts
    │   │   └── sample.slash.controller.spec.ts
    │   ├── button
    │   │   ├── sample.button.controller.ts
    │   │   └── sample.button.controller.spec.ts
    │   ├── select-menu
    │   │   ├── sample.select-menu.controller.ts
    │   │   └── sample.select-menu.controller.spec.ts
    │   ├── modal-submit
    │   │   ├── sample.modal-submit.controller.ts
    │   │   └── sample.modal-submit.controller.spec.ts
    │   ├── context-menu
    │   │   ├── builders/               # Context menu command builders
    │   │   ├── sample.context-menu.controller.ts
    │   │   └── sample.context-menu.controller.spec.ts
    │   ├── message
    │   │   ├── sample.message.controller.ts
    │   │   └── sample.message.controller.spec.ts
    │   └── reaction
    │       ├── sample.reaction.controller.ts
    │       └── sample.reaction.controller.spec.ts
    ├── guards
    │   ├── owner.guard.ts
    │   └── owner.guard.spec.ts
    ├── presenters
    │   ├── app.presenter.ts
    │   └── app.presenter.spec.ts
    └── services
        ├── sample.service.ts
        └── sample.service.spec.ts
```

</details>

---

## Configuration

### `meocord.config.ts`

The top-level config file. At minimum it needs `discordToken`. The `rsbuild` hook lets you adjust the build without ejecting.

```typescript
import 'dotenv/config'
import { type MeoCordConfig } from 'meocord/interface'

export default {
  appName: 'MyBot',
  discordToken: process.env.DISCORD_TOKEN!,
  rsbuild: config => {
    // Import .md and .html files as their text.
    config.tools ??= {}
    config.tools.rspack = (_rspackConfig, { addRules }) => {
      addRules([{ test: /\.(md|html)$/i, type: 'asset/source' }])
    }
    return config
  },
} satisfies MeoCordConfig
```

MeoCord builds with [Rsbuild](https://rsbuild.rs). The hook receives its configuration and returns it, modified. A few things it handles for you, so you do not need rules for them:

- **Images, fonts, svg and media** are emitted to `dist/assets/`, and importing one gives you its absolute path on disk — ready for `fs`, canvas, or a Discord attachment. Nothing is ever inlined as a data URI, whatever its size. A new app's `src/assets.d.ts` types each such import as a `string`, and a Markdown or HTML import, read as text by the template's rule, as its text.
- **Custom asset paths** — `output.filename.image` (and `svg`, `font`, `media`) accept a function, for when two files share a name in different folders:

  ```typescript
  import path from 'node:path'

  // ...
  rsbuild: config => {
    config.output ??= {}
    config.output.filename = {
      ...config.output.filename,
      // Keep the folder a file came from, so image/star.webp and image/hsr/star.webp do not collide.
      // The result is relative to dist/assets/, and uses / on every platform.
      image: ({ filename }) => path.relative('src/assets', filename ?? '').split(path.sep).join('/'),
    }
    return config
  },
  ```

- **Raw bundler rules** go through `tools.rspack`, which takes a webpack-shaped configuration.

| Option               | Default | Description                                                                                                |
| -------------------- | ------- | ---------------------------------------------------------------------------------------------------------- |
| `discordToken`       | —       | The bot token. Read it from the environment rather than writing it here.                                   |
| `appName`            | —       | Shown in log lines.                                                                                        |
| `rsbuild`            | —       | `(config) => config` — adjust the Rsbuild configuration.                                                   |
| `bundleDependencies` | `false` | Put everything the bot needs inside `dist`, native addons included, so it runs without `node_modules`.     |
| `externals`          | `[]`    | Modules to keep out of the bundle. Native addons are found without being listed.                           |
| `optionalExternals`  | `[]`    | Packages a dependency tries to load and runs without, such as `supports-color`; see below.                 |
| `shutdownTimeout`    | `10000` | Milliseconds shutdown waits for the [`onShutdown` hooks](#lifecycle-hooks), all of them together.          |
| `sourceMappedStacks` | `true`  | Stack traces name your source files — see [Stack traces](#stack-traces).                                   |
| `logLevel`           | —       | The least severe line `Logger` prints — see [Log level](#log-level).                                       |
| `commands`           | global  | Where commands are registered, and whether at startup — see [Command registration](#command-registration). |
| `sharding`           | —       | Split the gateway connection into shards — see [Sharding](#sharding).                                      |

See [Self-contained builds](#self-contained-builds) for when to turn on `bundleDependencies`.

Some dependencies try to load a package and carry on without it: `debug`, which axios and the HTTP proxy agents bring in, probes for `supports-color` inside a `try`. With `bundleDependencies` on, the bundler warns at every build about each such package that is not installed; for `supports-color`, the build says which dependency probes for it and that the bot runs without it. List it in `optionalExternals`: it stays a `require` where the dependency calls it, so a missing package is caught by the dependency, and it is copied into `dist/node_modules` when it is installed. Do not put it in `externals` as well, where it becomes an import that runs before the bot and fails when the package is missing; MeoCord warns if you do.

```typescript
optionalExternals: ['supports-color'],
```

### Stack traces

A stack trace names your source, `src/services/profile.service.ts:42:11`, not the bundle, on Node and Bun alike. The build writes `dist/main.js.map` beside the bundle, in development and production, and:

- `meocord start` runs node with `--enable-source-maps`, so Node maps each stack itself. Its shard processes inherit the flag.
- A bundle started any other way — `node dist/main.js` in a Docker `CMD`, pm2, or bun, which applies no source map to a bundle — maps its stacks through `Error.prepareStackTrace`. The map is read the first time a stack needs it, and each frame keeps the runtime's format, `at fn (/abs/path/src/file.ts:line:col)`, so tools that parse `error.stack` read it as before.
- A hook already set on `Error.prepareStackTrace`, such as a preloaded error tracker's, receives the mapped call sites. One set later replaces MeoCord's unless it calls the hook it found. A hook that throws is passed over, and so is the runtime's own for an object `Error.captureStackTrace` is given that is not a native error, as some packages give it: that stack reads as it does with no hook.
- Bun reports a call's column further along than Node does. In a minified production bundle, a frame for a call can map to the statement just before it, one line up; the frame that threw maps exactly.

Set `sourceMappedStacks: false` when an error tracker applies uploaded source maps to the bundle's own positions, or you ship a source mapper of your own. `meocord start` then passes no flag, and the bundle installs no hook.

### Log level

`Logger`, and every line MeoCord logs through it, prints from a level up. `[DEBUG]` lines show in development, where `NODE_ENV` is `development` as under `meocord start --dev`, and are hidden everywhere else, so a production log shows what went wrong without the raw errors and stacks behind it.

| Level      | Prints                                                                     |
| ---------- | -------------------------------------------------------------------------- |
| `'debug'`  | everything                                                                 |
| `'log'`    | `[LOG]`, `[WARN]` and `[ERROR]`: `log`, `info`, `verbose`, `warn`, `error` |
| `'warn'`   | `[WARN]` and `[ERROR]`                                                     |
| `'error'`  | `[ERROR]` only                                                             |
| `'silent'` | nothing                                                                    |

Set `logLevel` in `meocord.config.ts` to choose another, or `MEOCORD_LOG_LEVEL` for one run without a rebuild; the variable wins over the config:

```shell
MEOCORD_LOG_LEVEL=debug node dist/main.js
```

`MEOCORD_LOG_LEVEL` is read in any case, so `DEBUG` is `debug`. One that names no level is reported once, even under a level that hides warnings, and the config or the default applies. The level is read once, when the first line is logged, so a busy bot never looks it up again. `logLevel` is the built bot's: the CLI and your tests print by `MEOCORD_LOG_LEVEL` and the default alone, whatever a previous build left in `dist`.

### Environment variables

Load `.env` in `meocord.config.ts`, as the generated one does with `import 'dotenv/config'`, not in `main.ts`. The build runs the config ahead of `main.ts`, so every `process.env` value it loads is already set when `@MeoCord({...})` and the rest of your modules read it — whether the bot starts with `meocord start`, `node dist/main.js`, bun, pm2 or Docker.

To keep one file per environment, put the choice in a module the config imports:

```typescript
// src/load-env.ts
import { existsSync } from 'node:fs'
import path from 'node:path'
import { config } from 'dotenv'

// APP_ENV picks the file: .env.dev, .env.staging, .env.prod. Paths resolve from the directory the bot starts in.
const file = path.resolve(`.env.${process.env.APP_ENV ?? 'dev'}`)

config({ path: existsSync(file) ? file : path.resolve('.env'), quiet: true })
```

```typescript
// meocord.config.ts
import './src/load-env'
import { type MeoCordConfig } from 'meocord/interface'

export default {
  discordToken: process.env.DISCORD_TOKEN!,
} satisfies MeoCordConfig
```

```shell
APP_ENV=staging node dist/main.js
```

Start the bot from the project root: the `.env` files and `dist/meocord.config.mjs` are both found from the working directory, so set `cwd` in pm2 and `WORKDIR` in a Dockerfile.

### Command registration

The bot registers its slash, context menu and entry point commands once it is ready. By default they go globally, every start. `commands` in `meocord.config.ts` changes where:

```typescript
export default {
  discordToken: process.env.DISCORD_TOKEN!,
  commands: {
    developmentGuild: process.env.DEV_GUILD_ID || undefined, // every command goes here under start --dev
    guilds: undefined, // guild ids to register to instead of globally
    register: true, // false: only `meocord register` registers
    clearOther: false, // true: remove this app's commands from the scopes above that are not in use
  },
} satisfies MeoCordConfig
```

| Option             | Default | Description                                                                                                                                                                        |
| ------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `guilds`           | —       | Register every command to these guilds instead of globally. Unset or empty: global. Only blank ids, as `[process.env.GUILD_ID]` with the variable unset: nowhere, with a warning.  |
| `developmentGuild` | —       | While `NODE_ENV` is `development`, as under `start --dev`, every command goes to this guild and nowhere else. Guild commands show at once.                                         |
| `register`         | `true`  | Register at startup. Set `false` to register only with `meocord register`, from CI for instance.                                                                                   |
| `clearOther`       | `false` | Remove this application's commands from the scopes named here but not in use. Without it, or while `developmentGuild` receives every command, leftovers are reported as a warning. |

Each scope gets one bulk update, which replaces everything the application has there, so a removed command disappears on the next registration. A failed registration is logged and the bot stays online.

**One command in its own guilds.** A builder's `guilds` option sends its command to those guilds only, in place of the scope above — for staff commands, say. The ids are read when the class is decorated, after `.env` has loaded:

```typescript
@CommandBuilder(CommandType.SLASH, { guilds: [process.env.STAFF_GUILD_ID] })
export class BanCommandBuilder implements CommandBuilderBase {
  build(commandName: string) {
    return new SlashCommandBuilder().setName(commandName).setDescription('Ban a member')
  }
}
```

A builder whose list is empty after dropping blank ids is not registered anywhere, rather than published globally by accident. Under a development guild it goes there with the rest. The same goes for `guilds` in the configuration: a list of blank ids registers the commands without guilds of their own nowhere, warns, clears no leftovers, and makes `meocord register` exit with code 1.

**Leftovers.** Moving from global to guild commands, or the other way, leaves the old ones behind, and Discord shows both. After registering, MeoCord checks the scopes this configuration names — global, `guilds`, `developmentGuild` and builders' guilds — that it did not send to, and warns about any commands left there; `clearOther: true` removes them instead. While `developmentGuild` receives every command, as under `start --dev`, leftovers are only warned about, even with `clearOther`: development and production often share one application, and the global commands belong to production. Production starts and `meocord register` without `--dev` remove them.

**Unchanged commands in development.** Under `start --dev`, a scope whose commands have not changed since the last start from this project is not sent again. The record lives in `node_modules/.cache/meocord`, per application and scope. `meocord start --dev --force-register` sends them anyway — after deleting commands in the developer portal, for instance. Production always sends; the update is idempotent.

**Registering without starting.** `meocord register` registers and exits, without logging in to the gateway. It runs the built bot in a register-only mode that reads the commands and constructs no controller or service, so it needs a build (`--build` makes one) and the same token as the bot:

```shell
npx meocord register --build          # production scope
npx meocord register --dev            # to commands.developmentGuild
npx meocord register --guild 1234567  # every command to one guild
```

It exits non-zero when Discord rejects the token or the commands, so a deploy step can stop on it.

### ESLint

MeoCord exports a base ESLint config from `meocord/eslint`. It lints your TypeScript, `meocord.config.ts`
included, with type information from `tsconfig.json`, `tsconfig.test.json` and `tsconfig.eslint.json`; a
file ESLint reports as not included in any of them needs listing in one. Extend it as needed:

```javascript
import meocordEslint, { typescriptConfig } from 'meocord/eslint'
import unusedImports from 'eslint-plugin-unused-imports'

export default [
  ...meocordEslint,
  {
    ...typescriptConfig,
    plugins: {
      ...typescriptConfig.plugins,
      'unused-imports': unusedImports,
    },
    rules: {
      ...typescriptConfig.rules,
      'unused-imports/no-unused-imports': 'error',
    },
  },
]
```

---

## CLI Reference

```shell
npx meocord --help
```

| Command    | Alias | Description                                                                     |
| ---------- | ----- | ------------------------------------------------------------------------------- |
| `create`   | —     | Scaffold a new MeoCord application                                              |
| `build`    | —     | Compile the application via Rsbuild                                             |
| `start`    | —     | Start the application                                                           |
| `register` | —     | Register the commands, without starting the bot                                 |
| `generate` | `g`   | Scaffold controllers, services, guards, interceptors, filters, pipes, observers |
| `show`     | —     | Display framework info                                                          |

Every command's own flags:

| Command    | Flags                                                           |
| ---------- | --------------------------------------------------------------- |
| `create`   | `--use-npm` · `--use-yarn` · `--use-pnpm` · `--use-bun`         |
| `build`    | `-d, --dev` · `-p, --prod`                                      |
| `start`    | `-b, --build` · `-d, --dev` · `-p, --prod` · `--force-register` |
| `register` | `-b, --build` · `-d, --dev` · `-g, --guild <id>`                |
| `show`     | `-w, --warranty` · `-c, --license`                              |
| `generate` | see the sub-commands below                                      |

`meocord -V` / `--version` prints the installed version.

`build` and `start` default to development; `-p` wins when both `-d` and `-p` are given. `start --dev` builds as it starts and on every change, so `--build` only matters with `--prod`.

`build`, `start` and `register` check `meocord.config.ts` before doing anything: one that fails to load stops them with the file and line, an option of the wrong type stops them with a list of every problem, and an option MeoCord does not know is reported as a warning. Every failure exits with code 1.

`start` accepts one environment variable, `MEOCORD_RUNTIME`, which pins the binary the application is run with — see [Which runtime the bot runs on](#which-runtime-the-bot-runs-on).

```shell
npx meocord build --prod          # production build
npx meocord start --dev           # dev mode with live-reload
npx meocord start --build --prod  # production build + start
```

### Generators

| Sub-command   | Alias | Generates                           |
| ------------- | ----- | ----------------------------------- |
| `controller`  | `co`  | a controller, its spec, its builder |
| `service`     | `s`   | a service and its spec              |
| `guard`       | `gu`  | a guard and its spec                |
| `interceptor` | `i`   | an interceptor and its spec         |
| `filter`      | `f`   | an exception filter and its spec    |
| `pipe`        | `pi`  | a pipe and its spec                 |
| `observer`    | `ob`  | a dispatch observer and its spec    |

#### Controllers

```shell
npx meocord g co <type> <name>
```

`<type>` is one of:

`button` · `modal-submit` · `select-menu` · `user-select-menu` · `role-select-menu` · `mentionable-select-menu` · `channel-select-menu` · `reaction` · `message` · `slash` · `autocomplete` · `context-menu` · `primary-entry-point`

Each one lands in its own directory, named after the type:

```
src/controllers/<type>/
├── <name>.<type>.controller.ts
├── <name>.<type>.controller.spec.ts
└── builders/<name>.builder.ts     # slash, context-menu and primary-entry-point only
```

A builder is generated only for the three types Discord registers by name. Everything else is addressed by `customId` or, for autocomplete, by the command path it completes — there is nothing to register.

Each controller gets its own builder, `<Name>CommandBuilder`, and registers a command named after it: `npx meocord g co slash Greeting` registers `/greeting`. A nested name uses its whole path, so `admin/ban` registers `/admin-ban` from `AdminBanSlashController` — Discord command names are global to the application, while folders only keep files apart. An autocomplete controller completes the slash command of the same name. A context-menu controller registers a user context menu command, and `--message` makes it a message one: `npx meocord g co context-menu Quote --message`.

Buttons, modals, select menus and message handlers take the same name: `npx meocord g co button ticket` routes the customIds `ticket` and `ticket/{id}`, and `npx meocord g co message ping` matches `ping`. Two generated components never share a route, nor share one with the samples `meocord create` writes.

Generating writes files and never edits `src/app.ts`, so it ends by saying where the class goes: `Next: add TicketButtonController to @MeoCord({ controllers }) in src/app.ts.` A guard, interceptor or filter is named with the decorator that applies it; a service is bound when something injects it.

Generating never overwrites. If any file it would write already exists, it refuses, names the files, and writes nothing.

`<name>` may contain `/` to nest: `npx meocord g co button "admin/ban"` writes into `src/controllers/button/admin/`. Names are paths inside that folder: `..`, a leading `/` and drive letters are refused. On Windows, `\` separates folders too. Run generators from your project's root, where its `package.json` is.

Directory layout is organisational only. Controllers are wired up by the `controllers` array on `@MeoCord()`, not by where they sit on disk.

---

## Command Types

`@Command` binds a method to one kind of interaction, and the interaction class the handler receives follows from that. Every type Discord sends is covered.

| `CommandType`             | Handler receives                                                              | Routed by  |
| ------------------------- | ----------------------------------------------------------------------------- | ---------- |
| `SLASH`                   | `ChatInputCommandInteraction`                                                 | name       |
| `CONTEXT_MENU`            | `UserContextMenuCommandInteraction` or `MessageContextMenuCommandInteraction` | name       |
| `PRIMARY_ENTRY_POINT`     | `PrimaryEntryPointCommandInteraction`                                         | name       |
| `BUTTON`                  | `ButtonInteraction`                                                           | `customId` |
| `SELECT_MENU`             | `StringSelectMenuInteraction`                                                 | `customId` |
| `USER_SELECT_MENU`        | `UserSelectMenuInteraction`                                                   | `customId` |
| `ROLE_SELECT_MENU`        | `RoleSelectMenuInteraction`                                                   | `customId` |
| `MENTIONABLE_SELECT_MENU` | `MentionableSelectMenuInteraction`                                            | `customId` |
| `CHANNEL_SELECT_MENU`     | `ChannelSelectMenuInteraction`                                                | `customId` |
| `MODAL_SUBMIT`            | `ModalSubmitInteraction`                                                      | `customId` |

Autocomplete has its own decorator — see [Autocomplete](#autocomplete). It has no `CommandType` member, because it registers nothing and is answered with `respond()` rather than a reply. `@MessageHandler` and `@ReactionHandler` are outside `CommandType` for the same reason: `CommandType` is the set of things `@Command` can bind to, not the set of things MeoCord handles.

The kebab-case `ControllerType` used by the CLI is a wider list — it names every kind of controller that can be scaffolded, including the three that are not commands.

The four entity select menus are separate types because Discord sends them as separate component types carrying different resolved data. Declaring `SELECT_MENU` for a user select menu is a type error, not a silent mismatch:

```typescript
@Command('assign/{taskId}', CommandType.USER_SELECT_MENU)
async assign(interaction: UserSelectMenuInteraction, { taskId }) {
  await interaction.reply(`Assigned to ${interaction.users.map(user => user.username).join(', ')}`)
}
```

A context menu handler takes the kind of interaction its builder registers: `UserContextMenuCommandInteraction` for a builder that calls `setType(ApplicationCommandType.User)`, `MessageContextMenuCommandInteraction` for `Message`, or the union of both. The kind a builder sets is a value TypeScript cannot read, so the bot checks it as it starts: a handler that declares the other kind stops it with an error naming both. A user and a message context menu command may share a name, and each reaches its own handler.

```typescript
@CommandBuilder(CommandType.CONTEXT_MENU)
export class QuoteCommandBuilder {
  build() {
    return new ContextMenuCommandBuilder().setName('Quote').setType(ApplicationCommandType.Message)
  }
}

@Command('Quote', QuoteCommandBuilder)
async quote(interaction: MessageContextMenuCommandInteraction) {
  await respond(interaction).send(`> ${interaction.targetMessage.content}`)
}
```

### Slash command options

A slash handler's second argument holds the options the command was invoked with, keyed by name. Entity options arrive resolved — a `User`, `Role`, `GuildChannel` or `Attachment`, not the snowflake:

```typescript
@Command('kick', KickCommandBuilder)
async kick(interaction: ChatInputCommandInteraction, { target, reason }) {
  // target is a User, reason is a string
  await interaction.reply(`Kicked ${target.username}: ${reason}`)
}
```

### Entry point commands

Activity entry points have no builder class in `@discordjs/builders`, so their builder returns the REST body directly. `handler: AppHandler` is what makes Discord send the interaction to the bot at all:

```typescript
@CommandBuilder(CommandType.PRIMARY_ENTRY_POINT)
export class LaunchCommandBuilder {
  build() {
    return {
      type: ApplicationCommandType.PrimaryEntryPoint as const,
      name: 'launch',
      description: 'Launch the activity',
      handler: EntryPointCommandHandlerType.AppHandler,
    }
  }
}
```

---

## Command Parameters

Buttons, select menus and modals route on their `customId`, and a pattern can capture parts of it. Captured values arrive as the handler's second argument. A modal handler's second argument also carries the submitted fields, keyed by their customId: a text input's text, a select's chosen values. A select menu handler's carries what the user chose:

| Select menu | Second argument, beside the captured values                                    |
| ----------- | ------------------------------------------------------------------------------ |
| String      | `values`: the chosen options' values                                           |
| User        | `values`, the chosen ids; `users`, the `User`s; `members`, those in the server |
| Role        | `values`; `roles`, the `Role`s                                                 |
| Channel     | `values`; `channels`, the channels                                             |
| Mentionable | `values`; `users`, `members` and `roles`, as they were chosen                  |

So [`@Validate`](#validation-and-pipes), pipes and [`@Cooldown({ by })`](#counting-per-resource) see a choice as they see a modal field: `@Cooldown({ seconds: 3600, per: 'global', by: (_context, { values }: { values: string[] }) => values[0] })` limits each option of a poll on its own. When a field or a choice and a captured value share a name, the captured value wins, and development logs a warning.

```typescript
@Command('profile/{ownerId}/{uid}', CommandType.BUTTON)
async showProfile(interaction: ButtonInteraction, { ownerId, uid }) {
  // customId `profile/123/800000001` gives ownerId '123', uid '800000001'
}
```

`/` separates segments, and **a parameter must occupy a whole segment** — the same rule Express and Rails use for a path. A pattern that breaks it throws as soon as `@Command` decorates the method, when the controller is loaded:

```typescript
@Command('profile/{uuid}', CommandType.BUTTON)      // fine
@Command('gi-profile/{ownerId}', CommandType.BUTTON) // fine — the hyphen is inside a literal segment
@Command('profile-{uuid}', CommandType.BUTTON)       // throws
```

```
Invalid pattern "profile-{uuid}": {uuid} must occupy a whole segment, so it has to be
preceded and followed by "/" or by the ends of the pattern. Write "a/{uuid}" rather
than "a-{uuid}".
```

<details>
<summary><b>Why the rule exists</b></summary>

A parameter matches anything up to the next `/`, so an identifier you do not control is captured whole — a hyphen inside a uuid is data, not structure:

```typescript
@Command('profile/{uuid}', CommandType.BUTTON)
// `profile/8400e29b-41d4-a716`  ->  uuid '8400e29b-41d4-a716'
```

That only works because the separator cannot appear inside a value. Let a parameter share a segment with a literal and the boundary disappears: `profile-{uuid}` and `profile-{uuid}-{id}` both match `profile-a-b-c`, and neither reading is more correct than the other. No rule can settle that afterwards, so the shape is refused up front.

Segment counts then keep neighbours apart on their own:

```typescript
@Command('profile/{uuid}', CommandType.BUTTON)        // profile/8400e29b-41d4-a716
@Command('profile/{uuid}/{id}', CommandType.BUTTON)   // profile/8400e29b-41d4-a716/99
```

Each id matches exactly one of them.

</details>

<details>
<summary><b>Overlapping patterns</b></summary>

Two patterns with the same segment count can still both match. The one spelling out more literal text wins, so declaration order and file layout never decide it:

```typescript
@Command('profile/summary/{ownerId}/{uid}', CommandType.BUTTON)  // wins profile/summary/123/456
@Command('profile/{uuid}/{other}/{uid}', CommandType.BUTTON)     // wins everything else
```

Ties between equally literal patterns go to the one with fewer parameters. The ranking is computed once when the bot starts, so dispatch stays a single ordered lookup.

Where two patterns trade a literal for a parameter in opposite positions — `a/{x}/c` and `a/b/{y}` both take `a/b/c` — neither is more literal, and MeoCord logs a warning at startup naming the pair.

Two handlers whose patterns match exactly the same customIds of one component type — the same pattern, or one differing only in its param names, such as `profile/{uid}` and `profile/{id}` — stop the bot at startup, naming both, since only one of them could ever run. One handler declared under both spellings is one route. The same pattern on a button and a modal is fine: dispatch never confuses component types.

</details>

<details>
<summary><b>Building customIds from a route</b></summary>

`route()` from `meocord/common` turns a pattern into a value that `@Command` takes and that builds the customIds it matches, so the button you send and the handler that receives it share one definition:

```typescript
import { route } from 'meocord/common'

export const ticket = route('ticket/{id}/{action}')

@Command(ticket, CommandType.BUTTON)
async handle(interaction: ButtonInteraction, { id, action }: { id: string; action: string }) {
  // ...
}

new ButtonBuilder().setCustomId(ticket.build({ id: 42, action: 'close' })) // 'ticket/42/close'
```

`build` takes exactly the pattern's params: a missing or unknown one fails to compile, and a route without params takes nothing. The handler's params are checked against the route too: each key they require must be one of its params, or a select menu's choice such as `values`, so `{ ticketId }` against `route('ticket/{id}')` fails to compile. A modal's handler may name its fields beside them, and a command's options are not checked. An untyped param's value type is not checked here, since `@Validate` and pipes change it; `@Validate` checks it. A [typed param](#typed-customid-params) is checked, and `build` takes a value of its type. An untyped param's value may be a string, a number or a bigint. A `/` or `%` inside a value is encoded as `%2F` or `%25`, and handlers receive it decoded, so a value never spills into the next segment. An empty value, or a customId longer than Discord's 100 characters, throws.

A route is ranked, and checked for duplicates, exactly as its pattern string would be, and `` `${ticket}` `` gives the pattern back. Plain string patterns keep working beside routes.

</details>

<details>
<summary><b>Typed customId params</b></summary>

#### Typed customId params

A customId param can name a type, `{name:type}`, as a [message command's](#typed-params) does. Its segment is read as that type with the same parsers, and the handler receives the value:

```typescript
export const counter = route('counter/{count:int}')

@Command(counter, CommandType.BUTTON)
async count(interaction: ButtonInteraction, { count }: { count: number }) {
  await respond(interaction).send({ components: [row(new ButtonBuilder().setCustomId(counter.build({ count: count + 1 })).setLabel(`${count + 1}`))] })
}
```

| Type                       | Gives             | A segment such as     |
| -------------------------- | ----------------- | --------------------- |
| none, or `string`          | `string`          | `abc`                 |
| `int`, `number`            | `number`          | `42`, `-3`; `2.5`     |
| `bool`                     | `boolean`         | `true`, `false`, `on` |
| words, such as `asc\|desc` | `'asc' \| 'desc'` | `asc`, as written     |

- A segment that is not a value of its type does not match, so the next route is tried, and a customId no route takes is [not found](#when-nothing-matches). Beside a text param in the same place, a typed one is tried first, and of two types the narrower, whatever order they are declared in: words to choose from, then `bool`, `int` and `number`. `page/{n:int}` takes `page/5`, `page/{x:number}` takes `page/2.5`, and `page/{name}` takes `page/last`.
- Patterns whose typed segments cannot take one value, such as `item/{n:int}` and `item/{f:bool}`, are different routes. Two whose segments can, such as `r/{w:on|off}` and `r/{f:bool}`, are both kept: a value both take, `r/on`, goes to the narrower, and the bot warns about the pair at startup. Only patterns that read alike, such as `s/{w:on|off}` and `s/{v:off|on}`, match the same customIds and stop the bot, as two text patterns would.
- `route(pattern).build()` takes a value of each typed param's type, and throws for one that would not read back, such as `1.5` for an `int`.
- The handler's typed params are checked against the pattern, for a route and for a plain string pattern: `{ count: string }` for `{count:int}` fails to compile. Untyped params stay unchecked, since `@Validate` and pipes change them.
- A customId holds text the bot wrote, with no message to read a member, user, role or channel from, so `{target:member}` stops the bot where it is declared, as does any other type: write `{target}` for its ID, and fetch it in the handler.

</details>

<details>
<summary><b>When nothing matches</b></summary>

An unroutable interaction raises `CommandNotFoundError`, which the [built-in fallback](#the-built-in-fallback) answers with "Command not found!", and logs a warning naming the `customId` or command that failed to match. If a control appears dead, that log line is the first place to look.

A button, select menu or modal submission no route takes may be a discord.js collector's, from `createMessageComponentCollector` or `awaitModalSubmit`. While anything besides MeoCord's dispatch listens for the client's interactions, a collector or an app's own `@On('interactionCreate')` handler, MeoCord leaves such an interaction to it for 1.5 seconds, and answers "Command not found!" and logs the warning only if nothing has answered it by then. With no other listener it answers at once, and a command no handler takes is always answered at once.

Autocomplete cannot be replied to, so an unclaimed option is answered with an empty list instead and the warning names the command and option.

A handler that throws goes to its [exception filters](#exception-filters), then to the built-in fallback, which logs the error and answers the user in whatever way the interaction still allows — editing a deferred reply, or following up one already sent.

</details>

<details>
<summary><b>Failures never take the bot down</b></summary>

discord.js calls event listeners without awaiting them, so anything that rejects out of one is an unhandled rejection — which terminates the process by default. MeoCord wraps every listener it registers, so one bad interaction, one unresolvable controller, or one reaction on a deleted message costs that event and nothing else. The error is logged against the event that produced it, so a genuine misconfiguration still shows up on the first interaction rather than staying hidden.

Where the failure happened before the handler ran, the user is still told: an interaction gets the fallback's answer, an autocomplete gets its window closed. A reaction whose message can no longer be fetched — deleted, or in a channel the bot lost access to — is skipped quietly, since that is an ordinary outcome rather than a fault.

</details>

---

## Subcommands

Discord sends `/settings notify email` as a single interaction named `settings`, so a command with subcommands would otherwise have one handler for all of them. Name the full path — parts separated by a space, the way Discord displays them — to give each subcommand its own method:

```typescript
@Controller()
export class SettingsController {
  // The builder is declared once, on the command itself.
  @Command('settings', SettingsCommandBuilder)
  async settings(interaction: ChatInputCommandInteraction) {
    await interaction.reply('Pick a subcommand.')
  }

  @Command('settings notify email', CommandType.SLASH)
  async notifyEmail(interaction: ChatInputCommandInteraction, { enabled }) {
    await interaction.reply(`Email notifications ${enabled ? 'on' : 'off'}`)
  }
}
```

Subcommand handlers take the plain `CommandType.SLASH` and no builder: the subcommand is already described by the parent's builder, and registering a second command for it would be rejected by Discord. Options are flattened, so `notifyEmail` receives `{ enabled }` rather than the wrapping subcommand.

The full path is always tried before the bare command name, whatever order the controllers were registered in, and a subcommand nobody claimed falls back to the command's own handler. A group is never dropped on the way down — `settings notify email` does not fall back to `settings email`, because another group could declare its own `email`.

---

## Autocomplete

Autocomplete is a separate interaction from the command it belongs to: Discord sends it while the user is still typing, it is answered with `respond()` rather than a reply, and the window closes after three seconds. `@Autocomplete` binds a handler to it.

```typescript
@Controller()
export class SearchController {
  constructor(private catalog: CatalogService) {}

  @Autocomplete('search', 'query')
  async completeQuery(interaction: AutocompleteInteraction) {
    const { value } = interaction.options.getFocused(true)
    const matches = this.catalog.find(value).slice(0, 25)

    await interaction.respond(matches.map(name => ({ name, value: name })))
  }
}
```

The option must be declared with `.setAutocomplete(true)` on the command builder — that is what makes Discord send the interaction.

Omit the option name to handle every option of a command and branch on `getFocused(true)` yourself. An option-specific handler always wins over a command-wide one, so the two can coexist. The first argument is the command path, so subcommands work the same way as they do for `@Command`:

```typescript
@Autocomplete('settings notify email', 'address')
async completeAddress(interaction: AutocompleteInteraction, { region }) { /* … */ }
```

The second argument holds the options already filled in, which is what lets one option's suggestions depend on another's value.

If no handler claims an option, MeoCord answers with an empty list and logs which command and option are missing one — a visibly empty menu rather than a client stuck loading.

---

## Message commands

`@MessageHandler` handles messages: every message, or those matching a pattern. A pattern uses the same `{name}` params as a component's customId, matched word by word:

```typescript
import { type Message } from 'discord.js'
import { Controller, MessageHandler } from 'meocord/decorator'

@Controller()
export class DiceController {
  // !roll 20 for initiative  ->  { sides: '20', note: 'for initiative' }
  @MessageHandler('roll {sides} {note...?}')
  async roll(message: Message, { sides, note }: { sides: string; note?: string }) {
    const result = 1 + Math.floor(Math.random() * Number(sides))
    await message.reply(note ? `${result} (${note})` : String(result))
  }

  // Runs for every message a user sends, after any pattern it matched
  @MessageHandler()
  async log(message: Message) {
    console.log(message.content)
  }
}
```

| In a pattern | Matches                                                                                             |
| ------------ | --------------------------------------------------------------------------------------------------- |
| `roll`       | The word `roll`, in any case unless `caseSensitive` is set                                          |
| `{name}`     | One word. Words in quotes, `"like this"` or `“like this”`, count as one, and the quotes are removed |
| `{name...}`  | The rest of the message, as typed. Only last                                                        |
| `{name?}`    | One word, or nothing. Only optional params follow it; `{name...?}` is the optional rest             |
| `{--name}`   | A flag, `--name`, anywhere after the command word; see [Flags and lists](#flags-and-lists)          |

A pattern without params, such as `'hello'`, matches exactly that message. The params arrive as the handler's second argument, so [`@Validate`](#validation-and-pipes), pipes and [`@Cooldown({ by })`](#counting-per-resource) work on them as they do on a component's, and stages read them with `getHandlerParams()`:

```typescript
@MessageHandler('roll {sides}')
@Validate(z.object({ sides: z.coerce.number().int().min(2).max(100) }))
async roll(message: Message, { sides }: { sides: number }) {}
```

A pattern that cannot be read — `{rest...}` before another word, a required word after an optional one, a name used twice, a type no one declared — and two handlers whose patterns match exactly the same messages stop the bot at startup, naming the handlers.

### Typed params

A param can name a type, `{name:type}`. Its word is read as that type before any guard runs, and the handler receives members and numbers rather than text. A member, user, role or channel reaches the guards as an `EntityRef`, and is fetched once they let the call through, as described below:

```typescript
import { type GuildMember, type Message } from 'discord.js'

// !pay @ana 25 for lunch    !pay 123456789012345678 25
@MessageHandler('pay {to:member} {amount:int} {note...?}')
async pay(message: Message, { to, amount, note }: { to: GuildMember; amount: number; note?: string }) {
  await message.reply(`Paid ${to.displayName} ${amount}${note ? ` ${note}` : ''}`)
}
```

| Type                                 | Gives                     | Accepts                                                     |
| ------------------------------------ | ------------------------- | ----------------------------------------------------------- |
| none, or `string`                    | `string`                  | A word, or "quoted words"                                   |
| `int`, `number`                      | `number`                  | `50`, `-3`; `number` also `2.5`                             |
| `bool`                               | `boolean`                 | `yes`, `no`, `true`, `false`, `on`, `off`                   |
| `duration`                           | `number`, in milliseconds | `90s`, `10m`, `2h30m`, `7d`, `1w`                           |
| `member`                             | `GuildMember`             | A mention or an ID, of a member of the message's server     |
| `user`                               | `User`                    | A mention or an ID                                          |
| `role`                               | `Role`                    | A mention, an ID or the role's name                         |
| `channel`                            | `GuildBasedChannel`       | A mention or an ID                                          |
| words, such as `on\|off`             | `'on' \| 'off'`           | One of the words, in any case unless `caseSensitive` is set |
| your own, from `messages: { types }` | what its `parse` returns  | What its `parse` accepts                                    |

The handler's params are checked against the pattern: a name the pattern does not have, a type its param's value does not fit, or an optional param declared as always there fails to compile. `ParamsOf<'pay {to:member} {amount:int}'>` from `meocord/interface` is the type the pattern gives. A param with no type is text, which `@Validate` or a pipe may turn into anything, so it is not checked; neither are params declared as `Record<string, string>`.

Several optional params may end a pattern. Each one that another follows takes a word only if the word fits its type, and is left out otherwise, so the word goes on to the next:

```typescript
// !ban @ana spamming      gives { target, reason: 'spamming' }
// !ban @ana 7d spamming   gives { target, duration: 604_800_000, reason: 'spamming' }
@MessageHandler('ban {target:member} {duration:duration?} {reason...?}')
async ban(message: Message, { target, duration, reason }: { target: GuildMember; duration?: number; reason?: string }) {}
```

Whether a word fits is read from the word alone: a number, a length of time, one of the words to choose from, or a mention or ID for a member, user, role or channel. So an optional param that another follows needs a built-in type or words to choose from; text, or an app's own type, would stop the bot at startup. The last optional takes any word, and a word of the wrong type there gets the usage reply.

Nothing is fetched from Discord for a caller the handler's guards refuse. Before the guards, the words are read without a request: numbers, choices, flags and the shape of each ID are checked, and a word of the wrong type gets the [usage reply](#usage-errors). The guards then see each member, user, role and channel as an `EntityRef`, typed by `ParamRefsOf`: its `id`, the entity itself as `cached` when discord.js already has it, and `resolve()` to fetch it, for a guard that must look at it:

```typescript
import { type Message } from 'discord.js'
import { Guard } from 'meocord/decorator'
import { type GuardInterface, type ParamRefsOf } from 'meocord/interface'

@Guard()
export class OutranksTargetGuard implements GuardInterface {
  async canActivate(message: Message, { target }: ParamRefsOf<'ban {target:member} {reason...?}'>) {
    // The cheap check first, so a caller without the permission costs no request
    if (!message.member?.permissions.has('BanMembers')) return false
    const member = target.cached ?? (await target.resolve())
    return !member || member.roles.highest.position < message.member.roles.highest.position
  }
}
```

Once the guards let the call through, whatever the cache lacks is fetched, and the handler, `@Validate`, pipes and `@Cooldown({ by })` get the entities themselves. Each ID is fetched once however many messages and guards ask for it at the same time; members go 100 to a gateway request, channels together, and users wait their turn in discord.js's single queue for user lookups. A member that is not in the server is answered only to a caller the guards let through. Before anything is fetched, the handler's cooldowns without `by` are checked, so a caller on cooldown costs no request either, and is refused with the same `CooldownError`; a cooldown with `by` keys on the fetched, validated params, so it is checked when it is counted, after the fetch. Much is never fetched at all: a mentioned member arrives with the message, and roles and a server's channels are cached with the `Guilds` intent. Nothing is read before the message's route is chosen, so chat costs nothing.

An app adds its own types in `@MeoCord({ messages: { types } })`, and declares what each gives in `MessageParamTypes`, so handlers using it are typed:

```typescript
import { type MessageParamType } from 'meocord/interface'

const color: MessageParamType<number> = {
  label: 'hex colour',
  parse: word => (/^#[0-9a-f]{6}$/i.test(word) ? parseInt(word.slice(1), 16) : undefined),
}

// @MeoCord({ messages: { prefix: '!', types: { color } } }), and in a .d.ts of the app:
declare module 'meocord/interface' {
  interface MessageParamTypes {
    color: number
  }
}
```

### Flags and lists

A flag, `{--name}`, may be given anywhere after the command's first word, apart from the words the pattern matches. One before it, as in `!--bots purge 5`, is not read, and the message names no command, whatever other handlers the bot has. A pattern that begins with a param has no command word, so its flags may come anywhere, as in `!--ping ana` for `{target} {--ping}`. Without a type it is `true` when given and `false` when not; with one, `{--name:type}`, it takes a value, `--name=value`, and is required unless it ends in `?`. A typed rest, `{name:type...}`, is a list: each word, or "quoted words", becomes a value of the type.

```typescript
import { type GuildMember, type Message, type User } from 'discord.js'

// !purge 50 --bots    !purge --from=@ana 20
@MessageHandler('purge {count:int} {--bots} {--from:user?}')
async purge(message: Message, { count, bots, from }: { count: number; bots: boolean; from?: User }) {}

// !poll "Lunch today?" pizza "fried rice" soup
@MessageHandler('poll {question} {options:string...}')
async poll(message: Message, { question, options }: { question: string; options: string[] }) {}

// !kick @ana @ben 123456789012345678
@MessageHandler('kick {targets:member...}')
async kick(message: Message, { targets }: { targets: GuildMember[] }) {}
```

- A value with spaces goes in quotes, `--note="buy milk"`. A flag given twice takes its last value, and `--bots=no` gives `false`.
- A flag the command does not have, a typed flag left out or given no value, and an item that is not a value of its type each get the [usage reply](#usage-errors): `--all is not an option of this command`.
- Words in quotes are never flags, so `"--bots"` stays text. Only a message naming a command with flags is read for them, so a pattern with no flags reads `--bots` as an ordinary word and costs nothing more, and a rest takes the message's text without its flags, keeping its own spacing and line breaks.
- The members a list, its params and its flags name are fetched together, in one request, as [typed params](#typed-params) are. `{name...}` with no type stays the rest of the message as text.

### Usage errors

A message that names a command, after a prefix or mention, but does not fit its pattern gets the command's usage in reply, and the handler does not run:

```
!pay @ana lots       ->  Usage: !pay <to> <amount> [note…]
                         amount: "lots" is not a valid whole number
!pay @ana            ->  Usage: !pay <to> <amount> [note…]
                         amount is missing
```

The reply is deleted after 10 seconds; `@MeoCord({ messages: { deleteUsageRepliesAfter } })` sets another number of seconds, and `0` keeps it. A reply the bot cannot send or delete, for a missing permission or a message already gone, is logged and left. A command with a `member`, `role` or `channel` param, sent in a DM, is answered that it works in a server only. A command that a guard denies with a reason, `throw new GuardDeniedError('Only moderators can do that.')`, or that `@Validate` refuses is answered the same way: a reply with the reason, deleted after the same time, and logged at debug level, not as an error. A guard on a listener, an unpatterned `@MessageHandler()` or an `@On` handler, only filters what it takes, so its denial gets no reply and is logged at debug level. `@MeoCord({ messages: { replyEmoji: true } })` begins these replies with the theme's warning emoji; see [Replies to messages](#replies-to-messages).

The error is a `MessageUsageError` from `meocord/common`, carrying `usage` and `issues`, and goes through the handler's [exception filters](#exception-filters) first, so a filter can answer it in the app's own words or language. A message with no prefix or mention is never taken for a command: in an app without a prefix, `pay @ana lots` is chat that happens to begin with a command's word, and gets no reply.

A message that names only a command's leading words, such as `!config` when `config set …` and `config get …` exist, or an unknown subcommand, `!config reset`, gets the usage of each subcommand it could reach, sorted, one line per handler, by its own pattern rather than its aliases:

```
!config              ->  Usage:
                         !config get <key>
                         !config set <key> <value…>
```

A handler of its own, `config` or `config {key}`, still takes such a message. The listing runs no guards, so a subcommand with a guard, on its method or its controller, is left out of it on purpose: it would name what a caller may be refused. It still answers its own usage when named. A parent with no subcommand left to list gets no reply. App-wide guards from `@MeoCord({ guards })` do not filter the listing, as they do not filter a usage reply. The listing is a `MessageUsageError` whose `usage` holds its lines, and it goes to the app's global filters, then the fallback.

### Aliases, descriptions and scope

A handler's options say more about its command:

```typescript
@MessageHandler('mute {target:member} {duration:duration?} {reason...?}', {
  aliases: ['m', 'shush'],
  description: 'Times a member out, for 10 minutes unless told otherwise.',
  scope: 'guild',
})
async mute(message: Message, { target, duration, reason }: { target: GuildMember; duration?: number; reason?: string }) {
  await target.timeout(duration ?? 600_000, reason)
}
```

- `aliases` are other words for the command, each in place of the words the pattern begins with: `!m @ana 1h` runs `mute`. An alias can be several words, such as `'cfg set'` for `config set {key} {value...}`, is ranked by its own words, and answers a misuse with the usage as the user typed it. An alias another command already matches stops the bot at startup, as two patterns would.
- `description` is what the command does, for a help listing.
- `scope` is where the command works: `'guild'`, `'dm'` or `'any'`, the default. A handler whose scope fits where the message was sent runs before one whose scope does not, so `help` can have a server handler and a DM handler; a message that only an out-of-scope handler matches is answered that the command works in a server only, or in direct messages only, before any other usage issue. A command with a `member`, `role` or `channel` param works in servers only whatever its scope says, and `scope: 'dm'` with one stops the bot at startup.

### A help command

MeoCord does not reply to `!help` itself, since help is where bots differ most: embeds, pages, categories. [`HandlerRegistry`](#handler-discovery) gives what one needs. Each message command is listed once, with its `command` words, `aliases`, `description`, `scope`, `usage(prefix)` and `matches(words)`:

```typescript
import { HandlerRegistry } from 'meocord/core'

@Controller()
export class HelpMessageController {
  constructor(private readonly handlers: HandlerRegistry) {}

  // !help lists the commands; !help mute, or !help m, shows one
  @MessageHandler('help {command...?}', { description: 'Lists the commands, or shows one.' })
  async help(message: Message, { command }: { command?: string }) {
    const commands = this.handlers.list({ kind: 'message' }).filter(entry => entry.command)
    const one = command ? commands.find(entry => entry.matches(command)) : undefined
    if (command && !one) {
      await message.reply(`No command is called ${command}.`)
      return
    }
    const lines = one
      ? [one.usage('!'), one.description, one.aliases.length ? `Also: ${one.aliases.join(', ')}` : undefined]
      : commands.map(entry => `\`${entry.usage('!')}\` ${entry.description ?? ''}`)
    await message.reply(lines.filter(Boolean).join('\n'))
  }
}
```

`usage('!')` gives `!mute <target> [duration] [reason…]`, the text a usage error shows. `matches` compares in any case unless the handler or the app is case-sensitive.

### Prefixes

Set the prefix once, for the whole app, in `@MeoCord({ messages })`:

```typescript
@MeoCord({
  controllers: [DiceController],
  clientOptions: {
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  },
  messages: { prefix: '!', mention: true },
})
class App {}
```

- `prefix` is a string, a list such as `['!', '?']`, or a function of the message returning either, which may be async — a server's own prefix, say. Without one, a pattern matches the message as it is. The longest prefix that fits is used, and a space after it is allowed: `! roll 20` works too.
- `mention: true` also accepts a mention of the bot, `@Bot roll 20`, in place of the prefix. `mention: 'only'` accepts nothing else in a server: there, a command starts with a mention of the bot, never with a prefix or as plain text. A direct message, addressed to the bot already, starts as usual, after the prefix, or as it is without one, so `{ prefix: '!', mention: 'only' }` answers `@Bot help` in a server and `!help` in a DM.
- `caseSensitive: true` matches the prefix and a pattern's literal words in the case written. It is off by default. Param values always keep the case they were typed in.

A handler can set its own `prefix` and `caseSensitive`. Its prefix replaces the app's; a mention still counts. `prefix: false` matches the message as it is, and `mention: 'only'` starts that one command in a server with a mention alone, whatever the app's prefix, and in a DM as usual:

```typescript
@MessageHandler('ping', { prefix: ['?', '??'] })   // ?ping, ??ping, @Bot ping
@MessageHandler('good morning', { prefix: false }) // good morning, as typed
@MessageHandler('status', { mention: 'only' })     // @Bot status in a server; also !status in a DM
```

Reading what a message says needs the privileged `MessageContent` intent, except where Discord sends the text without it: in messages that mention the bot, and in direct messages. So a command a mention alone starts in a server, or one with `scope: 'dm'`, needs no `MessageContent`, and a bot whose commands are all like that, with `messages: { mention: 'only' }`, runs without the intent and without applying for it once verified. MeoCord warns at startup only for the handlers that need it: a `@MessageHandler()` listener, and a command a prefix or plain text starts in a server.

### Which handler runs

Only one patterned handler runs for a message, the most specific that matches, across every controller:

1. More literal words win: `roll 20` beats `roll {sides}`, which beats `{anything...}`.
2. Then a fixed number of words beats a rest: `roll {a} {b}` beats `roll {rest...}`.
3. Then a pattern without an optional param beats one with it, and fewer params beat more.
4. Patterns still equal go to the one whose first differing word is literal: `roll {x}` beats `{verb} 6`.

The table is built once at startup, so declaration order and file layout never decide it. Then every `@MessageHandler()` listener runs. Messages from bots, and empty messages, reach no handler. A prefix function that throws goes to the global [exception filters](#exception-filters), then the fallback, and the listeners still run.

To check routing in a test, `resolveRoute(App, { content: '!roll 20' })` returns the handler a message reaches, and `invoke(DiceController, 'roll', createMockMessage({ content: '!roll 20' }))` runs it with the params its pattern captures — see [Testing](#testing).

---

## Reactions

`@ReactionHandler(emoji)` runs when that emoji is added to or removed from a message, and `@ReactionHandler()` for every emoji. A standard emoji is its character, `'👍'`. A custom emoji is its id, `'1234567890123456789'`, the `<:party:1234567890123456789>` Discord shows when you send `\:party:`, or its name, `'party'`: an id matches that one emoji, while a name matches every custom emoji of that name, one from each server the bot is in. The second argument says who reacted, and whether the reaction was added or removed:

```typescript
import { type MessageReaction } from 'discord.js'
import { Controller, ReactionHandler } from 'meocord/decorator'
import { ReactionHandlerAction } from 'meocord/enum'
import { type ReactionHandlerOptions } from 'meocord/interface'

@Controller()
export class StarboardController {
  @ReactionHandler('⭐')
  async star(reaction: MessageReaction, { user, action }: ReactionHandlerOptions) {
    if (action === ReactionHandlerAction.ADD) await reaction.message.reply(`${user.username} starred this.`)
  }
}
```

Reactions from bots, the bot's own included, reach no handler, as messages from bots do: a bot that seeds a poll with its own reactions does not count them as votes, and never answers itself. A handler that wants them sets `bots: true`, as `@ReactionHandler('📌', { bots: true })`, or `@ReactionHandler({ bots: true })` for every emoji. A user discord.js holds only in part is fetched to tell, and skipped if that fails.

Every handler that matches runs: in each controller, those for the emoji before those for every emoji. Before they run, the reacted-to message is fetched, so `reaction.message` is complete even for a message sent before the bot started; a reaction on a message the bot can no longer read is skipped. Reactions need the `GuildMessageReactions` intent (or `DirectMessageReactions`), and the `Message` and `Reaction` partials for older messages.

---

## Interaction responses

`respond(interaction)` from `meocord/common` is the one place an interaction is answered. It remembers where the answer stands and picks the right Discord call each time, so a handler says what to send, not how:

```typescript
import { respond } from 'meocord/common'

@Command('profile', CommandType.SLASH)
async profile(interaction: ChatInputCommandInteraction) {
  await respond(interaction).acknowledge() // "thinking…" while the profile loads
  const card = await this.profiles.render(interaction.user.id)
  await respond(interaction).send({ embeds: [card] })
}
```

| Call                                    | What it does                                                                                                                                                                                                                                                                           |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `acknowledge({ ephemeral })`            | A deferred reply for a command; an invisible deferred update for a component or a modal from a message. Once only, however often it is called.                                                                                                                                         |
| `send(payload, options?)`               | Replies to an unanswered command, updates an unanswered component's message, and edits once the interaction is deferred or replied. A second `send()` edits again.                                                                                                                     |
| `edit(payload, options?)`               | Edits the answer, as `send()` does once answered.                                                                                                                                                                                                                                      |
| `followUp(payload, options?)`           | Another message after the answer. While a command's reply is deferred and nothing is sent, Discord makes a follow-up that reply and ignores its flags, so it is sent as that edit — except a private follow-up on a public deferral, which deletes the deferral and is sent privately. |
| `delete()`                              | Deletes the answer.                                                                                                                                                                                                                                                                    |
| `modal(modal)`                          | Shows a modal. A modal must be the first response, so this throws once the interaction is acknowledged.                                                                                                                                                                                |
| `error(error, { message, visibility })` | Shows an error in the presenter's style, and never throws. `'reply'` may turn a public deferred reply into the error; `'private'` shows it only to the user who made the call.                                                                                                         |

`options` is `{ fill?: boolean }`: `fill: false` sends that message's embeds and containers without the theme's colour (see [What `respond()` themes](#what-respond-themes)).

`state` tells where the answer stands (`'unanswered'`, `'deferred'` or `'replied'`), re-read from the interaction on every call, so answers made directly with discord.js or by a collector still count. `message` is the message last sent or edited, `location` is what [`getInstallContext`](#where-the-interaction-happened) reports, and `original` holds the message's components and embeds from before `@Defer` locked it. `lock()` is `@Defer`'s second step, for a handler that acknowledges on its own. Interceptors and filters reach the same state as `context.response`.

A handler that finishes without answering its interaction leaves the user with "The application did not respond", and one that defers and never follows up leaves them watching it think until Discord gives up. In development (`NODE_ENV` is `development`, as under `meocord start --dev`), MeoCord warns once per handler that does either, naming it; a handler a guard denied, or that failed, is answered by the fallback and never named. `@MeoCord({ warnUnanswered })` turns the warning on or off regardless of the environment. [Observers](#observers) see the same thing at runtime, as `response` in what they are told.

Each call takes only the flags Discord accepts for it, computed afresh: an ephemeral follow-up never makes later messages ephemeral. `send()` and `followUp()` payloads are typed so an impossible flag does not compile. Make a message private with `flags: MessageFlags.Ephemeral`; discord.js's deprecated `ephemeral: true` is read as that flag, under the same rules. Once a message uses Components V2 its edits keep the flag, and content and embeds are dropped from them. When an edit re-sends an embed or Components V2 media whose image is one of the message's own Discord attachments, the URL is pointed at `attachment://` so the image survives the edit.

### `@Defer`

`@Defer()` acknowledges for the handler, in two steps, so a slow guard or handler never misses Discord's three seconds, and a stranger's click never touches someone else's message:

1. **Before guards**, a deferred reply for a command (`ephemeral: true` makes it private), or an invisible deferred update for a button, select menu or modal from a message.
2. **Once guards, validation and pipes allow the call**, for a component: its message's controls are disabled, the clicked button shows the loading emoji, and the presenter's loading view is added.

```typescript
@Command('refresh/{uid}', CommandType.BUTTON)
@UseGuard(OwnerGuard)
@Defer()
async refresh(interaction: ButtonInteraction, { uid }: { uid: string }) {
  await respond(interaction).send({ embeds: [await this.cards.render(uid)] }) // components come back as they were
}
```

`send()` without `components` puts the message's components back as they were before the lock — a button disabled on purpose stays disabled — and drops the loading view; `components: []` clears them. A handler that returns without answering has its message put back too, unless something else edited it meanwhile. When the handler throws, the error is shown privately and the message restored.

| Option                  | Default   | Effect                                                                                                                                                    |
| ----------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ephemeral`             | `false`   | A command's deferred reply is private.                                                                                                                    |
| `disable`               | `'all'`   | `'clicked'` disables only the control used, so others stay usable: each click puts back its own control, whichever finishes first; `'none'` skips step 2. |
| `mode`                  | `'eager'` | `'auto'` acknowledges only if nothing answered after `after` ms, so a fast handler answers with one reply or update.                                      |
| `after`                 | `1500`    | For `'auto'`; never later than 2.5 s after the interaction was created.                                                                                   |
| `suppressNotifications` | `false`   | New messages (a first reply after `'auto'` waited, and follow-ups) do not notify.                                                                         |

A guard that returns `false` under `@Defer` leaves nothing behind: a command's deferred reply is deleted, and a component's message was never touched. To tell the user why, throw `GuardDeniedError`; it is answered privately. Answer through `respond()`, not `interaction.reply()`, which fails after the acknowledgement. `@Defer` is for interaction handlers: on a message, reaction, event or autocomplete handler it throws. A handler that shows a modal cannot use it, since a modal must be the first response.

### Where the interaction happened

A user-installed app can be used in servers the bot is not in and in direct messages between users, where the bot cannot use the channel API. `respond()` always answers through the interaction's own methods, which work everywhere, and turns to the channel only when the interaction's fifteen-minute token has expired and the bot is present; a token error from 14 minutes on counts as expired, allowing for a clock running late. Only edits can take that path: after fifteen minutes, an error can be logged but not shown privately, so a public card is put back without a private error. `getInstallContext(interaction)` reports the same thing to your code:

```typescript
import { getInstallContext } from 'meocord/common'

const { where, botInstalled } = getInstallContext(interaction) // where: 'guild' | 'bot-dm' | 'private-channel'
```

### Presenters

A presenter decides how MeoCord's answers look — the error view, and the loading view `@Defer` shows — while filters and the fallback decide what they say. It returns `{ text, title?, color?, emoji?, components? }`, rendered as an embed, or as a Components V2 container on a Components V2 message. Register one with `@MeoCord({ presenter })`; it is resolved once from the container, so it can inject services such as a `Translator`.

```typescript
import { Translator } from 'meocord/common'
import { MeoCord, Service } from 'meocord/decorator'
import { type PresentedError, type ResponseContext, type ResponsePresenter } from 'meocord/interface'
import enUS from '@src/locales/en-US'

@Service()
export class BrandPresenter implements ResponsePresenter {
  constructor(private readonly t: Translator<typeof enUS>) {}

  loading({ interaction, theme }: ResponseContext) {
    return { text: this.t.for(interaction)('common.working'), emoji: theme.emojis.loading, color: theme.colors.primary }
  }

  error({ theme }: ResponseContext, { message, tone }: PresentedError) {
    return { title: 'Something went wrong', text: message, color: theme.colors[tone] }
  }
}

@MeoCord({ controllers: [...], clientOptions: { ... }, presenter: BrandPresenter })
class App {}
```

A presenter styles from the call's [theme](#theming), `context.theme`, the same one `useTheme()` returns. An error's `tone` says which colour suits it: `'warning'` for the user's own outcome, such as a cooldown, a refused guard or a `UserError`, and `'danger'` for a fault in the bot. A view with no `color` takes the theme's `primary`.

Without one, errors show "Oops!" as their title in the colour their tone names, and the loading view is "Working on it…" with the theme's loading emoji, ⏳ by default, in its primary colour.

---

## Theming

A theme holds the design tokens a bot's answers use, named by role rather than by value: the colour of an embed or a container's accent, the emoji beside a status, the style of a button. MeoCord gives each role a default, so a theme sets only what it changes, and a role keeps its meaning while its value changes: code asks for `danger`, not for red.

### Tokens

| Group     | Roles                                                        | A token is                                                                                         |
| --------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `colors`  | `primary`, `neutral`, `success`, `warning`, `danger`, `info` | a `ColorResolvable`: a hex string, a number, an `[r, g, b]` tuple or a discord.js colour name      |
| `emojis`  | `loading`, `success`, `warning`, `danger`, `info`            | a unicode emoji, or a custom one written `<:name:id>` or `<a:name:id>`                             |
| `buttons` | `primary`, `neutral`, `success`, `danger`                    | `ButtonStyle.Primary`, `Secondary`, `Success` or `Danger`; link and premium buttons have no colour |

`warning` is for what needs the user's attention, or was refused because of what they did; `danger` is a fault in the bot. The types are `ThemeColors`, `ThemeEmojis`, `ThemeButtons` and `MeoCordTheme` in `meocord/interface`. A theme as code reads it is `DeepReadonly<MeoCordTheme>`, with every role present and none assignable, since one theme is shared by every call. A theme as a scope sets it is `ThemeOverride`, any part of it and nothing unknown, and the root theme is `RootTheme`.

### Adding tokens of your own

Augment the interfaces from a file with an import: a role in one of MeoCord's groups goes in that group's interface, and a group of your own in `MeoCordTheme`.

```typescript
// src/types/theme.d.ts
import 'meocord/interface'

declare module 'meocord/interface' {
  interface ThemeColors {
    vip: ColorResolvable
  }
  interface MeoCordTheme {
    charts: { axis: ColorResolvable; series: ColorResolvable[] }
  }
}
```

- **The import is what makes it an augmentation.** A `declare module 'meocord/interface'` in a file without one replaces the module instead of extending it, and every other import from `meocord/interface` stops compiling.
- **A group is extended through its own interface.** Declaring `colors` again in `MeoCordTheme` fails with TS2717, since a property declared twice must keep one type.
- **Your tokens have no default,** so `RootTheme` requires every one of them, while MeoCord's roles stay optional, so the resolved theme always has them.
- **Some names are reserved.** MeoCord adds roles only from `ReservedThemeRole`: `accent`, `muted`, `subtle`, `secondary`, `tertiary`, `attention`, `severe`, `error`, `done`, `brand`, `link` and `premium`, in any group. An app that takes one gets a type error at its root theme naming each, `{ 'MeoCord reserves these theme roles; rename yours': 'colors.accent' }`, rather than a clash when MeoCord adds it. Any other name is yours, and MeoCord never takes it.
- **A theme kept in a variable** is not checked for unknown keys, as TypeScript checks only object literals; write it with `satisfies ThemeOverride` to have it checked.

### Defaults

| Role      | Colour    | Emoji | Button style            |
| --------- | --------- | ----- | ----------------------- |
| `primary` | `#7680F4` | —     | `ButtonStyle.Primary`   |
| `neutral` | `#888B95` | —     | `ButtonStyle.Secondary` |
| `success` | `#26A042` | ✅    | `ButtonStyle.Success`   |
| `warning` | `#B08400` | ⚠️    | —                       |
| `danger`  | `#E3606D` | ⛔    | `ButtonStyle.Danger`    |
| `info`    | `#1699AE` | ℹ️    | —                       |
| `loading` | —         | ⏳    | —                       |

The colours keep the hues of 4.0's `Theme`, with their lightness moved until each gives at least 3:1 against every surface an embed's stripe or a container's accent sits on in Discord's light, dark, darker and midnight themes, the contrast WCAG 2.1 asks of a graphic that carries meaning. A test holds every default to it, so a default that changes still passes on both light and dark.

### Valid tokens

- **A colour** is a 6-digit hex string such as `'#7680F4'` (with or without `#`), a whole number from `0` to `0xFFFFFF`, an `[r, g, b]` tuple of whole numbers from 0 to 255, or a discord.js colour name such as `'Blurple'`. A 3-digit hex string such as `'#FFF'` is not one.
- **An emoji** is one unicode emoji, including flags, keycaps, skin tones and joined sequences such as `'👨‍👩‍👧'`, or a custom one written `<:name:id>` or `<a:name:id>`. A shortcode such as `':smile:'` is not one; a custom emoji must also be one the bot may use, such as an emoji the application owns.
- **A button style** is `ButtonStyle.Primary`, `Secondary`, `Success` or `Danger`.
- **A role MeoCord reserves** is refused in any group, in JavaScript as in TypeScript.

Each problem is named with its key path and what to give instead, such as `theme.colors.primary: '#GGG' is not a colour: give a 6-digit hex string such as '#7680F4', …`. MeoCord's groups are checked whatever roles an app added to them; a group of the app's own is the app's to check.

A theme set in code is checked where it is declared: a bad token in `@MeoCord({ theme })` or `@UseTheme` stops the bot before it logs in, and the message names the decorator, as in `@UseTheme on ShopController.refund: theme.emojis.loading: …`.

### Setting the theme

The app's theme goes in `@MeoCord({ theme })`, and `@UseTheme` changes part of it for a controller's handlers or for one handler. Each layer sets only what it changes, over the one beneath it:

1. MeoCord's defaults;
2. `@MeoCord({ theme })`;
3. `@UseTheme` on each class, from the base class down to the class a handler is dispatched on;
4. `@UseTheme` on the handler's method.

```typescript
@MeoCord({ controllers: [ShopController], clientOptions: { intents: [] }, theme: { colors: { primary: '#5865F2' } } })
class App {}

@Controller()
@UseTheme({ colors: { primary: '#26A042' } })
export class ShopController {
  @Command('refund', CommandType.SLASH)
  @UseTheme({ colors: { primary: '#E3606D' }, emojis: { loading: '💸' } })
  async refund(interaction: ChatInputCommandInteraction) {}
}
```

A subclass inherits its base class's `@UseTheme`, and `@Controller({ inheritStages: false })` stops it as it stops guards. A class or method takes one `@UseTheme`. Plain objects merge key by key; anything else, such as an array of colours, replaces the value beneath it.

### Reading the theme

`useTheme()` from `meocord/common` returns the theme of the running call, with every role present:

```typescript
const { colors, emojis } = useTheme()
await respond(interaction).send({
  embeds: [{ description: `${emojis.success} Saved`, color: resolveColor(colors.success) }],
})
```

- **Anything the handler calls reads the same theme,** such as a service or a presenter, since the call's theme follows it through `AsyncLocalStorage`, as does a timer or a promise the call starts that outlives it. An interceptor, guard or filter reads it as `context.getTheme()`.
- **A component a route handles is themed with no extra code:** `@Command('ticket/close/{id}', CommandType.BUTTON)` runs in its own handler's theme, `@UseTheme` included, so routing a button to a handler is the way to theme it.
- **A collector's answers are themed with no extra code too:** `respond(click)` outside any call, as in a collector's `collect` callback, takes the theme of the app the interaction came to, with its server's and user's themes from [`themeFor`](#themes-per-server-and-per-user).
- **A listener the handler registers runs in its emitter's context,** such as a collector's `collect` callback or a `client.on(...)` handler, as any `AsyncLocalStorage` value does, so the handler's own `@UseTheme` does not reach it. To read the handler's theme there, with `useTheme()` or in what `respond()` fills, wrap the callback in `bindTheme` from `meocord/common`:

  ```typescript
  collector.on(
    'collect',
    bindTheme(async (click: ButtonInteraction) => {
      const { emojis } = useTheme() // the handler's theme
      await respond(click).send(`${emojis.success} Picked`)
    }),
  )
  ```

- **A controller method called directly** from another handler keeps the caller's theme: the theme belongs to the call answering the user.
- **Outside any call,** such as in a scheduled job, it is the theme of the app the bot runs, or MeoCord's defaults before an app has started. It never throws.
- **A theme is frozen,** since one theme is shared by every call it applies to. A colour is kept as written, so `useTheme().colors.primary` reads back what was set.
- **A bot that sets neither `@UseTheme` nor `themeFor` pays one check per call:** its handlers share the app's theme, which is built once at startup.

### What `respond()` themes

What a handler sends through `respond()` takes the theme's `primary` colour where it leaves one unset, so a bot is themed without setting a colour on every embed:

- **An embed with no `color`,** and **a Components V2 container with no `accent_color`,** get `colors.primary`. A colour that is set is kept, `0` and a `null` accent, which means none, included. An `EmbedBuilder` or `ContainerBuilder` is read, not changed.
- **MeoCord's own views,** the loading view and error answers, are styled by the [presenter](#presenters) from the call's theme; a view it gives no colour takes `colors.primary`. The clicked button's loading emoji is the view's emoji, the theme's `emojis.loading` by default.
- **`{ fill: false }`** as the second argument to `send()`, `edit()` or `followUp()` sends that one message's embeds and containers as written, still through `respond()`: `respond(interaction).send({ embeds: [card] }, { fill: false })`. The next message is filled again.
- **What is sent around `respond()`,** with `interaction.reply()` or `message.reply()`, is not touched either.
- A colour is resolved when the message is sent, so `'Random'`, a colour discord.js accepts, gives a new colour to each message while `useTheme()` still reads `'Random'`.

### Themes per server and per user

`@MeoCord({ themeFor })` looks a theme up by where a call comes from: `guild` for a server's, which goes over the handler's, and `user` for a user's, which goes over the server's, in a server or a DM. Each returns part of a theme as a plain object, or `undefined` or `null` for none, such as a missing row, at once or as a promise; a class instance, such as an ORM entity, is refused, so return `row.toObject()` or `{ ...row }`:

```typescript
@MeoCord({
  controllers: [ShopController],
  clientOptions: { intents: [] },
  themeFor: {
    guild: async ({ guild }) => (await db.guildTheme(guild.id)) ?? undefined,
    user: ({ user }) => premiumUsers.get(user.id),
  },
  themeCache: { ttlSeconds: 300, maxGuilds: 10_000, maxUsers: 50_000 },
  themeForTimeoutMs: 1_000,
})
class App {}
```

- **When it runs:** as a call starts, while `@Defer` acknowledges, and before the guards, so every stage and the handler read the whole theme. A call from a DM asks only `user`; a message's author and a reaction's user count as the call's user.
- **Cached:** each result is kept for `ttlSeconds` (300 unless set), up to `maxGuilds` servers (10,000) and `maxUsers` users (50,000), the oldest dropped first. Calls that ask at the same time share one lookup, and a server's and a user's are looked up together. To have a change show at once, inject `ThemeCache` from `meocord/common` and call `invalidateGuild(guildId)` or `invalidateUser(userId)`; without an id, each clears every result.
- **A result that is not a valid theme** is left out: calls from that server or user use the theme without it, and the bot warns once, naming the resolver, the id and each problem. It is kept as no theme until it expires or is cleared, so a bad row is not read again on every call.
- **A resolver that fails** by throwing, rejecting or passing `themeForTimeoutMs` (1,000 unless set) leaves its theme out of the call, and the call goes on. The bot logs a server or user whose lookup fails once, and again when it answers, and does not ask it again for 10 seconds; when more than one starts failing within 20 seconds, the second is logged as one line for the resolver and the rest are not logged, and their answers are logged the same way. A server or user that keeps failing is logged once, when it starts; one that fails again before it has answered two lookups in a row is logged once more as flapping, and then not until it has.
- **Keep the resolvers cheap,** and `user` especially: a lookup runs once per server or user until its result expires, and with a `user` resolver, every message a message handler or listener takes asks for its author's theme.

### Replies to messages

MeoCord answers a message in plain text: a command's [usage](#usage-errors), a guard's or validation's reason, and a `UserError`'s message, whether a command threw it or an `@On` listener of a message event. A theme leaves that text as it is, so a test that checks it keeps passing when the colours change. `@MeoCord({ messages: { replyEmoji: true } })` begins every one of these text replies to a message, `@On` listeners' included, with the call's `emojis.warning`, the app's or a handler's `@UseTheme`:

```text
⚠️ Usage: !roll <sides>
sides: "lots" is not a valid whole number
```

### Migrating from `Theme`

The static `Theme` class from `meocord/common` still works, and is deprecated. It goes in MeoCord 5.

| `Theme`              | Reads, and sets  | Instead                                                                     |
| -------------------- | ---------------- | --------------------------------------------------------------------------- |
| `Theme.primaryColor` | `colors.primary` | `useTheme().colors.primary`; `@MeoCord({ theme: { colors: { primary } } })` |
| `Theme.successColor` | `colors.success` | `useTheme().colors.success`                                                 |
| `Theme.infoColor`    | `colors.info`    | `useTheme().colors.info`                                                    |
| `Theme.errorColor`   | `colors.danger`  | `useTheme().colors.danger`                                                  |
| `Theme.warningColor` | `colors.warning` | `useTheme().colors.warning`                                                 |

- **Reading one reads the theme where it is read,** as `useTheme()` does, so a presenter or embed written against `Theme.primaryColor` follows `@MeoCord({ theme })` and `@UseTheme` with no change. Its values are the new defaults above; 4.0's were `#5865F2`, `#28A745`, `#17A2B8`, `#DC3545` and `#FFC107`, which `@MeoCord({ theme })` sets again if you want them.
- **Assigning one still recolours MeoCord's views,** as it did in 4.0, as a role beneath every theme your app sets, so `@MeoCord({ theme })` and `@UseTheme` win over it. The first assignment to each logs a warning naming the role to set instead. A value that is not a colour is reported and left unset, and never throws.

---

## How a handler runs

Every handler — a command, a component, an autocomplete, a message, a reaction or an [event](#gateway-events) — runs through the same stages, in this order:

1. **[`@Defer`](#defer), step 1** acknowledges the interaction, so slow stages never miss Discord's three seconds.
2. **Guards** decide whether the handler runs at all.
3. **Interceptors** wrap everything after them: they can act before and after, skip the handler, or replace its error.
4. **Validation** checks the handler's input against a schema, and **pipes** transform the valid values.
5. **Cooldowns** count the call, and block it once the handler has run too often.
6. **`@Defer`, step 2** locks the component's message and shows the loading view, now that the call will run.
7. **The handler** runs with what the stages produced.

**Exception filters** surround all of it: an error from any stage or the handler reaches them, and one no filter handles goes to the built-in fallback. The handler, its interceptors and filters, and the fallback all answer through [`respond()`](#interaction-responses), so each sees where the others left the answer.

**[Observers](#observers)** frame all of it: an observer's `onStart` is called as the call begins, before `@Defer` and the guards, and its `onSettled` once the call has settled and been answered, whatever the outcome, with how it ended and how long it took. The call waits for neither. They also hear about an interaction no handler matches and nothing else answers.

Validation and pipes apply to command, component and modal handlers, and to message handlers with a pattern, whose options, customId params, fields and pattern params they check. Cooldowns apply to those and to every message handler. An autocomplete handler, which must answer within three seconds, runs its guards and filters but no interceptors. `@Defer` applies to command, component and modal handlers only.

Guards, interceptors and filters apply at three levels, which run in this order: globally, from `@MeoCord({ guards, interceptors, filters })`; on a controller, for every handler it declares or inherits, and for every handler of a class that extends it; and on a method. Cooldowns apply on a controller or a method. A handler's class stages come from its controller first, then each class it extends in turn, so a base controller's `@UseGuard` guards every subclass; filters are tried, and cooldowns counted, the other way round, from the base out. `@Controller({ inheritStages: false })` on a subclass limits the handlers it declares to its own class and method stages; the handlers it inherits keep their base's. The chain is resolved once per handler, so dispatch pays nothing for it. A stage also sees what it is running for through `ExecutionContext`, whose `getType()` is `'interaction'`, `'autocomplete'`, `'message'`, `'reaction'` or `'event'`; a guard or interceptor declared with `types` runs only for those, and a subclass inherits them unless it declares its own. A `types` list that can match nothing — empty, or `['autocomplete']` on an interceptor, since interceptors skip autocomplete — throws when the class is decorated.

The stages run when MeoCord dispatches a handler, and when a test runs one with [`invoke`](#running-a-handler-with-invoke). A controller method called directly runs only its guards, the same chain dispatch runs.

---

## Guards

Guards run first, before anything else touches the handler. Each guard implements `canActivate` — return `true` to allow, `false` to block.

A new guard instance is created for every call, so keep state that must outlast one call — such as rate-limit counts — outside the guard: at module level, or in a service registered in `@MeoCord({ services })`, which makes it a singleton. A guard bound once — listed in services or providers, or injected into a service — is one instance shared by every call, and reads each call's own `params`, even while calls overlap. Work it starts inside `canActivate` that outlives the call, such as a timer, keeps reading that call's params. A sealed instance, or a param the class takes through a setter, cannot be kept per call: its params are set on the one instance, and the bot warns once.

A guard runs for every kind of handler it applies to — global guards from `@MeoCord({ guards })` included, which also run before [`@On` event handlers](#gateway-events). To limit one, declare the context types it runs for: `@Guard({ types: ['interaction'] })` skips messages, reactions and events.

```typescript
import { Guard } from 'meocord/decorator'
import { type GuardInterface } from 'meocord/interface'
import { type ChatInputCommandInteraction } from 'discord.js'
import { RedisService } from '@src/services/redis.service.js'

@Guard()
export class RateLimiterGuard implements GuardInterface {
  // RedisService is listed in @MeoCord({ services }), so every guard instance shares one client
  constructor(private readonly redis: RedisService) {}

  // limit and window are injected via @UseGuard params
  limit = 5
  window = 60_000

  async canActivate(interaction: ChatInputCommandInteraction): Promise<boolean> {
    const key = `ratelimit:${interaction.user.id}`
    const count = await this.redis.increment(key, this.window)
    return count <= this.limit
  }
}
```

Apply to a single method or an entire controller:

```typescript
// Per-method, with params
@Command('search', CommandType.SLASH)
@UseGuard({ provide: RateLimiterGuard, params: { limit: 5, window: 60_000 } })
async search(interaction: ChatInputCommandInteraction) { ... }

// Per-class (applies to every handler in the controller)
@Controller()
@UseGuard(MetricsGuard, DefaultGuard)
export class ProfileController { ... }
```

The rate limiter shows how a guard takes options. To limit how often a handler runs, [`@Cooldown`](#cooldowns) does it without a guard of your own, and answers the caller with how long to wait.

A class-level `@UseGuard` guards every handler of the controller, those it inherits included, and every handler of a class that extends it. For a subclass, its own class guards run first, then each base class's, then the method's:

```typescript
@Controller()
@UseGuard(StaffGuard)
export abstract class StaffController {}

@Controller()
export class BanController extends StaffController { ... } // Every handler here runs StaffGuard first
```

A subclass that should not take its bases' class stages for the handlers it declares sets `@Controller({ inheritStages: false })`; the handlers it inherits keep them.

To guard every handler in the bot, list guards in `@MeoCord({ guards })`. They take the same forms as `@UseGuard` and run first, before the controller's and the method's guards:

```typescript
@MeoCord({
  controllers: [ProfileController, ModerationController],
  clientOptions: { intents: [GatewayIntentBits.Guilds] },
  guards: [BlocklistGuard, { provide: RateLimiterGuard, params: { limit: 20, window: 60_000 } }],
})
class App {}
```

Global guards run when a handler is dispatched, or run with [`invoke`](#running-a-handler-with-invoke). A controller method called directly runs its class and method guards, its bases' class guards included, in the order dispatch runs them.

### Passing options to a guard

Use params when a value configures one use of a guard, such as a limit or the channels a command is allowed in. `@UseGuard({ provide, params })` sets them on the guard instance before `canActivate` runs, whole as `this.params` and each as a property of its own, and a decorator of your own can wrap it. A guard that declares its params with `declare readonly params?: { … }` has every `{ provide, params }` for it checked against that type, so a misspelt or mistyped param fails to compile, in `@UseGuard` and in `@MeoCord({ guards })` alike; a guard that declares none takes any. For facts about the handler itself that any guard can read, use [metadata](#reading-handler-metadata) instead. `params` is optional, so `{ provide: ChannelGuard }` works as the class alone. The same entry forms apply to interceptors, filters and pipes, and an entry that is neither a class nor `{ provide: Class, params? }` is refused when its decorator applies.

```typescript
import { Guard, UseGuard } from 'meocord/decorator'
import { type GuardInterface } from 'meocord/interface'
import { type ChatInputCommandInteraction } from 'discord.js'

@Guard()
export class ChannelGuard implements GuardInterface {
  // Set per use with @UseGuard({ provide: ChannelGuard, params: { channelIds } }), and checked against this
  declare readonly params?: { channelIds: string[] }

  canActivate(interaction: ChatInputCommandInteraction): boolean {
    const channelIds = this.params?.channelIds ?? []
    return channelIds.length === 0 || channelIds.includes(interaction.channelId)
  }
}

export const OnlyInChannels = (...channelIds: string[]) => UseGuard({ provide: ChannelGuard, params: { channelIds } })
```

```typescript
@Command('trade', CommandType.SLASH)
@OnlyInChannels('123456789012345678')
async trade(interaction: ChatInputCommandInteraction) { ... }
```

### Reading handler metadata

`createMetadata` makes a typed decorator for handler metadata. Put it on a controller, a handler, or both; a guard reads it through `ExecutionContext`, which describes the handler being guarded. The handler's value wins over the controller's.

```typescript
import { type ChatInputCommandInteraction } from 'discord.js'
import { applyDecorators, createMetadata, ExecutionContext } from 'meocord/common'
import { Command, Guard, UseGuard } from 'meocord/decorator'
import { CommandType } from 'meocord/enum'
import { type GuardInterface } from 'meocord/interface'

// Define the metadata decorator
export const Roles = createMetadata<string[]>('roles')

// Read it inside a guard
@Guard()
export class RolesGuard implements GuardInterface {
  constructor(private readonly context: ExecutionContext) {}

  canActivate(interaction: ChatInputCommandInteraction): boolean {
    const required = this.context.get(Roles) ?? []
    if (!required.length) return true
    return interaction.inCachedGuild() && required.some(role => interaction.member.roles.cache.has(role))
  }
}

// Compose into a single decorator
export const RequireRoles = (...roles: string[]) => applyDecorators(Roles(roles), UseGuard(RolesGuard))

// Apply
@Command('ban', CommandType.SLASH)
@RequireRoles('admin', 'moderator')
async ban(interaction: ChatInputCommandInteraction) { ... }
```

Use params for configuring one guard (`{ provide, params }`, [above](#passing-options-to-a-guard)), and `createMetadata` for facts about a handler that any guard can read. `ExecutionContext` is injected only into guards: each call gets its own, so a controller or service, which is shared across calls, cannot inject it. The context also gives the handler's arguments (`getArgs()`, `getInteraction()`, `getMessage()`, `getReaction()`), what it is handling (`getType()`), the controller and method (`getController()`, `getHandlerName()`), and the guard's own params (`getParams()`). Values declared with `SetMetadata` are read with their key: `this.context.get<string[]>('roles')`.

`getHandlerParams<P>()` is the handler's params, its second argument: a command's options, a component's customId params, a modal's fields or a select menu's choices. It is not `getParams()`, which is the running stage's own `{ provide, params }` configuration. The value is read as it stands when a stage asks:

- A guard sees the params raw; for a [typed message param](#typed-params), a member, user, role or channel as an `EntityRef`, since nothing is fetched from Discord before the guards.
- An interceptor sees them raw before `next.handle()`, with a message's entities fetched, and validated and piped after it, as the handler received them.
- A filter sees them as they were when the error was thrown.

`getArgs()` follows the same stages, so its second argument is always the value `getHandlerParams()` returns. It is `undefined` for message listeners, reaction and event handlers, which take no params, and for a call no handler was reached for. In a unit test, `createExecutionContext(Controller, 'method', { handlerParams })` sets it.

In a unit test, build the context with `createExecutionContext` from `meocord/testing`:

```typescript
const interaction = createMockInteraction(ChatInputCommandInteraction)
const guard = new RolesGuard(createExecutionContext(ModerationController, 'ban', { args: [interaction] }))
expect(guard.canActivate(interaction)).toBe(false)
```

To test the guard together with the handler it protects, run the handler with [`invoke`](#running-a-handler-with-invoke).

### Guards on autocomplete, and denying with a reason

Class-level and global guards also run before `@Autocomplete` handlers. There the guard receives an `AutocompleteInteraction`, which has no `reply()`, and `ExecutionContext.getType()` is `'autocomplete'`. A guard must not try to answer it: return `false` to deny, and MeoCord closes the menu with an empty list.

Returning `false` denies silently. To tell the user why, throw `GuardDeniedError` from `meocord/common` with the message to show: it is answered only to the user who made the call, and an [exception filter](#exception-filters) can catch it to answer differently.

```typescript
canActivate(interaction: ButtonInteraction, { ownerId }: { ownerId: string }): boolean {
  if (interaction.user.id !== ownerId) throw new GuardDeniedError('Only the owner can use this.')
  return true
}
```

---

## Interceptors

Interceptors run around a handler once its guards allow the call: timing, logging, caching, mapping errors. An interceptor receives the call's `ExecutionContext` and continues with `next.handle()`, which resolves to what the handler returns. It can act before and after the handler, skip it by returning without calling `next.handle()`, or catch the error the handler throws and throw another. Call `next.handle()` at most once: each call runs the handler again.

```typescript
import { Controller, Interceptor, UseInterceptor } from 'meocord/decorator'
import { type CallHandler, type InterceptorInterface } from 'meocord/interface'
import { type ExecutionContext, Logger } from 'meocord/common'

@Interceptor()
export class TimingInterceptor implements InterceptorInterface {
  private readonly logger = new Logger(TimingInterceptor.name)

  async intercept(context: ExecutionContext, next: CallHandler): Promise<unknown> {
    const started = performance.now()
    try {
      return await next.handle()
    } finally {
      this.logger.log(`${context.getHandlerName()} took ${Math.round(performance.now() - started)} ms`)
    }
  }
}

@Controller()
@UseInterceptor(TimingInterceptor) // every handler in the controller; or on one method
export class ProfileController { ... }
```

Apply them like guards: on a method, on a controller, or to every handler with `@MeoCord({ interceptors })`. Global interceptors are outermost, then the controller's, then the method's; within one decorator, the first listed is outermost. A class-level `@UseInterceptor` also covers the handlers a controller inherits, and those of a class that extends it, the subclass's outermost.

One instance of an interceptor serves every call, so it can hold a cache or counters; keep per-call state in local variables. For per-use options, pass `{ provide, params }` and read them with `context.getParams()` — they are never assigned onto the shared instance. Declare them with `declare readonly params?: { … }` to have every `{ provide, params }` checked, and read them typed with `context.getParams<StageParams<typeof MyInterceptor>>()`, `StageParams` coming from `meocord/interface`; filters and pipes declare theirs the same way. The call's own input is `context.getHandlerParams()`, validated and piped once `next.handle()` has run. For the same reason an interceptor cannot inject `ExecutionContext`; the bot refuses to start if one does.

Interceptors run when a handler is dispatched, or run with [`invoke`](#running-a-handler-with-invoke) in a test. A controller method called directly runs its guards but no interceptors. Autocomplete handlers run none.

Global interceptors also run around [`@On` event handlers](#gateway-events). Like a guard, an interceptor can be limited to some context types: `@Interceptor({ types: ['interaction', 'message'] })`.

Generate one with `npx meocord g i <name>`.

---

## Exception filters

An exception filter handles errors a handler, its interceptors or its guards throw, and decides what the user is told. `@Catch` names the error types it handles, matched with `instanceof`; with no types it handles everything.

```typescript
import { Catch, Controller, UseFilter } from 'meocord/decorator'
import { type ExceptionFilter } from 'meocord/interface'
import { type ExecutionContext } from 'meocord/common'
import { MessageFlags } from 'discord.js'

export class RateLimitedError extends Error {
  constructor(readonly retryAfter: number) {
    super(`Rate limited for ${retryAfter}s`)
  }
}

@Catch(RateLimitedError)
export class RateLimitedFilter implements ExceptionFilter<RateLimitedError> {
  async catch(error: RateLimitedError, context: ExecutionContext) {
    const interaction = context.getInteraction()
    if (!interaction?.isRepliable()) return
    const answer = { content: `Slow down: try again in ${error.retryAfter}s.`, flags: MessageFlags.Ephemeral } as const
    if (interaction.replied || interaction.deferred) await interaction.followUp(answer)
    else await interaction.reply(answer)
  }
}

@Controller()
@UseFilter(RateLimitedFilter) // every handler in the controller; or on one method
export class ProfileController { ... }
```

Apply filters with `@UseFilter` on a method or a controller, or to every handler with `@MeoCord({ filters })`. The filter closest to the handler wins: the method's filters are tried first, then the controller's, then global ones; within one level, the first whose `@Catch` matches, in the order listed. Among classes, a base class's filters come before its subclass's, for inherited handlers and a subclass's own alike. A filter that throws is logged, and the built-in fallback answers the original error.

Errors outside any handler reach global filters too. An interaction no handler matches raises `CommandNotFoundError` from `meocord/common`; there, `context.getController()` and `getHandler()` are `undefined`.

One instance of a filter serves every call, as with interceptors, so it cannot inject `ExecutionContext`, and `{ provide, params }` is read with `context.getParams()`.

### The built-in fallback

An error no filter handles goes to the built-in fallback. It logs the error, then answers through [`respond(interaction).error()`](#interaction-responses) if the interaction can still take an answer, privately and in the error style of the app's [presenter](#presenters):

| The interaction                                                              | The fallback                                            |
| ---------------------------------------------------------------------------- | ------------------------------------------------------- |
| Not answered yet                                                             | replies                                                 |
| A command, or a modal not submitted from a message, whose reply was deferred | edits the deferred reply into the error                 |
| The same, already replied to                                                 | follows up                                              |
| A button, select menu or modal from a public message, deferred or answered   | follows up; it never edits the message the user clicked |
| The same, from a private (ephemeral) message                                 | adds the error to that message                          |
| Autocomplete                                                                 | closes the menu with an empty list                      |
| Expired (Discord error 10062)                                                | logs only                                               |

It says "An error occurred while executing the command.", "Command not found!" for `CommandNotFoundError`, a `GuardDeniedError`'s or [`UserError`](#user-errors)'s own message, a `CooldownError`'s wait time, and a `ValidationError`'s list of issues — the last four kept private even on a deferred public command, by deleting the deferred reply and following up. Errors from message, reaction and event handlers are only logged, and the next handler still runs, except that a message gets a `UserError`'s message as a reply; a message blocked by a cooldown is ignored without an error log. The fallback never throws.

Filters apply when a handler is dispatched, or run with [`invoke`](#running-a-handler-with-invoke); a controller method called directly throws as it would without them. Under `invoke` the fallback does not run: an error no filter handles rejects, so tests see it.

Generate a filter with `npx meocord g f <name>`.

### User errors

Throw `UserError` from `meocord/common` for a mistake the user can fix, rather than a fault in the bot: too few coins, an account that does not exist, a date in the past. It works from a handler, a pipe, a service or a guard.

```typescript
import { UserError } from 'meocord/common'

if (balance < price) {
  throw new UserError(`You need ${price - balance} more coins.`, {
    code: 'shop.poor',
    context: { missing: price - balance },
  })
}
```

| Where it is thrown                                      | What the user sees                                                                |
| ------------------------------------------------------- | --------------------------------------------------------------------------------- |
| An interaction handler                                  | Its message, privately, in the presenter's error style, even after `@Defer`       |
| A message handler                                       | Its message as a reply to their message, without pinging them                     |
| An event with a message, such as `@On('messageCreate')` | Its message as a reply to the event's message, the edited one for `messageUpdate` |
| A reaction or another event                             | Nothing; there is no one to answer                                                |

It is logged only at debug level, since nothing in the bot failed, and [observers](#observers) see the outcome `'refused'`, apart from `'error'`, so a dashboard can tell the user's mistakes from the bot's faults. `respond(interaction).error(userError)` shows its message privately too. Where `GuardDeniedError` says a guard turned the call away, `UserError` says the call itself could not go ahead.

`code` names the error, and `context` holds the values its message is built from, both for a filter or a presenter to read. To answer in the user's language, translate by `code` in the [presenter](#presenters), which receives the error and the interaction:

```typescript
@Service()
export class AppPresenter implements ResponsePresenter {
  constructor(private readonly t: Translator<typeof en>) {}

  error({ interaction, theme }: ResponseContext, { message, error, tone }: PresentedError): ResponseView {
    const text =
      error instanceof UserError && error.code === 'shop.poor'
        ? this.t.for(interaction)('shop.poor', { missing: Number(error.context?.missing) })
        : message
    return { title: 'Oops!', text, color: theme.colors[tone] }
  }
  // ...
}
```

An exception filter with `@Catch(UserError)` can answer otherwise altogether, such as in a message's channel.

---

## Validation and Pipes

`@Validate` checks a handler's input before it runs, so the handler receives typed, valid values or does not run at all. It takes a schema from any library that implements [Standard Schema](https://standardschema.dev) — zod, valibot, arktype and others — so MeoCord bundles no validator and you keep the one you know.

```typescript
import { z } from 'zod'
import { Command, Validate } from 'meocord/decorator'

@Command('remind', CommandType.SLASH)
@Validate(z.object({ minutes: z.number().int().min(1).max(1440), note: z.string().max(200).default('') }))
async remind(interaction: ChatInputCommandInteraction, { minutes, note }: { minutes: number; note: string }) {}
```

The input is one object: a chat command's options, a component's customId params together with a modal's fields or a select menu's choices, or a [message pattern's](#message-commands) params — what the handler's second argument holds anyway. The handler receives the schema's output, so defaults and coercions apply, and its second parameter is type-checked against it: `{ minutes: string }` above fails to compile.

Invalid input stops the call with a `ValidationError` (from `meocord/common`) whose `issues` list each problem and where it is. The user gets a private reply with them. Schema libraries write their messages in English; an exception filter that maps issues to your own words is the place to localise them.

Validation runs after guards and inside interceptors, so a timing or logging interceptor sees a failure as the handler's error. It applies to command, component and modal handlers, and to message handlers with a pattern; the bot refuses to start with `@Validate` or `@UsePipe` on a message handler without one, or on a reaction, autocomplete or event handler. A handler takes one `@Validate`; a second throws, so combine the schemas into one.

### Pipes

A pipe turns one validated value into what the handler works with — an id into an account, say. Give pipes to `@Validate`, and the handler's parameter is typed with what they produce:

```typescript
@Pipe()
export class AccountPipe implements PipeInterface<string, Account> {
  constructor(private readonly accounts: AccountService) {}

  async transform(uid: string): Promise<Account> {
    return this.accounts.find(uid)
  }
}

@Command('profile/{uid}', CommandType.BUTTON)
@Validate(z.object({ uid: z.string().regex(/^\d{9,10}$/) }), { pipes: { uid: AccountPipe } })
async profile(interaction: ButtonInteraction, { uid }: { uid: Account }) {}
```

`pipes` maps a key to one pipe or to several, applied in order. `@UsePipe(key, ...pipes)` does the same as a decorator of its own, with or without `@Validate`, after `@Validate`'s pipes. `@Validate` cannot see a separate `@UsePipe`, so mark the value that pipe produces `Piped<T>` (from `meocord/interface`) — inside the handler it is exactly `T`:

```typescript
@Command('profile/{uid}', CommandType.BUTTON)
@Validate(z.object({ uid: z.string() }))
@UsePipe('uid', AccountPipe)
async profile(interaction: ButtonInteraction, { uid }: { uid: Piped<Account> }) {}
```

Both forms are checked: a pipe whose output does not fit the parameter fails to compile, and an unmarked key a separate pipe changes is reported as a mismatch with `@Validate`.

A pipe is resolved from the container like a service, so it can inject one, and one instance serves every call. Per-use values go through `{ provide, params }` and `context.getParams()`, the second argument of `transform`. A pipe that throws stops the call, and the error reaches the filters. Generate one with `npx meocord g pi <name>`.

---

## Cooldowns

`@Cooldown` limits how often a handler runs: at most `uses` calls within `seconds`, counted per user by default. The window slides, so each use comes back `seconds` after it was spent. Stack several for layered limits:

```typescript
import { Cooldown } from 'meocord/decorator'

@Command('daily', CommandType.SLASH)
@Cooldown({ seconds: 3 }) // one call every 3 seconds
@Cooldown({ uses: 5, seconds: 60 }) // and at most 5 a minute
async daily(interaction: ChatInputCommandInteraction) {}
```

Stacked cooldowns are counted together, a controller's first: the call is checked against every one of them, and counted against all of them only if all allow it, so a call one cooldown refuses spends none of the others. It waits the longest wait among those that refuse it. That holds for every store MeoCord ships; a store of your own counts them one after another unless it overrides `consumeMany` (see [Any other database](#where-calls-are-counted)).

| Option    | Default  | Description                                                                                                                               |
| --------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `seconds` | —        | The window's length.                                                                                                                      |
| `uses`    | `1`      | Calls allowed within the window.                                                                                                          |
| `per`     | `'user'` | Whose calls count together: `'user'`, `'guild'`, `'channel'` or `'global'`. Outside a server, `'guild'` and `'channel'` count per user.   |
| `bypass`  | —        | `(context) => boolean`: exempts a call without counting it, such as one from an owner.                                                    |
| `by`      | —        | `(context, params) => string \| number \| undefined`: counts calls apart by a value of the call, within the scope `per` names. See below. |

A blocked call throws `CooldownError` (from `meocord/common`, with `retryAfterMs` and `per`), which the built-in fallback answers only to the caller: "Slow down: try again in 12s." `cooldownMessage(retryAfterMs)` builds that text; an [exception filter](#exception-filters) catching `CooldownError` can say it another way, or in the user's language.

The cooldown is the [last stage](#how-a-handler-runs) before the handler: guards, validation and pipes have let the call through, so a denied call or bad input spends nothing. It applies to interaction and message handlers. On a controller, `@Cooldown` applies to each of those handlers separately, a subclass's included, and skips the controller's autocomplete, reaction and event handlers; on one of those handlers itself, the bot refuses to start.

Cooldowns are counted under the controller's class name, so the bot refuses to start when two classes share a name and either has a cooldown; rename one of them.

For a reusable exemption, compose it: `const Limited = (seconds: number) => applyDecorators(Cooldown({ seconds, bypass: isOwner }))`.

### Counting per resource

`per` decides whose calls count together; `by` splits that count by a value of the call, such as the account a button acts on. A user with three game accounts can then check each of them in once an hour:

```typescript
@Command('check-in/{ownerId}/{uid}', CommandType.BUTTON)
@UseGuard(OwnerGuard)
@Cooldown({ seconds: 3600, by: (_context, { uid }: { uid: string }) => uid })
async checkIn(interaction: ButtonInteraction, { uid }: { ownerId: string; uid: string }) {}
```

- `by` receives the call's `ExecutionContext` and the handler's params as the handler receives them: a component's customId params, a command's options, a modal's fields, a select menu's choices, after `@Validate` and pipes. For a piped object, return a stable id from it, such as `({ account }) => account.uid`.
- Declare the params `by` reads, or pass them as the type argument, `@Cooldown<{ uid: string }>({ … })`, and a key the handler does not receive, or receives as another type, fails to compile. Undeclared, they are `Record<string, unknown>`.
- With `per: 'global'`, the limit is per resource across every user.
- Returning `undefined` counts the call as though there were no `by`. An error `by` throws goes to the [exception filters](#exception-filters), and no cooldown on the handler counts the call.
- The value is added to the key the store counts under, encoded so a value holding `:` cannot count under another's key. `inspectHandler(...).cooldowns` reports `by: true` for a cooldown that has one.

A store counts each cooldown under `<Controller>.<method>#<index>:<per>:<scope>`, with `:by:<value>` added when `by` returns one. `<index>` is the cooldown's place in the handler's list, and `<scope>` is `user:<id>`, `guild:<id>`, `channel:<id>` or `global`; outside a server, `'guild'` and `'channel'` count under `user:<id>`. For the check-in button above, declared in a `CheckInController` and pressed by user `111111111111111111` for account `8000`:

```
CheckInController.checkIn#0:user:user:111111111111111111:by:8000
```

`RedisCooldownStore` puts its prefix, `meocord:cooldown:` by default, before each key. Since the index is part of the key, adding a cooldown above existing ones, or reordering them, counts them afresh.

### Where calls are counted

By default in this process's memory: one count per bot, which drops keys whose calls have all expired. With [process sharding](#sharding), each shard counts on its own, so `'user'` and `'global'` cooldowns allow more than they say — the bot warns at startup, unless it binds a shared store. `'guild'` and `'channel'` stay exact, since a server lives on one shard.

| Store                               | Counts                                            | Survives a restart               | Across hosts         |
| ----------------------------------- | ------------------------------------------------- | -------------------------------- | -------------------- |
| `MemoryCooldownStore` (the default) | In this process; per shard with process sharding  | No                               | No                   |
| `ShardedCooldownStore`              | In the shard manager, for every shard on the host | A shard's restart, not the bot's | No                   |
| `RedisCooldownStore`                | On the Redis server                               | Yes                              | Yes                  |
| Your own `CooldownStore`            | Where it keeps them                               | As its database does             | As its database does |

To keep counts across restarts, or share them between shards and processes, bind a shared store with `@MeoCord({ cooldownStore })`.

**Process sharding on one host.** `ShardedCooldownStore` from `meocord/common` needs no database: each shard asks the shard manager, which counts every shard's calls in its memory over the IPC the shards already use, so `'user'` and `'global'` cooldowns are exact across them.

```typescript
import { ShardedCooldownStore } from 'meocord/common'

@MeoCord({ controllers: [...], clientOptions: {...}, cooldownStore: ShardedCooldownStore })
export default class App {}
```

The manager's counts are kept while it runs: a shard that restarts keeps them, but they start again when the whole bot restarts, as the default store's do. A handler's stacked cooldowns go to the manager as one message. A manager that does not answer in time is a store failure, handled as [below](#when-the-store-fails). Without process sharding it counts in the one process, which is exact there too.

**Redis, and servers that speak its protocol.** `RedisCooldownStore` from `meocord/common` counts each key in a sorted set, trimmed, counted and added to by one Lua script, timed by the server's `TIME` so every process counts by one clock, with every key set to expire. MeoCord depends on no Redis client: give `RedisCooldownStore.using` a function that runs a script with the one you have.

```typescript
import { RedisCooldownStore } from 'meocord/common'
import { createClient } from 'redis'

const redis = await createClient({ url: process.env.REDIS_URL }).connect()

@MeoCord({
  controllers: [...],
  clientOptions: {...},
  cooldownStore: RedisCooldownStore.using((script, keys, args) => redis.eval(script, { keys, arguments: args })),
})
export default class App {}
```

With ioredis, run it as `(script, keys, args) => redis.eval(script, keys.length, ...keys, ...args)`. Keys start with `meocord:cooldown:`; pass `{ prefix }` for your own. Pass `{ evalsha }`, such as `(sha, keys, args) => redis.evalSha(sha, { keys, arguments: args })`, to send the script by its SHA1, and in full only when the server answers `NOSCRIPT`.

One script counts all of a handler's stacked cooldowns, so a call costs one round trip however many it has. On **Redis Cluster** a handler's keys usually sit in different slots, which one script cannot reach: the store then counts each key with a script of its own, in order, so there a call one cooldown refuses has counted against those before it. Pass `{ hashTag: 'handler' }` to keep each handler's keys in one slot, `{Controller.method}#…`, and its cooldowns one step; every call to that handler then lands on that one slot.

The same script runs on Redis 5 and later, Valkey, KeyDB, Dragonfly and Upstash, which runs `EVAL`. Garnet runs Lua only in part: check it with [`testCooldownStore`](#checking-a-store) before relying on it.

**Any other database.** Extend `CooldownStore`. It is resolved like a service, so it can inject its client, and its `consume` must check and record a call in one step, so two calls at the limit cannot both pass. `@Cooldown` calls `consumeMany(entries)` once per call, with every stacked cooldown; its default calls `consume` for each in order and stops at the first refusal. Override it to check them all and record the call against all only if all allow it, in one round trip, as the built-in stores do — worth it for any store behind a network. `peekMany(entries)` checks the same entries without recording the call. Its default allows every call, leaving the refusal to `consumeMany`; the built-in stores override it with one round trip, a read-only script on Redis and one message to the shard manager. Override it the same way to let a cooldown refuse a call before the work ahead of its handler. See [Store recipes](#store-recipes) for Postgres, SQLite and MongoDB, and check yours with [`testCooldownStore`](#checking-a-store).

In tests, each `MeoCordTestingModule` counts in a fresh in-memory store; provide `{ provide: CooldownStore, useValue }` to use another. `inspectHandler(Controller, 'method').cooldowns` lists a handler's cooldowns with their defaults.

### When the store fails

A shared store can be down, restarting or cut off. When it throws, rejects or does not answer within `cooldownStoreTimeoutMs` (a second by default), `cooldownStoreFailure` decides what the call gets:

```typescript
@MeoCord({
  controllers: [...],
  clientOptions: {...},
  cooldownStore: RedisStore,
  cooldownStoreFailure: 'allow', // 'deny' by default
  cooldownStoreTimeoutMs: 500,
})
export default class App {}
```

- **`'deny'`**, the default, refuses the call with `CooldownStoreError` from `meocord/common`: a cooldown that cannot be checked is not known to allow it. The fallback answers only the caller, "Cooldowns can't be checked right now: try again shortly.", through the presenter's error view; a filter catching `CooldownStoreError` can say it otherwise, or in the user's language. Observers see `outcome: 'error'` with that error.
- **`'allow'`** runs the call without counting it, keeping the bot available while the store is down.

Either way the failure is logged once per outage, with its cause, and again when the store answers. MeoCord never counts a call itself or asks twice, so a store that answers after the timeout records the call once, in the store; under `'deny'` that call was refused and still spent a use there.

### Checking a store

A shared store is easy to get subtly wrong. `testCooldownStore` from `meocord/testing` runs the behaviour `MemoryCooldownStore` defines against yours, under Vitest, Jest or any runner with `describe`, `it` and `expect`:

```typescript
import { testCooldownStore } from 'meocord/testing'
import { PostgresCooldownStore } from '@src/stores/postgres-cooldown.store.js'

testCooldownStore('PostgresCooldownStore', () => new PostgresCooldownStore(sql), { describe, it, expect })
```

It checks calls within a window, that the window slides rather than resetting in buckets, that `retryAfterMs` counts from the oldest call still in the window — so "try again in 12s" means the same whatever the store — that each key counts on its own, that calls in the same millisecond stay distinct, and that of several concurrent calls at the limit exactly one passes. For a store that overrides `peekMany`, it checks that a peek records nothing and refuses with the wait `consume` gives. It uses real time with short windows, so it takes a few seconds, and each case counts under keys of its own, so it can run against a database that outlives the test. What it cannot see is whether every key expires: a store should give each one an expiry, or clear keys whose calls have all left their window.

### Store recipes

Stores for other databases, each checked with `testCooldownStore`. A store is resolved like a service, so inject your client, and keep the check and the record in one step: a transaction holding a lock on the key, or a single atomic update.

**Postgres** ([postgres.js](https://github.com/porsager/postgres)): a row per call, counted in a transaction that holds an advisory lock on the key, with the database's clock throughout.

```sql
CREATE TABLE cooldown_calls (key text NOT NULL, at timestamptz NOT NULL DEFAULT clock_timestamp(), id bigserial PRIMARY KEY);
CREATE INDEX ON cooldown_calls (key, at);
```

```typescript
consume(key: string, { uses, windowMs }: CooldownLimit): Promise<CooldownVerdict> {
  return this.sql.begin(async sql => {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`
    const window = sql`${windowMs} * interval '1 millisecond'`
    await sql`DELETE FROM cooldown_calls WHERE key = ${key} AND at <= clock_timestamp() - ${window}`
    const [{ count, retry }] = await sql`
      SELECT count(*)::int AS count,
             ceil(extract(epoch FROM min(at) + ${window} - clock_timestamp()) * 1000)::int AS retry
      FROM cooldown_calls WHERE key = ${key}`
    if (count >= uses) return { allowed: false, retryAfterMs: retry }
    await sql`INSERT INTO cooldown_calls (key) VALUES (${key})`
    return { allowed: true, retryAfterMs: 0 }
  })
}
```

A key's rows go when it is next used; clear the rest from time to time with `DELETE FROM cooldown_calls WHERE at < now() - interval '1 day'`, or whatever your longest window is.

**SQLite** ([better-sqlite3](https://github.com/WiseLibs/better-sqlite3)): the same rows in an `IMMEDIATE` transaction, which takes the write lock before reading, so two processes on one database file cannot both take the last use. SQLite shares one host, so `Date.now()` is one clock.

```typescript
consume(key: string, { uses, windowMs }: CooldownLimit): Promise<CooldownVerdict> {
  const now = Date.now()
  const consumeOne = this.db.transaction((): CooldownVerdict => {
    this.db.prepare('DELETE FROM cooldown_calls WHERE key = ? AND at <= ?').run(key, now - windowMs)
    const { count, oldest } = this.db
      .prepare('SELECT count(*) AS count, min(at) AS oldest FROM cooldown_calls WHERE key = ?')
      .get(key) as { count: number; oldest: number | null }
    if (count >= uses) return { allowed: false, retryAfterMs: oldest! + windowMs - now }
    this.db.prepare('INSERT INTO cooldown_calls (key, at) VALUES (?, ?)').run(key, now)
    return { allowed: true, retryAfterMs: 0 }
  })
  return Promise.resolve(consumeOne.immediate())
}
```

with `CREATE TABLE cooldown_calls (id INTEGER PRIMARY KEY, key TEXT NOT NULL, at INTEGER NOT NULL)` and an index on `(key, at)`.

**MongoDB**: one document per key, trimmed, counted and appended to by a single `findOneAndUpdate` with an update pipeline, so the check and the record are one atomic write, timed by the server's `$$NOW`. A TTL index on `expiresAt` removes a key once its window has passed.

```typescript
async consume(key: string, { uses, windowMs }: CooldownLimit): Promise<CooldownVerdict> {
  const id = randomUUID() // tells this call apart from one in the same millisecond
  const kept = { $filter: { input: { $ifNull: ['$calls', []] }, cond: { $gt: ['$$this.at', { $subtract: ['$$NOW', windowMs] }] } } }
  const doc = await this.cooldowns.findOneAndUpdate(
    { _id: key },
    [
      { $set: { calls: kept } },
      {
        $set: {
          calls: { $cond: [{ $lt: [{ $size: '$calls' }, uses] }, { $concatArrays: ['$calls', [{ at: '$$NOW', id }]] }, '$calls'] },
          expiresAt: { $add: ['$$NOW', windowMs] },
          now: '$$NOW',
        },
      },
    ],
    { upsert: true, returnDocument: 'after' },
  )
  if (doc!.calls.some((call: { id: string }) => call.id === id)) return { allowed: true, retryAfterMs: 0 }
  return { allowed: false, retryAfterMs: doc!.calls[0].at.getTime() + windowMs - doc!.now.getTime() }
}
```

with `db.cooldowns.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })`.

---

## Observers

An observer is told about every call MeoCord dispatches, once it has settled: commands, components, modals, autocomplete, message, reaction and event handlers, and interactions no handler matches and nothing else answers. It is where metrics and audit logs go, since no other stage sees every outcome. Guards run before anything is decided, interceptors never see a call a guard denied or autocomplete, and filters see only errors.

```typescript
import { Observer } from 'meocord/decorator'
import { type ExecutionContext } from 'meocord/common'
import { type DispatchObserver, type DispatchResult } from 'meocord/interface'

@Observer()
export class MetricsObserver implements DispatchObserver {
  constructor(private readonly metrics: MetricsService) {}

  onSettled(context: ExecutionContext, { outcome, durationMs }: DispatchResult) {
    this.metrics.record(context.getType(), context.getHandlerName() ?? 'unrouted', outcome, durationMs)
  }
}

@MeoCord({ controllers: [ShopController], observers: [MetricsObserver], clientOptions: { intents: [] } })
class App {}
```

`DispatchResult` holds:

| Field        | What it is                                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `outcome`    | `'ran'`, `'denied'`, `'cooldown'`, `'invalid'`, `'error'` or `'not-found'`; see below.                                    |
| `startedAt`  | When dispatch received the call, in milliseconds since the Unix epoch.                                                    |
| `durationMs` | From dispatch until the filters and the fallback had answered, from `performance.now()`.                                  |
| `deniedBy`   | The guard class that denied the call, whether it returned `false` or threw `GuardDeniedError`.                            |
| `response`   | For an interaction, where its answer stood: `'replied'`, `'deferred'` (deferred and never followed up) or `'unanswered'`. |
| `error`      | The error the call ended with, when it ended with one.                                                                    |
| `handled`    | Whether an exception filter or the built-in fallback answered the error; `false` without one.                             |

| Outcome       | When                                                                                                                                   |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `'ran'`       | The call settled without an error. An interceptor that answers without calling `next.handle()`, from a cache for instance, counts too. |
| `'denied'`    | A guard returned `false` (no `error`) or threw `GuardDeniedError`.                                                                     |
| `'cooldown'`  | A `@Cooldown` refused it with `CooldownError`.                                                                                         |
| `'invalid'`   | `@Validate` refused its input with `ValidationError`.                                                                                  |
| `'refused'`   | A [`UserError`](#user-errors) told the user what to fix: their mistake, not the bot's fault.                                           |
| `'error'`     | Anything else was thrown, by the handler, a pipe, an interceptor or a guard.                                                           |
| `'not-found'` | No handler matches the interaction: `CommandNotFoundError`, or an autocomplete no `@Autocomplete` claims (no `error`).                 |

`response` catches a handler that left an interaction hanging: `'deferred'` means the user still sees "thinking…".

What is reported: every interaction, the ones no handler matches included, except a component or modal a collector or another listener answers, which is that listener's call; every message and reaction a handler runs for; and every event handler call. A message no handler matches is not reported: messages are not commands, and most of a server's traffic would reach the observers for nothing.

- **Read-only.** An observer runs outside the call, and the call waits for none of its methods, so a slow observer never delays a handler. One that throws is logged through `Logger`, and the others still run.
- **In order.** Observers are told one after another, in the order `observers` lists them.
- **By type.** `@Observer({ types: ['interaction'] })` is told only about those calls, as `ExecutionContext.getType()` reports them. An empty list throws, and a subclass inherits the types unless it declares its own.
- **A service.** One instance is resolved from the container, so an observer injects services, and its `onReady` and `onShutdown` hooks run in dependency order with the rest; an exporter flushes what it buffered in `onShutdown`, before the services it uses shut down. It cannot inject `ExecutionContext`; each call's context is passed in, and has no controller or handler for an interaction no handler matched.
- **Testing.** `invoke` and `emit` wait for the module's observers before they resolve, so a test sees what they were told. The testing module takes an `app`'s observers, and `observers` of its own. `inspectHandler(Controller, 'method', { app }).observers` lists the app's.

Generate one with `npx meocord g ob <name>`.

### Tracing a call

`onStart` receives the call as it begins, and `onSettled` for the same call receives the same context object, so a `WeakMap` pairs them: that gives a span for every call, a denied one or one no handler matched included. An observer sees the call from outside, though: a span for work inside the handler, such as a database query nested under the command, comes from an interceptor, which runs within the call. With OpenTelemetry, use both:

```typescript
// The call's own span, from the moment it arrives, whatever the outcome
@Observer()
export class CallSpanObserver implements DispatchObserver {
  private readonly spans = new WeakMap<ExecutionContext, Span>()

  onStart(context: ExecutionContext) {
    this.spans.set(context, tracer.startSpan(`${context.getType()} ${context.getHandlerName()}`))
  }

  onSettled(context: ExecutionContext, { outcome }: DispatchResult) {
    const span = this.spans.get(context)
    span?.setAttribute('meocord.outcome', outcome)
    span?.end()
  }
}

// The handler's span, active while it runs, so the spans it starts nest under it
@Interceptor()
export class HandlerSpanInterceptor implements InterceptorInterface {
  async intercept(context: ExecutionContext, next: CallHandler) {
    return tracer.startActiveSpan(`handler ${context.getHandlerName()}`, async span => {
      try {
        return await next.handle()
      } finally {
        span.end()
      }
    })
  }
}
```

---

## Custom Decorators

MeoCord exports `applyDecorators` from `meocord/common` to combine decorators into one of your own, and `createMetadata` for a typed decorator that stores a value on a handler — see [Reading handler metadata](#reading-handler-metadata). `SetMetadata(key, value)` stores a value under a key of your choosing, read with `ExecutionContext.get(key)`; prefer `createMetadata`, whose values are typed and whose key cannot collide. `SetMetadata` refuses MeoCord's own keys, such as `'guards'`, where a value would replace what the framework stores.

### Composing guards into a reusable decorator

```typescript
import { applyDecorators } from 'meocord/common'
import { UseGuard } from 'meocord/decorator'
import { DefaultGuard, RateLimiterGuard } from '@src/guards/index.js'

export const Protected = (limit = 5) =>
  applyDecorators(UseGuard(DefaultGuard, { provide: RateLimiterGuard, params: { limit } }))
```

```typescript
@Command('profile', CommandType.SLASH)
@Protected(3)
async profile(interaction: ChatInputCommandInteraction) { ... }
```

The [guard options](#passing-options-to-a-guard) and [metadata](#reading-handler-metadata) examples under Guards compose the same way.

---

## Gateway Events

`@On(event)` handles a discord.js client event every time it is emitted, and `@Once(event)` the first time only. Put them on a controller or a service; the handler's parameters are typed from discord.js's `ClientEvents`:

```typescript
import { Controller, On, Once } from 'meocord/decorator'
import { type Client, type GuildMember } from 'discord.js'
import { WelcomeService } from '@src/services/welcome.service.js'

@Controller()
export class WelcomeController {
  constructor(private readonly welcome: WelcomeService) {}

  @On('guildMemberAdd')
  async greet(member: GuildMember) {
    await this.welcome.send(member)
  }

  @Once('clientReady')
  async warmCache(client: Client<true>) {
    await client.guilds.fetch()
  }
}
```

- **Where**: on any controller or service the app binds — listed in `@MeoCord({ controllers, services })` or injected by one. The instance is resolved when the first event arrives.
- **Guards and interceptors**: an event handler runs through the same pipeline as a command. `@UseGuard` and `@UseInterceptor` on the method or the controller, and the global ones from `@MeoCord({ guards, interceptors })`, apply; a guard receives the event's arguments, and `ExecutionContext.getType()` is `'event'`. A global guard written for interactions should declare `@Guard({ types: ['interaction'] })`, so it skips events; at startup MeoCord names each global guard or interceptor without `types` that will also run on events. A guard or interceptor that throws on an event is logged like any handler error.
- **Errors** a handler throws go to its exception filters, as a command's do. One no filter handles is logged with the event and the handler's name, never answered, and never stops the bot or the other handlers of that event.
- **Intents**: at startup MeoCord warns once for each intent or partial your handlers need that `clientOptions` lacks — `GuildMembers` for `guildMemberAdd`, say — and reminds you to enable privileged intents in the Discord developer portal. `@MessageHandler` and `@ReactionHandler` are checked the same way. If Discord then refuses a privileged intent at login, the bot logs which ones it requests and where to enable them — Developer Portal → your application → Bot → Privileged Gateway Intents — and `app.start()` rejects with an error `isExplainedError(error)` recognises, so the generated `main.ts` does not log it a second time with its stack trace.
- `@On('interactionCreate')` and `@On('messageCreate')` run alongside MeoCord's own dispatch of those events.
- **Names**: `@Once` and `@Cooldown` tell classes apart by name, so the bot refuses to start when two classes share a name and either has a `@Once` handler; rename one of them.

In a test, `module.emit(event, ...args)` sends an event to the module's handlers through the same pipeline:

```typescript
const module = MeoCordTestingModule.create({ controllers: [WelcomeController], providers: [...] }).compile()

const { ran } = await module.emit('guildMemberAdd', createMock<GuildMember>())
expect(ran).toBe(1)
```

`emit` resolves to how many handlers ran, and rejects once they have all settled if any threw: with that error, or an `AggregateError` when several did.

---

## Handler Discovery

`HandlerRegistry`, from `meocord/core`, lists every handler the app registered, with the metadata declared on it — for a `/help` command, an admin page or generated docs. Inject it like any service:

```typescript
import { Service } from 'meocord/decorator'
import { HandlerRegistry } from 'meocord/core'
import { Category } from '@src/common/category.metadata.js'

@Service()
export class HelpService {
  constructor(private readonly handlers: HandlerRegistry) {}

  commands() {
    return this.handlers
      .list({ kind: 'command' })
      .map(h => ({ path: h.name, description: h.description, category: h.get(Category) ?? 'Other' }))
  }
}
```

`list({ kind, controller })` filters by what a handler handles and by the class declaring it, and narrows the entries' type to that kind. Each entry has `controller`, `method`, `kind` and `name`, plus `get` and `getAll`, which read metadata as `ExecutionContext` does:

| `kind`         | `name`                                         | Also                                                                                                                   |
| -------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `command`      | The command, or a subcommand's full path       | `commandType`, `command` (the registered JSON), `description`                                                          |
| `component`    | The customId pattern, such as `profile/{uid}`  | `commandType`                                                                                                          |
| `modal`        | The customId pattern                           | `commandType`                                                                                                          |
| `autocomplete` | The command path, then the option it completes |                                                                                                                        |
| `message`      | The pattern, or `undefined` for every message  | `command`, `aliases`, `description`, `scope`, `usage(prefix)`, `matches(words)`; see [A help command](#a-help-command) |
| `reaction`     | The emoji, or `undefined` for every reaction   |                                                                                                                        |
| `event`        | The client event                               | `once`                                                                                                                 |

---

## Providers

A class that a controller or service injects by its type is bound for you. For anything else — a database pool, a configured client, settings, or the implementation behind an abstract class — list a provider in `@MeoCord({ providers })`, and inject it with `@Inject(token)`:

```typescript
import { createToken } from 'meocord/common'
import { Inject, MeoCord, Service } from 'meocord/decorator'
import { GatewayIntentBits } from 'discord.js'
import pg from 'pg'

export const DATABASE = createToken<pg.Pool>('Database')

@Service()
export class NotesStore {
  constructor(@Inject(DATABASE) private readonly db: pg.Pool) {}

  async list(userId: string) {
    const { rows } = await this.db.query('SELECT text FROM notes WHERE user_id = $1', [userId])
    return rows
  }
}

@MeoCord({
  controllers: [NotesController],
  providers: [
    { provide: 'databaseUrl', useValue: process.env.DATABASE_URL },
    {
      provide: DATABASE,
      useFactory: async (url: string) => {
        const pool = new pg.Pool({ connectionString: url })
        await pool.query('SELECT 1') // fail at startup, not at the first command
        return pool
      },
      inject: ['databaseUrl'],
    },
  ],
  clientOptions: { intents: [GatewayIntentBits.Guilds] },
})
export default class App {}
```

| Provider                           | Provides                                                                               |
| ---------------------------------- | -------------------------------------------------------------------------------------- |
| `{ provide, useValue }`            | The value, as it is.                                                                   |
| `{ provide, useClass }`            | One instance of the class, with its own constructor dependencies injected.             |
| `{ provide, useFactory, inject? }` | What the function returns, called once with the values of `inject`. It may be `async`. |

To have a factory's parameters typed from `inject`, and its return checked against the token, wrap it in `factoryProvider` from `meocord/common`. TypeScript cannot type a plain object's factory from `inject` inside a list; this does, and returns the provider unchanged:

```typescript
import { createToken, factoryProvider } from 'meocord/common'

const DATABASE_URL = createToken<string>('DatabaseUrl')

providers: [
  { provide: DATABASE_URL, useValue: process.env.DATABASE_URL! },
  // url is a string, and the factory must return a pg.Pool, as DATABASE says
  factoryProvider({
    provide: DATABASE,
    inject: [DATABASE_URL],
    useFactory: async url => new pg.Pool({ connectionString: url }),
  }),
]
```

Each parameter is what the token in its place provides: a class's instance, a `createToken` token's type, or `unknown` for a string or plain symbol. A parameter `inject` does not supply, or a return of the wrong type, fails to compile.

- **Tokens** are a class, a string, a symbol, or a token from `createToken<T>(description)`: a symbol whose description names it in errors, and whose type `TestingModule.get` returns. A parameter typed as a class needs no `@Inject`; `{ provide: Storage, useClass: RedisStorage }` makes every `Storage` parameter a `RedisStorage`.
- **When**: every factory runs once, in dependency order, when `app.start()` begins, before the listed services are made and before login, awaiting those that return a promise. Anything that injects the value gets the resolved one.
- **Lifecycle**: a provided value that implements `onReady` or `onShutdown` gets them called like a service's, in dependency order, so it closes after the services that use it. `pg.Pool` has no such hook; end it from the `onShutdown` of the service that owns it, or provide a class that wraps it.
- **Failures**: a factory that throws or rejects stops the bot before it logs in. The log names the token and the cause, `app.start()` rejects with an error `isExplainedError` recognises, and the exit code is 1. A class or factory that injects a token nothing provides stops `MeoCordFactory.create()`, naming both. A token may be provided once, and the tokens MeoCord binds itself, such as `Client`, cannot be provided.

In a test, `MeoCordTestingModule` takes the same providers, and `overrideProvider(token)` replaces one under any token. `invoke` and `emit` resolve asynchronous factories first; before calling `get` on something that depends on one, `await module.init()`.

---

## Lifecycle Hooks

A controller or service can do work once the bot is online, and clean up before it stops, by implementing `OnReady` and `OnShutdown` from `meocord/interface`:

```typescript
import { Service } from 'meocord/decorator'
import { type OnReady, type OnShutdown, type ReadyInfo } from 'meocord/interface'
import { type Client } from 'discord.js'

@Service()
export class ReminderScheduler implements OnReady, OnShutdown {
  private timer?: ReturnType<typeof setInterval>

  onReady(client: Client<true>, { primary }: ReadyInfo) {
    if (primary) this.timer = setInterval(() => void this.sendDueReminders(client), 60_000)
  }

  onShutdown() {
    clearInterval(this.timer)
  }

  private async sendDueReminders(client: Client<true>) {
    for (const { userId, text } of this.takeDue()) await client.users.send(userId, text)
  }

  private takeDue(): { userId: string; text: string }[] {
    return [] // read the reminders that are due from your store
  }
}
```

- **Which classes**: every controller and every service the app binds — the ones listed in `@MeoCord({ controllers, services })` and everything they depend on — including a service no handler has used yet, and every [provided](#providers) value that implements a hook. Guards are created per call and get no hooks.
- **`onReady`** runs once the client is ready. It receives the client and `{ primary }`, which says whether this process should do one-off work: `true` for a bot running in one process, and with [process sharding](#sharding) only in the process running shard 0.
- **Dependency order.** `onReady` hooks run one at a time, each class after the classes it injects: a `DatabaseService` is ready before the `ReminderScheduler` that injects it. Classes with no dependency between them run in declaration order, the `services` first, then the `controllers`. Command registration runs alongside and never delays the hooks. A hook still running after 10 seconds is named in a warning, and the hooks after it wait for it.
- **`onShutdown`** runs on SIGINT or SIGTERM, before the client is destroyed, in reverse order, so a class stops before the classes it uses. The bot waits for the whole sequence up to `shutdownTimeout` from `meocord.config.ts` (10 seconds by default), then shuts down whether or not it finished. A second signal more than a second after the first exits at once; one sooner is taken as the same request, since a terminal's Ctrl+C can arrive twice. If the bot never became ready, for example because the login failed, no `onShutdown` hook runs. A signal that arrives while the `onReady` hooks are still running shuts down only the classes whose `onReady` finished, and those without one; the class still starting, and those after it, are skipped, and no further `onReady` starts.
- A hook that throws is logged and the next one still runs. When a class's `onReady` failed, the classes that depend on it still run theirs, with a warning naming the failed dependency.
- In a test, `init({ ready: true })` and `close()` on a testing module run the hooks in the same order — see [Lifecycle hooks in a test](#lifecycle-hooks-in-a-test).

---

## Localisation

One catalog of messages per locale, typed from the default one, serves command names and descriptions and the bot's replies. Keys, the params each message takes and plural forms are all checked at compile time; nothing is added to your dependencies.

```typescript
// src/locales/en-US.ts — the default catalog, which every other locale is checked against
import { defineCatalog } from 'meocord/common'

export default defineCatalog({
  ban: { name: 'ban', description: 'Ban a member', done: 'Banned {user}.' },
  warnings: { one: '{user} has {count} warning', other: '{user} has {count} warnings' },
})
```

```typescript
// src/locales/id.ts — any part of the default catalog; what it leaves out falls back
export default { ban: { name: 'blokir', description: 'Blokir anggota', done: '{user} diblokir.' } }
```

```typescript
// src/i18n.ts — at module scope, because command builders run when their class is decorated
import { createTranslator } from 'meocord/common'
import enUS from '@src/locales/en-US'
import id from '@src/locales/id'

export const t = createTranslator({ default: 'en-US', locales: { 'en-US': enUS, id } })
```

Locales are discord.js `Locale` values: `en-GB`, `es-419`, `zh-TW`, and so on; a bare `en` is refused.

**Commands.** A builder uses the translator directly. `t.localizations(key)` returns only the locales whose catalog has the message, so Discord's own fallback still applies to the rest:

```typescript
@CommandBuilder(CommandType.SLASH)
export class BanCommandBuilder implements CommandBuilderBase {
  build() {
    return new SlashCommandBuilder()
      .setName(t.default('ban.name'))
      .setNameLocalizations(t.localizations('ban.name'))
      .setDescription(t.default('ban.description'))
      .setDescriptionLocalizations(t.localizations('ban.description'))
  }
}
```

Interactions still report the default name, so routing is unchanged. Discord limits names to 32 lowercase characters and descriptions to 100: a builder that is handed a longer one fails when its class is decorated, with an error naming the builder and the command, and a raw command body that breaks the rules stops registration with one error listing every field, instead of Discord's opaque rejection.

**Replies.** `t.for(interaction)` translates into the user's language; `{ public: true }` into the server's, for a reply everyone there sees. `t.forGuild(guild)` uses the server's preferred language, for events and messages, which have no user locale. `t.locale('ja')` takes any locale.

```typescript
await interaction.reply(t.for(interaction)('ban.done', { user: target.toString() }))
await channel.send(t.forGuild(member.guild)('warnings', { user: member.displayName, count: 3 }))
```

A locale resolves to its own catalog, then to another of the same language (`es-419` to `es-ES`, `en-GB` to the `en-US` default), then to the default, message by message.

**Params and plurals.** `'Banned {user}.'` requires `{ user }`; a misspelled or missing param fails to compile. A plural is an object whose keys are plural categories — `zero`, `one`, `two`, `few`, `many` and the required `other` — and takes a numeric `count`, which picks the form through `Intl.PluralRules` for the locale, so Russian's `few` and `many` work without extra code. An object whose keys are all category names is always read as a plural. Params take strings and numbers; format numbers and dates yourself, with `Intl.NumberFormat` for instance.

**The default catalog must be TypeScript.** Params are typed from the message text, which TypeScript keeps only for a literal: wrap the catalog in `defineCatalog(...)`, or add `as const`. A catalog that has lost its text types is refused with a compile error saying so. Other locales may be plain objects or JSON: they are checked against the default's keys, and fall back at runtime.

**In services.** Pass the translator to `@MeoCord({ i18n: t })` and inject it as `Translator`, typed by the default catalog; importing `t` works too. A class that injects `Translator` in an app without `i18n` stops the bot at startup with a message saying what to pass.

```typescript
@Service()
export class BanService {
  constructor(private readonly t: Translator<typeof enUS>) {}
}
```

**Testing.** `expectCompleteCatalog(t)` from `meocord/testing` fails with every message a locale lacks, every message the default catalog does not have, and every plural form a language needs but lacks. A testing module created with `app` injects the app's translator; otherwise provide one with `{ provide: Translator, useValue: t }`.

The built-in fallback's own texts — "Command not found!" and the generic error — stay in English. An [exception filter](#exception-filters) can answer in the user's language instead.

---

## Testing

MeoCord ships a `meocord/testing` entry point with utilities for testing controllers in isolation — no real Discord connection required. The mocks are **framework-agnostic** and work with Vitest or Jest assertions (see below).

### Running tests

Generated apps come with Vitest set up — `vitest.config.ts` with SWC for decorator metadata — plus a spec beside every generated component:

```shell
npm test                  # run once
npm run test:watch        # watch mode
npm run test:coverage     # coverage report
```

In an older project, add Vitest (or keep Jest) with the same SWC setup; `meocord/testing` works with either.

Tests do not load `.env`, so a real token never reaches a spec unasked, and they run the same before and after a build. A project whose tests need its variables loads them in `vitest.setup.ts`:

```typescript
import 'dotenv/config'
```

### `MeoCordTestingModule`

Builds an isolated DI container from your controllers and providers.

```typescript
import { MeoCordTestingModule } from 'meocord/testing'
import { GreetingSlashController } from '@src/controllers/slash/greeting.slash.controller.js'
import { GreetingService } from '@src/services/greeting.service.js'

const module = MeoCordTestingModule.create({
  controllers: [GreetingSlashController],
  providers: [{ provide: GreetingService, useValue: mockGreetingService }],
}).compile()

const controller = module.get(GreetingSlashController)
```

`providers` takes the same shapes as `@MeoCord({ providers })`: `useValue`, `useClass` and `useFactory`, under a class, string, symbol or `createToken` token. A factory that returns a promise is resolved by `await module.init()`, which `invoke` and `emit` call for you.

#### Lifecycle hooks in a test

`init()` runs no `onReady` [hook](#lifecycle-hooks). `init({ ready: true })` also runs every `onReady` once, as the bot does when it comes online, and `close()` runs the `onShutdown` hooks, so a test can check what a service does at startup and close what a provider opened:

```typescript
import { MeoCordTestingModule, type TestingModule } from 'meocord/testing'

let module: TestingModule

beforeEach(async () => {
  module = await MeoCordTestingModule.create({
    controllers: [ReminderController],
    providers: [{ provide: DATABASE, useFactory: async () => createTestDatabase() }],
  })
    .compile()
    .init({ ready: true })
})

afterEach(() => module.close())

it('schedules the reminders it loaded at startup', () => {
  expect(module.get(ReminderScheduler).pending).toHaveLength(2)
})
```

- **Order.** The hooks run as the bot runs them: `onReady` one at a time, each class after the classes and providers it injects, the observers last; `onShutdown` in reverse, so a provided value such as a connection pool closes after everything that uses it.
- **The client.** `onReady` receives a client from `createMockClient` and `{ primary: true }`. Pass your own with `init({ ready: { client, primary: false } })`.
- **Failures.** Every hook runs even when one throws. Then `init` or `close` rejects with that error, or with an `AggregateError` naming each hook when several threw, where the bot would log them.
- **What `close()` shuts down.** Every class and provided value the module has constructed, whether or not `init({ ready: true })` ran: the pool a factory made in `init()`, a service a test resolved with `get`, what `invoke` and `emit` built. Nothing is constructed just to be shut down.
- **Once.** A second `init({ ready: true })` or `close()` runs nothing more.
- **The theme outside calls.** Once ready, the module's app theme is the one [`useTheme()`](#reading-the-theme) reads outside any call, as a bot's is once online, so an `onReady` hook reads it. The first module ready in the process keeps it until its `close()`, which then leaves MeoCord's defaults; another module's calls still read their own theme.

#### Themes in a test

A testing module runs each call in its theme as the bot does, through `invoke` and `dispatch` alike: the app's theme, each `@UseTheme`, and what `themeFor` looks up. The builder changes the app's theme or replaces its resolvers for one module, and `createMockTheme` and `withTheme` from `meocord/testing` test a service or presenter without a module:

```typescript
import { vi } from 'vitest'
import { createMockTheme, MeoCordTestingModule, withTheme } from 'meocord/testing'

it("colours a refund in the server's theme", async () => {
  const guild = vi.fn(() => ({ colors: { primary: '#E3606D' } }))
  const module = MeoCordTestingModule.create({ app: App, controllers: [ShopController] })
    .overrideTheme({ colors: { primary: '#5865F2' } }) // over @MeoCord({ theme })
    .overrideThemeFor({ guild }) // in place of @MeoCord({ themeFor }); undefined removes it
    .compile()

  await module.dispatch(interaction)
  await module.dispatch(interaction)

  expect(guild).toHaveBeenCalledTimes(1) // cached, as in the bot

  module.themeCache.invalidateGuild(interaction.guildId!)
  await module.dispatch(interaction)
  expect(guild).toHaveBeenCalledTimes(2)
})

it('formats a receipt in the theme it is given', async () => {
  const theme = createMockTheme({ emojis: { success: '🎉' } })

  const line = await withTheme(theme, () => receipts.line(order))

  expect(line).toBe(`${theme.emojis.success} Paid`)
})
```

- **`overrideTheme(theme)`** changes part of the app's `@MeoCord({ theme })`, or gives a module without an app a theme. It goes over the app's theme, so it names only the tokens it changes, and each `@UseTheme` still goes over it. It is checked as `@MeoCord({ theme })` is.
- **`overrideThemeFor(resolvers)`** replaces the app's `themeFor`, or removes it with `undefined`. The app's `themeCache` and `themeForTimeoutMs` still apply.
- **`module.themeCache`** is the module's `ThemeCache`, the one its classes inject. Each module has its own, so a result never reaches another test.
- **`createMockTheme(overrides?)`** returns a whole theme, frozen, with `overrides` merged over MeoCord's defaults, to pass where code takes a theme or to compare against. When the app adds tokens, `overrides` gives them, as the app's theme does.
- **`withTheme(theme, fn)`** runs `fn` with `theme` as the call's theme: `useTheme()` reads it in `fn` and in everything `fn` awaits or starts. It takes a theme `createMockTheme` made, or the roles to change.
- **A collector's callback** answers with `respond()` outside the call, and takes the module's theme, as in the bot, with the server's and user's over it: `invoke` and `dispatch` make the module the app of their input's client. Give the click the collector receives that client, as the gateway does, with `createMockInteraction(ButtonInteraction, { client: interaction.client })`.

### Running a handler with `invoke`

`module.invoke(Controller, 'method', ...args)` runs a handler through the [pipeline](#how-a-handler-runs) dispatch runs: `@Defer`, its guards, class guards first and each once, then its interceptors around validation, pipes, cooldowns and the handler, all inside its exception filters. Guards resolve from the module, so `overrideGuard` stubs and injected `ExecutionContext` work as they do in the bot. Pass the arguments dispatch would: the interaction, message or reaction, then the handler's params. An interaction must be one dispatch routes to the handler: a customId its pattern matches, or the command or subcommand path it handles. One that could not, such as `'something/else'` for `'profile/{id}'`, rejects with a message naming both, so a typo in a test does not pass silently. The check ranks every handler of the module, as dispatch does, so a customId dispatch gives to another handler, such as `'card/summary'` beside `'card/{id}'`, rejects naming the handler that runs, and a handler gets the params of the route dispatch picks. A mock built without a customId or command name is not checked. A message passed alone to a [patterned `@MessageHandler`](#message-commands) is checked the same way, and the handler gets the params its pattern captures, after the prefix of the module's `app`: `invoke(DiceController, 'roll', createMockMessage({ content: '!roll 20' }))`. The check ranks every handler of the module, as dispatch does, so a message dispatch gives to another handler, such as `'roll 20'` beside `'roll {sides}'`, rejects naming the handler that runs. [Typed params](#typed-params) are resolved as dispatch resolves them, from the message's caches: a member, user, role or channel the content mentions is cached with the message, `createMockMessage({ content: '!pay 111111111111111111 25', guild: createMockGuild({ members: [member] }) })` puts `member` in the cache an id is read from, `guild: null` makes a DM, and a word that is not a value of its type, or a prefixed message that names the command but leaves out a param, goes through the handler's filters as the `MessageUsageError` the user would be shown.

```typescript
import { ButtonInteraction } from 'discord.js'
import { createMockInteraction, MeoCordTestingModule } from 'meocord/testing'

const module = MeoCordTestingModule.create({ controllers: [ProfileController] }).compile()
const interaction = createMockInteraction(ButtonInteraction, { customId: 'profile/111/8000' })

// Someone other than the owner clicked, so the owner guard denies the call.
const { ran } = await module.invoke(ProfileController, 'showProfile', interaction, { ownerId: '111', uid: '8000' })

expect(ran).toBe(false)
expect(interaction.reply).not.toHaveBeenCalled()
```

To include the global guards, interceptors and filters of `@MeoCord`, pass the application class as `app`. Only those are read; controllers and providers are still listed as usual:

```typescript
import App from '@src/app'

const module = MeoCordTestingModule.create({ app: App, controllers: [ProfileController] }).compile()
await module.invoke(ProfileController, 'showProfile', interaction, { ownerId: '111', uid: '8000' }) // global guards run first
```

`invoke` resolves to `{ ran }`, which is `false` when a guard denied the call or an interceptor skipped the handler, with `error` set when a filter handled one. To test which handler an input reaches, rather than a handler you name, use [`dispatch`](#sending-input-through-the-bot-with-dispatch). An error no filter handles rejects the call, since the built-in fallback does not run in tests. The method name and arguments are type-checked against the handler. Calling the controller method directly runs its guards but no interceptors, validation or filters; `invoke` is the way to test everything dispatch runs around a handler.

Pass the interaction alone and `invoke` builds the params as dispatch does: a command's or an autocomplete's options, or the handler's customId params with a modal's fields or a select menu's choices, from the mock's `values`, `users`, `members`, `roles` and `channels`. `createModalFields({ body: 'It crashed' })` gives a mock `ModalSubmitInteraction` its submitted fields, which discord.js does not let a test construct.

To send a client event to the module's `@On` and `@Once` handlers, use [`emit`](#gateway-events).

To check what a handler is set up with, without running it, use `inspectHandler`. It lists the guards, interceptors, filters and cooldowns dispatch applies, in order, gives a message handler's `pattern`, and reads the handler's metadata as `ExecutionContext` does:

```typescript
import { inspectHandler } from 'meocord/testing'

const ban = inspectHandler(ModerationController, 'ban')

expect(ban.guards).toEqual([RolesGuard, { provide: RateLimitGuard, params: { limit: 2 } }])
expect(ban.get(Roles)).toEqual(['admin'])

// With the app, the global guards come first
expect(inspectHandler(ModerationController, 'ban', { app: App }).guards[0]).toBe(BlocklistGuard)
```

### Sending input through the bot with `dispatch`

`invoke` tests one handler you name. `module.dispatch(input)` tests what the bot does with an input: it routes an interaction, a message or a reaction over the module's controllers, with its `app`'s message options, exactly as the bot routes it, and runs each handler it reaches through the full pipeline. Use it to check which handler a customId, a command or a message reaches, with which params, and what the user is sent:

```typescript
import { ButtonInteraction, type Message } from 'discord.js'
import { createMockInteraction, createMockMessage, MeoCordTestingModule } from 'meocord/testing'
import App from '@src/app'

const module = MeoCordTestingModule.create({ app: App, controllers: [ProfileController, DiceController] }).compile()

// The most specific pattern wins, as in the bot
const { handlers } = await module.dispatch(
  createMockInteraction(ButtonInteraction, { customId: 'profile/summary/111/8000' }),
)
expect(handlers).toEqual([{ controller: ProfileController, method: 'showSummary', ran: true }])

// A misused command gets the usage reply the user would see
const message = createMockMessage({ content: '!roll lots' })
const { error } = await module.dispatch(message)
expect(error).toBeInstanceOf(MessageUsageError)
expect(message.reply).toHaveBeenCalledWith(
  expect.objectContaining({ content: expect.stringContaining('Usage: !roll') }),
)

// A reaction, with the user who reacted; added unless an action is given
await module.dispatch(reaction, { user, action: ReactionHandlerAction.REMOVE })
```

- **What it resolves to.** `ran` says whether any handler ran, and `handlers` lists each one reached, in the order it ran, with its own `ran` and `error`. A message can reach a patterned handler and every `@MessageHandler()` listener, and a reaction several handlers.
- **What the user sees.** The handler's answer, a usage reply, and the built-in fallback's answer to an error no filter handles are all sent to the mock, as the bot sends them.
- **Errors.** An error the fallback answers as the user's own outcome resolves, in `error`: a usage reply, an unknown command, or the refusal of a guard, a cooldown, a validation or a `UserError`, as the fallback answers each for an interaction or a message. Any other error no filter handles rejects the call once the fallback has answered, so a bug in a handler does not pass silently; `invoke` rejects without running the fallback.
- **What it skips.** Whatever the bot skips reaches nothing, such as a message from a bot or a reaction from one to a handler without `bots: true`: `{ ran: false, handlers: [] }`.
- The module waits for its [observers](#observers) before the call resolves.

<details>
<summary><b><code>createMockInteraction</code></b></summary>

Creates a smart mock instance of any discord.js class. The full prototype chain is preserved so `instanceof` checks pass at every level.

**Type guards run real logic** — `isButton()`, `isRepliable()`, `isChatInputCommand()`, etc. are backed by the actual discord.js prototype methods. The right fields (`type`, `componentType`, `commandType`) are set based on the class you pass in, so no manual `.mockReturnValue(true)` setup is needed. All type guard methods are still mock functions and can be overridden per test.

**Ids like Discord's** — an interaction has an `id`, a `channelId` and a `user` (a person, not a bot) with an `id`, each a snowflake-shaped string no other mock in the test run has, so two mocks are two users, and a per-user cooldown counts them apart. `createMockUser()`, `createMockGuild()`, `createMockChannel()` and `createMockMessage()` get ids the same way; a message's `guildId` and `channelId` are its `guild`'s and `channel`'s. Ids given to the mock are kept.

**Guild checks read the mock's data** — `inGuild()`, `inCachedGuild()` and `inRawGuild()` answer from the `guildId` and `guild` the mock is given, as discord.js does: a `guildId` means a guild, a `guildId` with a `guild` (such as `createMockGuild()`) a cached one, and a mock created without a `guildId` is a DM, where all three return `false` and `guildId`, `guild` and `member` are `null`. A `member` set to `null` or `undefined` makes all three `false` too. Its `locale` is `'en-US'`, and its `guildLocale` is `'en-US'` with a `guildId` and `null` without, as Discord sends them; pass either to change it.

**Reply state machine** — for repliable interactions, `replied` and `deferred` start as `false`. Calling `reply()` or `deferReply()` twice throws, just like a real interaction. `followUp()`, `editReply()`, and `deleteReply()` throw if called before any reply. The ephemeral flag is tracked on `interaction.ephemeral`, read from `flags` only — the deprecated `ephemeral: true` reply option is not honoured. All reply methods are still mock functions so call assertions work normally.

Autocomplete interactions are not repliable but get the equivalent for their own single-shot response: `responded` starts as `false`, `respond()` sets it, and a second call throws, as does a list of more than 25 choices, which Discord refuses.

Guards discord.js has deprecated are deliberately left unwired — `isSelectMenu()` returns `undefined` rather than reproducing behaviour the library is removing. Use `isStringSelectMenu()`.

> **Framework-agnostic** — the mocks returned here are plain mock functions that stamp `_isMockFunction` and expose `.mock.calls`, the exact contract both `jest` and `vitest` check. Use them with either framework's `expect(...).toHaveBeenCalledWith(...)` / `toHaveBeenCalledTimes(...)` — no jest or vitest import is required to produce them. For typed stubs in your own code, import `MockedFunction`, `createMockFn`, and `DeepMocked` from `meocord/testing`.
>
> **Resetting between tests** — Vitest's `clearMocks` and jest's `clearAllMocks()` reach only their own `vi.fn()` and `jest.fn()`. `clearAllMocks()` from `meocord/testing` clears the calls of every mock it made, and `resetAllMocks()` also undoes what a test set with `mockReturnValue`, `mockResolvedValue` and the rest, back to how each mock was created. Generated projects call `resetAllMocks()` after every test from `vitest.setup.ts`, so set a mock's behaviour in the test, or in `beforeEach`, that relies on it.

```typescript
import { createMockInteraction } from 'meocord/testing'
import { ChatInputCommandInteraction, ButtonInteraction, BaseInteraction } from 'discord.js'

const interaction = createMockInteraction(ChatInputCommandInteraction)

// instanceof works at every level
expect(interaction).toBeInstanceOf(ChatInputCommandInteraction) // true
expect(interaction).toBeInstanceOf(BaseInteraction) // true

// type guards work — no manual setup needed
interaction.isChatInputCommand() // → true
interaction.isRepliable() // → true
interaction.isButton() // → false

// created without a guildId, the mock is a DM
interaction.inGuild() // → false
interaction.inCachedGuild() // → false

// reply state machine
interaction.replied // → false
await interaction.reply({ content: 'hi' })
interaction.replied // → true
await interaction.reply({ content: 'again' }) // → throws (already replied)

// still a mock fn — call assertions work normally
expect(interaction.reply).toHaveBeenCalledWith({ content: 'hi' })

// direct property writes work normally
interaction.guildId = 'guild-123'
```

Works for any discord.js class — interactions, `Message`, `MessageReaction`, and anything else. No per-type maintenance.

**Assignable to the real class** — the returned mock can be passed straight to code that expects the discord.js type. No `as unknown as ButtonInteraction` at the call site.

```typescript
const interaction = createMockInteraction(ButtonInteraction)

await controller.handleButton(interaction) // takes a real ButtonInteraction
```

**Property overrides at construction** — pass a second argument to set properties as the mock is built. This is required for anything discord.js declares `readonly` (`ModalSubmitInteraction#customId` and `#fields`, `MessageComponentInteraction#message`, `client`, `guildId` on some classes), since those cannot be assigned afterwards. It is also how you set a property backed by a getter-only prototype accessor, such as `targetUser` or `targetMessage` on a context menu.

```typescript
import { createMockInteraction, createMockUser } from 'meocord/testing'
import { ModalSubmitInteraction, UserContextMenuCommandInteraction } from 'discord.js'

const modal = createMockInteraction(ModalSubmitInteraction, {
  customId: 'wish-import-800000000',
  fields: { getTextInputValue: () => '{"pulls":[]}' } as unknown as ModalSubmitInteraction['fields'],
})

const contextMenu = createMockInteraction(UserContextMenuCommandInteraction, {
  commandName: 'profile',
  targetUser: createMockUser(),
})
```

The override record is typed as `MockProps<T>`, exported from `meocord/testing`. Every key is optional, and a misspelled property name is a compile error.

</details>

<details>
<summary><b><code>createChatInputOptions</code></b></summary>

Builds a typed options resolver from a plain record. Type routing mirrors the real `CommandInteractionOptionResolver`: wrong-type access returns `null`, `required=true` throws if the option is absent.

```typescript
import { createMockInteraction, createChatInputOptions } from 'meocord/testing'
import { ChatInputCommandInteraction } from 'discord.js'

const interaction = createMockInteraction(ChatInputCommandInteraction)
interaction.options = createChatInputOptions({
  subcommandGroup: 'admin',
  subcommand: 'ban',
  user: { id: '123456789' },
  reason: 'spam',
  duration: 7,
})

interaction.options.getSubcommandGroup() // → 'admin'
interaction.options.getSubcommand(true) // → 'ban'
interaction.options.getUser('user') // → { id: '123456789' }
interaction.options.getString('reason') // → 'spam'
interaction.options.getNumber('duration') // → 7
interaction.options.getString('duration') // → null (wrong type)
interaction.options.getNumber('x', true) // → throws (absent + required)
```

`data` is materialised too, nested under the subcommand path exactly as Discord sends it. That is what the framework reads to build a handler's second argument, so a params assertion sees the same record production would:

```typescript
interaction.options.data
// → [{ name: 'admin', type: SubcommandGroup, options: [{ name: 'ban', type: Subcommand, options: [...] }] }]
```

Entity options are set on both `value` (the snowflake) and their own resolved field, so a handler that reads only one of the two is caught rather than silently passing. Pass a `createMockInteraction(User, …)`, `Role`, channel or `Attachment` mock and it lands on `user`/`role`/`channel`/`attachment`.

For autocomplete, `focused` names the option being typed:

```typescript
const interaction = createMockInteraction(AutocompleteInteraction)
interaction.options = createChatInputOptions({ focused: 'query', query: 'ad' })

interaction.options.getFocused(true) // → { name: 'query', value: 'ad', focused: true, … }
interaction.options.getFocused() // → 'ad'
```

Omit it and `getFocused` throws, the same as the real resolver does when no option is focused.

`subcommandGroup`, `subcommand` and `focused` are reserved keys — an option of your own cannot use those names.

All methods are mock functions — override any per test with `.mockReturnValue()`.

</details>

<details>
<summary><b><code>createMockUser</code> / <code>createMockClient</code> / <code>createMockGuild</code> / <code>createMockChannel</code></b></summary>

Convenience wrappers for common discord.js classes. All methods are auto-stubbed as mock functions. Nested managers (`client.users`, `guild.members`, etc.) are independent nested stubs.

A method that returns a promise in discord.js resolves, so `await` and `.catch()` work without setup: `send()` and `reply()` to a mock `Message`, a manager's `fetch(id)`, `create()` and `edit()` to a mock of its item (`users.fetch(id)` to a `User`, `guild.members.fetch(id)` to a `GuildMember`), a list fetch such as `members.fetch()` to an empty `Collection`, `createDM()` to a `DMChannel`, and a structure's own `edit()`, `fetch()` and setters to the structure itself. Any other such method resolves to `undefined`. `mockResolvedValue` and `mockRejectedValue` still decide per test.

```typescript
import { createMockFn, createMockUser, createMockClient, createMockGuild, createMockChannel } from 'meocord/testing'
import { TextChannel } from 'discord.js'

const user = createMockUser()
const client = createMockClient()
const guild = createMockGuild()
const channel = createMockChannel(TextChannel)

// override nested manager methods per test (createMockFn works with vitest and jest matchers)
;(client.users as any).fetch = createMockFn(() => Promise.resolve(user))
await (client.users as any).fetch('user-123')
expect((client.users as any).fetch).toHaveBeenCalledWith('user-123')
```

`createMockChannel` sets up the managers each channel class has: `messages`; `threads` on text, announcement, forum and media channels; and `members` on a `ThreadChannel`. A subclass gets those of the class it extends.

```typescript
import { TextChannel, ThreadChannel } from 'discord.js'

const text = createMockChannel(TextChannel)
const thread = createMockChannel(ThreadChannel)
// discord.js types a created thread as public or private, not as the ThreadChannel class
text.threads.create.mockResolvedValue(thread as never)
```

</details>

<details>
<summary><b><code>createMockMessage</code></b></summary>

Creates a smart mock `Message`. Tracks a `deleted` boolean — `delete()`, `edit()`, `reply()`, `react()`, `pin()`, and `unpin()` throw if the message has already been deleted. `edit()` and `reply()` resolve to a new mock `Message` instance. All methods are mock functions.

```typescript
import { createMockMessage } from 'meocord/testing'

const msg = createMockMessage()

msg.deleted // → false
await msg.delete()
msg.deleted // → true
await msg.delete() // → throws (already deleted)
await msg.edit({ content: 'x' }) // → throws (already deleted)

// edit() and reply() resolve to a new Message mock
const edited = await createMockMessage().edit({ content: 'updated' })
edited.delete // → a mock fn

// still a mock fn — assertions work
expect(msg.delete).toHaveBeenCalledTimes(1)
```

Without arguments the message is empty, and its author is a user rather than a bot, so dispatch and `invoke` handle it. Give it an `id`, `content`, `components`, `embeds` and `flags` to test code that reads them, such as a button on a message whose controls `@Defer` locks. Components and embeds may be API JSON, builders or discord.js instances, and `flags` a number, flag names or a `MessageFlagsBitField`:

```typescript
const message = createMockMessage({
  components: [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('card/refresh').setLabel('Refresh').setStyle(ButtonStyle.Primary),
    ),
  ],
  embeds: [{ title: 'Card' }],
  flags: MessageFlags.Ephemeral,
})
const interaction = createMockInteraction(ButtonInteraction, { customId: 'card/refresh', message })
```

API JSON and builders are kept as their JSON behind `toJSON()`, which is what `respond()` and `@Defer` read; discord.js instances are kept as they are.

What the content mentions is cached as the gateway delivers it with the message: `<@id>` puts a user in `message.client.users.cache`, and in a guild a member in `guild.members.cache`; `<@&id>` a role in `guild.roles.cache`; `<#id>` a channel in `guild.channels.cache`. Each is in `message.mentions` too. A bare id is not cached, as a bot has to fetch it. `users` puts more users in the client's cache, `guild` gives the guild, with its own members, roles and channels, and `client` the client the message arrived on:

```typescript
const message = createMockMessage({ content: '!ban <@111111111111111111> spam' })
message.guild!.members.cache.get('111111111111111111') // → a mock member, as dispatch reads it
```

Every mock client, and so every mock message, belongs to one bot whose id is `createMockClient().user.id`, so a message that starts with a mention of the bot reaches a handler through `invoke` as it would in the bot: ``createMockMessage({ content: `<@${createMockClient().user!.id}> ping` })``.

</details>

<details>
<summary><b><code>resolveRoute</code> / <code>findRouteConflicts</code></b></summary>

Tests which handler a component's customId or a message's content reaches — the same answer dispatch
gives, across every controller your app registers, most specific pattern first. They read decorator metadata only, so
they need no Discord client, config or container. They check routing alone: guards are not run, and
whether a controller's dependencies are bound is for `MeoCordTestingModule` to test.

```typescript
import { findRouteConflicts, resolveRoute } from 'meocord/testing'
import { CommandType } from 'meocord/enum'
import App from '@src/app'
import { ProfileController } from '@src/controllers/button/profile.button.controller'

it('routes the profile button to its handler', () => {
  const route = resolveRoute(App, { type: CommandType.BUTTON, customId: 'profile/111/8000' })

  // The method itself rather than its name, so renaming it in your editor updates the test too.
  expect(route?.handler).toBe(ProfileController.prototype.showProfile)
  expect(route?.params).toEqual({ ownerId: '111', uid: '8000' })
})

// A message, after the prefix @MeoCord({ messages }) configures
it('routes !roll to the dice handler', () => {
  expect(resolveRoute(App, { content: '!roll 20 for luck' })?.params).toEqual({ sides: '20', note: 'for luck' })
})

// Patterns that can match the same customId, as a failing test rather than a startup warning. Two
// handlers with the same pattern make it throw, as the bot refuses to start with them.
it('has no overlapping component patterns', () => {
  expect(findRouteConflicts(App)).toEqual([])
})
```

`resolveRoute` returns the `controller`, the `handler` method and its name as `method`, the
`params` the pattern captured, as text — or `undefined` when no route handles the customId or message. A
route with a [typed customId param](#typed-customid-params) adds `values`, the params as its handler
receives them, each typed one as its value. A
message never resolves to a `@MessageHandler()` listener, which runs for every message. For an app
that reads prefixes from a function, pass the one the message has, `{ content, prefix: '?' }`, and
pass `botId` for a message that mentions the bot.

</details>

<details>
<summary><b><code>createMock</code></b></summary>

Mocks any type without a runtime class — use it for the services a controller depends on. `createMockInteraction` needs a class to build a prototype chain from, which is what makes `instanceof` and the real type guards work; a service double needs none of that, and an injected dependency may be an interface that does not exist at runtime at all.

Every property is a mock fn, created on first access, so a double only declares what the test cares about. The result is assignable to `T`, so it goes straight into `useValue` with no cast — which matters because a class holding a `private` member (a logger, say) can never be satisfied by an object literal.

```typescript
import { createMock, MeoCordTestingModule } from 'meocord/testing'
import { GreetingService } from '@src/services/greeting.service.js'

const greetingService = createMock<GreetingService>()
greetingService.buildGreeting.mockResolvedValue('Hello, Alice!')

const module = MeoCordTestingModule.create({
  controllers: [GreetingSlashController],
  providers: [{ provide: GreetingService, useValue: greetingService }],
}).compile()

expect(greetingService.buildGreeting).toHaveBeenCalledWith('Alice')
```

Nested access works without declaring the shape first — `cache.store.flush()` is a mock fn on a mock fn. Properties passed as `createMock<T>({ ... })` are used exactly as given rather than wrapped, so call assertions do not apply to those.

</details>

<details>
<summary><b><code>overrideGuard</code></b></summary>

Replaces a guard class in the DI container with a stub. No guard dependencies need to be provided.

```typescript
const module = MeoCordTestingModule.create({
  controllers: [GreetingSlashController],
  providers: [{ provide: GreetingService, useValue: mockGreetingService }],
})
  .overrideGuard(MetricsGuard)
  .useValue({ canActivate: () => true })
  .overrideGuard(RateLimitGuard)
  .useValue({ canActivate: () => true })
  .compile()
```

`canActivate: () => true` allows the method to run. `() => false` blocks it. Multiple guards chain fluently.

</details>

<details>
<summary><b><code>overrideInterceptor</code></b></summary>

Replaces an interceptor with a stub wherever it applies — globally, on a controller or on a method. Call `next.handle()` in the stub to run the handler, or return without it to skip the handler.

```typescript
const module = MeoCordTestingModule.create({ app: App, controllers: [ProfileController] })
  .overrideInterceptor(CacheInterceptor)
  .useValue({ intercept: (_context, next) => next.handle() })
  .compile()
```

</details>

<details>
<summary><b><code>overrideFilter</code></b></summary>

Replaces an exception filter with a stub wherever it applies. The filter's `@Catch` still decides which errors reach the stub.

```typescript
const catchRateLimit = createMockFn()
const module = MeoCordTestingModule.create({ controllers: [ProfileController] })
  .overrideFilter(RateLimitedFilter)
  .useValue({ catch: catchRateLimit })
  .compile()
```

</details>

<details>
<summary><b><code>getResponse</code> / <code>createDiscordError</code></b></summary>

`getResponse(interaction)` reports what `respond()` did for an interaction: where its answer stands, whether anything visible was sent, and every Discord call it made with its payload.

```typescript
import { createDiscordError, getResponse } from 'meocord/testing'

await module.invoke(ProfileController, 'refresh', interaction, { uid: '8000' })

const response = getResponse(interaction)
expect(response.sent).toBe(true)
expect(response.calls.map(call => call.method)).toEqual(['deferUpdate', 'editReply'])
```

A call Discord refused stays in `calls`, in the order it was made, with the error it rejected with as `error`, and does not count towards `sent`. A reply refused with 10062 reports `sent: false`, and an edit that fell back to the channel after an expired token lists the refused `editReply` before the `message.edit` that went through.

`createDiscordError(code)` builds the `DiscordAPIError` discord.js throws, for a mock to reject with: 10062 (the three seconds passed), 40060 (already acknowledged), 50001 (missing access), 50027 (the fifteen-minute token expired). Mock interactions take `context` and `authorizingIntegrationOwners`, to test each place a user-installed app can be used:

```typescript
const interaction = createMockInteraction(ButtonInteraction, {
  context: InteractionContextType.PrivateChannel,
  // discord.js gives AuthorizingIntegrationOwners a private constructor; a plain map stands in for it
  authorizingIntegrationOwners: { [ApplicationIntegrationType.UserInstall]: '123456789012345678' },
})
interaction.editReply.mockRejectedValueOnce(createDiscordError(50027))
```

</details>

<details>
<summary><b><code>overrideProvider</code></b></summary>

Replaces a provider already registered on the module. The value is typed as `Partial<T>`, so a double only has to cover the methods the test exercises — a class with a private member could never be satisfied by a full object literal anyway. A misspelled method name is still a compile error.

```typescript
const module = MeoCordTestingModule.create({
  controllers: [GreetingSlashController],
  providers: [{ provide: GreetingService, useValue: realGreetingService }],
})
  .overrideProvider(GreetingService)
  .useValue({ buildGreeting: createMockFn() })
  .compile()
```

</details>

<details>
<summary><b>Full example</b></summary>

```typescript
import {
  MeoCordTestingModule,
  createMockFn,
  createMockInteraction,
  createChatInputOptions,
  getResponse,
  type MockedFunction,
  type TestingModule,
} from 'meocord/testing'
import { ChatInputCommandInteraction } from 'discord.js'
import { GreetingSlashController } from '@src/controllers/slash/greeting.slash.controller.js'
import { GreetingService } from '@src/services/greeting.service.js'

describe('GreetingSlashController', () => {
  let module: TestingModule
  let greetingService: { buildGreeting: MockedFunction<GreetingService['buildGreeting']> }

  beforeEach(() => {
    greetingService = { buildGreeting: createMockFn() }

    module = MeoCordTestingModule.create({
      controllers: [GreetingSlashController],
      providers: [{ provide: GreetingService, useValue: greetingService }],
    }).compile()
  })

  it('replies with a greeting for the provided name', async () => {
    greetingService.buildGreeting.mockResolvedValue('Hello, Alice!')

    const interaction = createMockInteraction(ChatInputCommandInteraction)
    interaction.options = createChatInputOptions({ name: 'Alice' })

    // Runs the handler as the bot does: guards, interceptors, validation, cooldowns and filters
    await module.invoke(GreetingSlashController, 'greet', interaction)

    expect(greetingService.buildGreeting).toHaveBeenCalledWith('Alice')
    expect(getResponse(interaction).calls).toEqual([
      { method: 'reply', payload: expect.objectContaining({ content: 'Hello, Alice!' }) },
    ])
  })
})
```

</details>

---

## Deployment

Install all dependencies and build for production:

```shell
npm ci && npx meocord build --prod
```

Strip dev dependencies:

```shell
npm ci --omit=dev      # npm
yarn install --production  # yarn
pnpm install --prod    # pnpm
bun install --production   # bun
```

Required files on the server:

```
dist/
node_modules/   (production only)
package.json
.env            (if used)
<lockfile>
```

Start in production:

```shell
npx meocord start --prod
```

`meocord start` passes SIGINT and SIGTERM on to the bot, so it shuts down cleanly whether the signal comes from a terminal, Docker, pm2 or systemd. A second signal more than a second after the first is passed on too, and if the bot is still running two seconds later, `start` kills it and exits 1. In a container, `CMD ["node", "dist/main.js"]` is the lean choice: the bot is the only process, and it receives the signal itself.

### Self-contained builds

By default `dist/main.js` imports its dependencies at runtime, which is why the server needs `node_modules`. Set `bundleDependencies` and the build puts everything the bot needs inside `dist` instead:

```typescript
import { type MeoCordConfig } from 'meocord/interface'

export default {
  discordToken: process.env.DISCORD_TOKEN!,
  bundleDependencies: true,
} satisfies MeoCordConfig
```

Deploying is then copying `dist/` — no `node_modules` beside it, no install step:

```
dist/
├── main.js
├── assets/
├── node_modules/          (native addons only, if you use any)
├── package.json
└── meocord.platform.json  (if there are native addons)
```

Plain JavaScript dependencies are bundled into `main.js`. **Native addons** — packages that ship a compiled `.node` binary, like `sharp`, canvas bindings or database drivers — cannot be inlined into JavaScript, so MeoCord finds them itself while building, keeps them out of the bundle, and copies each one, with its platform binary and what it needs at runtime, into `dist/node_modules`. There is nothing to list: the build tells you which it packed. Only binaries for the platform building are copied, going by the `os`, `cpu` and `libc` each platform package declares — so a glibc build carries no musl binaries even where the package manager installed both, as bun does.

```
Native addons packed into dist: meo-canvas, sharp
dist/node_modules holds 7 packages; nothing else to install.
```

**Build on the platform you deploy to.** A compiled binary only loads on the operating system, CPU and C library it was built for — a build made on a Mac carries macOS binaries, and a Debian (glibc) binary does not load on Alpine (musl). For a container, run `meocord build` inside the image. The build records its platform in `meocord.platform.json`, and a bot started somewhere else stops before going online with a message naming both, instead of failing on the first command that renders an image.

Use `externals` for anything you want kept out of the bundle for another reason; those are copied into `dist/node_modules` too. A package a dependency only tries to load, such as `supports-color`, belongs in [`optionalExternals`](#meocordconfigts) instead: it is packed if you installed it and skipped by the dependency if you did not, as discord.js's own optional accelerators — `zlib-sync`, `bufferutil`, `utf-8-validate` — always are.

**On bun, keep it from installing at runtime.** With no `node_modules` in reach, bun downloads any package the moment something imports it. `meocord start` passes `--no-install` for you. If you launch the bundle yourself, pass it too:

```dockerfile
CMD ["bun", "--no-install", "dist/main.js"]
```

### Which runtime the bot runs on

`start` runs the bot on **the runtime you launched it with**. There is nothing to configure and no config key to set — if you typed `bun`, you get a bun process:

```shell
bun run start          # dist/main.js runs under bun
npm run start          # dist/main.js runs under node
```

Two signals decide it, most explicit first: the runtime executing the CLI, and — when the CLI itself was handed to node — the runner that launched it. `bun run` honours the bin's `#!/usr/bin/env node` shebang, so bun sets `npm_execpath` to its own binary and that is what the bot is spawned with. npm, pnpm and yarn point it at a `.js` file instead, which cannot run the bundle, so those fall through to node as expected.

That matters for more than tidiness. Pinning `node` would oblige a bun-only image to install a second runtime purely to launch, or to carry `--bun` on every command. It also decides the allocator: for a bot doing heavy native work — canvas rendering through a napi module, say — glibc's malloc and bun's mimalloc produce very different resident-memory curves on the same workload, because they differ in how eagerly freed pages go back to the OS.

Development works the same way. The watcher runs the bundle through the same command production does, so a runtime that works in `--dev` cannot quietly differ from the one that ships.

<details>
<summary><b>Running the CLI itself on bun</b></summary>

The resolution above decides what the _bot_ runs on. The CLI process is decided earlier,
by the interpreter line `#!/usr/bin/env node`, which nothing in the package can influence
— it is read before any of the program exists. On a machine with no node at all,
invoking the CLI directly fails before it starts:

```
$ meocord start --prod
env: node: No such file or directory
```

That line stays as it is because Windows depends on it: npm there never runs the file
through its shebang, it parses the line and writes a `.cmd` invoking the program named in
it. `#!/usr/bin/env node` yields `node`; anything else yields a program Windows cannot
resolve.

So on a bun-only image, tell bun to ignore the line. Either per command:

```shell
bun --bun meocord start --prod
```

or once for the project, which is what a bun-only Dockerfile wants:

```toml
# bunfig.toml
[run]
bun = true
```

Then plain `bun run start` runs the CLI and the bot on bun, and node need not exist.

</details>

<details>
<summary><b>Pinning a specific binary</b></summary>

To override both signals — a particular install, or a different runtime for comparison — set `MEOCORD_RUNTIME`:

```shell
MEOCORD_RUNTIME=/usr/local/bin/bun npm run start
```

</details>

### Sharding

Discord requires a bot in more than about 2,500 servers to split its gateway connection into shards. Turn it on in `meocord.config.ts`:

```typescript
import { type MeoCordConfig } from 'meocord/interface'

export default {
  discordToken: process.env.DISCORD_TOKEN!,
  sharding: { shards: 'auto' }, // or a number
} satisfies MeoCordConfig
```

By default every shard runs in one process, in one client: one set of services, `onReady` once, commands registered once, and nothing else changes. Unset, `sharding` leaves `clientOptions.shards` as you set it.

For a bot that needs more than one CPU core, `mode: 'process'` runs each shard in a process of its own. Start the bot as usual — `meocord start`, `node dist/main.js`, bun, pm2 or Docker all behave the same — and the first process becomes a manager that:

- registers the commands once, over REST, then spawns the shards one after another from the built bundle, with the same runtime flags (such as bun's `--no-install`);
- restarts a shard that exits, waiting 1 second, then 2, 4 and so on up to a minute, and from the start again once a shard has stayed up for five minutes;
- stops everything and exits 1 when a shard cannot log in because the token is invalid or Discord refuses its intents, as disallowed or invalid, instead of restarting it forever, and says which privileged intents to enable;
- on SIGINT or SIGTERM, asks each shard to shut down through its `onShutdown` hooks, waits up to `shutdownTimeout` plus five seconds, and kills any shard still running — on Windows too. A second signal more than a second after the first kills them at once.

Each shard process runs the whole application with its own container, and its lifecycle hooks run in it; `onReady`'s `primary` is `true` only in the process running shard 0. Under `meocord start --dev`, process mode is off and every shard runs in one process, so the watcher restarts a single process; set `sharding.development: true` to run separate processes there too.

To reach every shard, inject `ShardContext` from `meocord/core`:

```typescript
import { Service } from 'meocord/decorator'
import { ShardContext } from 'meocord/core'
import { Client } from 'discord.js'

@Service()
export class StatsService {
  constructor(
    private readonly shards: ShardContext,
    private readonly client: Client,
  ) {}

  guildCount() {
    return this.client.guilds.cache.size
  }

  async totalGuilds() {
    const results = await this.shards.call(StatsService, 'guildCount')
    return results.reduce((sum, result) => sum + (result.ok ? result.value : 0), 0)
  }
}
```

`call(Service, 'method', ...args)` runs the method in every process, each resolving the service from its own container — the class you pass in this process, and a class of the same name in another, since only JSON crosses between them, so with process sharding the bot refuses to start when two controllers or services share a name — and resolves to one `{ shardIds, ok, value | error }` per process: one per shard with process sharding, one in all otherwise. Arguments and results cross processes as JSON. A process that throws, lacks the service or takes more than 10 seconds gives an error result instead of failing the others. `ids`, `count` and `isPrimary` describe the shards of this process. `broadcastEval` is there as well, but it turns its function into a string, which a minified bundle can break; prefer `call`.

---

## Contributing

Issues, questions, and pull requests are welcome. [CONTRIBUTING.md](./CONTRIBUTING.md) covers getting set up, what each check exists to catch, and how releases work — a change that reaches the published package carries a [changeset](https://github.com/changesets/changesets), and merging the release pull request is what publishes it.

Participation is governed by the [Code of Conduct](./CODE_OF_CONDUCT.md). For vulnerabilities, follow [SECURITY.md](./SECURITY.md) rather than opening an issue.

---

## Release Notes

Every release is recorded in [CHANGELOG.md](./CHANGELOG.md) and on the [GitHub Releases](https://github.com/meocord/meocord/releases) page. Upgrading: the [migration guide](https://github.com/meocord/meocord/blob/main/docs/MIGRATING.md).

---

## License

MeoCord is released under the [MIT License](./LICENSE), which covers the whole repository.

It builds on open-source packages under their own licenses, listed in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
