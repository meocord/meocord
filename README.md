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

**Documentation:** [meocord.dev](https://meocord.dev/docs/latest) · [Getting started](https://meocord.dev/docs/latest/getting-started) · [API reference](https://meocord.dev/docs/latest/api) · [Upgrading](https://meocord.dev/docs/latest/migrating) · [Changelog](https://meocord.dev/docs/latest/changelog)

## Why MeoCord?

Discord bots often start with a handful of event listeners and command handlers. As they grow, routing, permission checks, input parsing, error handling, shared services and tests end up scattered across the code. MeoCord gives them one structure, so a bot that grows stays readable.

### Answers that fit the interaction

Answering Discord means knowing where an interaction stands, and getting it wrong fails at runtime. `respond(interaction)` reads that state on every call, so a handler, a guard or an exception filter says what to send and MeoCord picks the Discord call. It also sees answers made directly with discord.js, and its answers work wherever the interaction happened, including user-installed apps in servers and direct messages the bot is not in.

### One structure for interactions, messages and events

Slash commands, components, modals, context menus, message commands, reactions and gateway events are all methods on controllers, routed by MeoCord, with services injected where they are needed.

### One pipeline around every handler

Guards, interceptors, validation, pipes, cooldowns and exception filters run in a fixed order around every handler, so a permission check or an error reply is written once and applies everywhere.

### Tested the way it runs

`meocord/testing` runs a handler through that same pipeline, with mocks that behave like discord.js, and no connection to Discord.

---

## Features

| Capability                         | What you get                                                                  |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| **Responses**                      | `respond()`: replies, updates, edits, follow-ups and errors, picked by state  |
| **Interactions, messages, events** | Decorated controller methods for every interaction, message command and event |
| **Message commands**               | Typed patterns, parameters, flags, lists and built-in help                    |
| **Execution pipeline**             | Guards, interceptors, validation, pipes, cooldowns and exception filters      |
| **Dependency injection**           | Services, providers, injection tokens and lifecycle hooks                     |
| **Testing**                        | The real pipeline without Discord, and mocks for every interaction            |
| **Command registration**           | Global, per guild, and to a development guild while you work                  |
| **CLI**                            | Scaffolding, generators, development and production builds, starting the bot  |
| **Deployment**                     | Rsbuild bundles, self-contained builds and sharding                           |

### Responses

`respond(interaction)` answers whatever the interaction's state is:

| The interaction is                         | `send()` does                |
| ------------------------------------------ | ---------------------------- |
| A command, not yet answered                | Replies                      |
| A component, not yet answered              | Updates the message it is on |
| Deferred with `acknowledge()`, or answered | Edits the answer             |

`followUp()` sends another message after the answer, `modal()` shows a modal, and `error()` presents an error through the application's presenter, in the form that fits the state, never throwing.

```typescript
@Controller()
export class ProfileController {
  constructor(private readonly profiles: ProfileService) {}

  @Command('profile', CommandType.SLASH)
  async profile(interaction: ChatInputCommandInteraction) {
    // A deferred reply: the profile may take longer than Discord's three seconds
    await respond(interaction).acknowledge()

    const embed = await this.profiles.render(interaction.user.id)

    // Deferred, so this edits the reply
    await respond(interaction).send({ embeds: [embed] })
  }
}
```

[Responses](https://meocord.dev/docs/latest/responses) · [Presenters](https://meocord.dev/docs/latest/presenters)

### Interactions, messages and events

Each of these is a method on a controller:

- Slash commands and subcommands, with autocomplete
- Buttons, and string, user, role, mentionable and channel select menus
- Modal submissions
- User and message context menus
- Activity entry points
- Message commands
- Message reactions
- Gateway events

[Slash commands](https://meocord.dev/docs/latest/slash-commands) · [Components](https://meocord.dev/docs/latest/components) · [Message commands](https://meocord.dev/docs/latest/message-commands) · [Gateway events](https://meocord.dev/docs/latest/gateway-events)

### The execution pipeline

| Stage             | Responsibility                                         |
| ----------------- | ------------------------------------------------------ |
| Guards            | Decide whether a handler runs                          |
| Interceptors      | Wrap the handler, and can change or replace its result |
| Validation        | Check the handler's input                              |
| Pipes             | Turn valid input into what the handler takes           |
| Cooldowns         | Limit how often a handler runs                         |
| Exception filters | Answer errors the handler throws                       |

Guards, interceptors and exception filters apply to a method, a controller or the whole app. Validation and pipes check a handler's input, and cooldowns go on a method or a controller.

```typescript
@Controller()
@UseGuard(StaffGuard)
@UseInterceptor(TimingInterceptor)
export class ModerationController {
  @Command('warn', CommandType.SLASH)
  @Cooldown({ uses: 3, seconds: 10 })
  async warn(interaction: ChatInputCommandInteraction) {
    await respond(interaction).send('Warned.')
  }
}
```

[How a call runs](https://meocord.dev/docs/latest/how-a-call-runs) · [Guards](https://meocord.dev/docs/latest/guards) · [Interceptors](https://meocord.dev/docs/latest/interceptors) · [Validation and pipes](https://meocord.dev/docs/latest/validation) · [Cooldowns](https://meocord.dev/docs/latest/cooldowns)

### Services and dependency injection

A service is a class with `@Service()`. A controller, or another service, asks for it in its constructor, and MeoCord builds it once and passes it in:

```typescript
@Service()
export class GreetingService {
  greet(name: string) {
    return `Hello, ${name}!`
  }
}

@Controller()
export class GreetController {
  constructor(private readonly greetings: GreetingService) {}

  @Command('greet', CommandType.SLASH)
  async greet(interaction: ChatInputCommandInteraction, { name }: { name: string }) {
    await respond(interaction).send(this.greetings.greet(name))
  }
}
```

Providers add values, classes and asynchronous factories under injection tokens.

[Services and providers](https://meocord.dev/docs/latest/services)

### Message commands

A pattern declares a message command's words, and the handler receives them typed:

```typescript
@MessageHandler('ban {target:member} {reason...?}')
async ban(message: Message, { target, reason }: { target: GuildMember; reason?: string }) {
  await target.ban({ reason })
  await message.reply(`Banned ${target.user.tag}.`)
}
```

[Message commands](https://meocord.dev/docs/latest/message-commands) · [Typed params, flags and lists](https://meocord.dev/docs/latest/message-params)

### Testing

`module.invoke()` runs a handler as the bot does, guards and all, and the mock records what the bot answered:

```typescript
import { ChatInputCommandInteraction } from 'discord.js'
import { respond } from 'meocord/common'
import { Command, Controller } from 'meocord/decorator'
import { CommandType } from 'meocord/enum'
import { createMockInteraction, MeoCordTestingModule } from 'meocord/testing'
import { expect } from 'vitest'

@Controller()
class GreetController {
  @Command('greet', CommandType.SLASH)
  async greet(interaction: ChatInputCommandInteraction, { name }: { name: string }) {
    await respond(interaction).send(`Hello, ${name}!`)
  }
}

const module = MeoCordTestingModule.create({ controllers: [GreetController] }).compile()
const interaction = createMockInteraction(ChatInputCommandInteraction)

await module.invoke(GreetController, 'greet', interaction, { name: 'Romeo' })
expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: 'Hello, Romeo!' }))
```

`module.dispatch()` routes an interaction or a message as the bot would, and `module.emit()` sends a gateway event. The mocks work under Vitest, Jest, Node's test runner and bun test.

[Testing](https://meocord.dev/docs/latest/testing) · [Mocks](https://meocord.dev/docs/latest/mocks)

### The CLI

```bash
npx meocord create my-bot          # a new project
npx meocord g co slash Greeting    # a slash command controller
npx meocord start --dev            # development, restarting on every change
npx meocord build                  # a production build
npx meocord start                  # the production build
npx meocord register               # register the commands without starting
```

A self-contained build packs the bot's runtime dependencies into its output, so the server needs no `node_modules`.

[CLI](https://meocord.dev/docs/latest/cli) · [Self-contained builds](https://meocord.dev/docs/latest/self-contained-builds) · [Sharding](https://meocord.dev/docs/latest/sharding)

---

## Getting started

### Requirements

| Requirement | Version                |
| ----------- | ---------------------- |
| Node.js     | 22.13 or newer         |
| Bun         | Supported              |
| discord.js  | 14.27 or a later 14.x  |
| dotenv      | 18.0.5 or a later 18.x |

MeoCord ships ESM and CommonJS builds. A new project is ESM.

### 1. Create a project

```bash
npx meocord create my-bot
cd my-bot
```

The CLI asks which installed package manager to use, or takes `--use-npm`, `--use-yarn`, `--use-pnpm` or `--use-bun`.

### 2. Run the sample

Put your bot token in `.env`, and the ID of a test server in `DEV_GUILD_ID`, so commands show there at once:

```bash
cp .env.example .env
npx meocord start --dev
```

The project comes with a sample of each controller type, a guard, a presenter, a service and a spec for each. Run `/sample-slash` in your test server to see one answer.

### 3. Write your first command

[Your first command](https://meocord.dev/docs/latest/first-command) builds one step by step. The complete example below is a whole bot in one file.

---

## Example

A slash command that greets whoever it names, at most three times in ten seconds per user:

```typescript
import { type ChatInputCommandInteraction, GatewayIntentBits, SlashCommandBuilder } from 'discord.js'

import { respond } from 'meocord/common'
import { Command, CommandBuilder, Controller, Cooldown, MeoCord } from 'meocord/decorator'
import { CommandType } from 'meocord/enum'

// What Discord registers: the name comes from @Command, so the two cannot drift apart
@CommandBuilder(CommandType.SLASH)
export class GreetCommandBuilder {
  build(commandName: string) {
    return new SlashCommandBuilder()
      .setName(commandName)
      .setDescription('Greets someone')
      .addStringOption(option => option.setName('name').setDescription('Who to greet').setRequired(true))
  }
}

@Controller()
export class GreetController {
  @Command('greet', GreetCommandBuilder)
  @Cooldown({ uses: 3, seconds: 10 })
  async greet(interaction: ChatInputCommandInteraction, { name }: { name: string }) {
    await respond(interaction).send({ content: `Hello, ${name}!` })
  }
}

@MeoCord({
  controllers: [GreetController],
  clientOptions: { intents: [GatewayIntentBits.Guilds] },
})
export default class App {}
```

Starting the bot registers `/greet` with Discord. `npx meocord register` registers it without starting the bot.

---

## Documentation

Everything else is on [meocord.dev](https://meocord.dev/docs/latest), for each version:

| To                                  | Read                                                                |
| ----------------------------------- | ------------------------------------------------------------------- |
| Learn MeoCord from the start        | [Getting started](https://meocord.dev/docs/latest/getting-started)  |
| Build a command step by step        | [Your first command](https://meocord.dev/docs/latest/first-command) |
| Look up a decorator, type or helper | [API reference](https://meocord.dev/docs/latest/api)                |
| Upgrade from 4.0, or from 3.x       | [Upgrading](https://meocord.dev/docs/latest/migrating)              |
| See what changed in each release    | [Changelog](https://meocord.dev/docs/latest/changelog)              |

## Support

- **Questions and ideas:** [GitHub Discussions](https://github.com/meocord/meocord/discussions)
- **Bugs and feature requests:** [GitHub Issues](https://github.com/meocord/meocord/issues)
- **Security vulnerabilities:** [SECURITY.md](./SECURITY.md)

## Contributing

Issues and pull requests are welcome. [CONTRIBUTING.md](./CONTRIBUTING.md) covers getting set up, what each check catches, and how releases work. Participation follows the [Code of Conduct](./CODE_OF_CONDUCT.md).

## License

MeoCord is released under the [MIT License](./LICENSE). It builds on open-source packages under their own licenses, listed in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

<p align="center">
  <strong>MeoCord</strong>: a decorator-based framework for Discord bots, built on discord.js.
  <br>
  <a href="https://meocord.dev/docs/latest/getting-started">Get started</a>
  ·
  <a href="https://meocord.dev/docs/latest/api">API reference</a>
  ·
  <a href="https://www.npmjs.com/package/meocord">npm</a>
</p>

## Moved sections

These sections moved to meocord.dev. Their headings stay here so that links from earlier release notes still land.

### Theming

[Theming](https://meocord.dev/docs/latest/theming) on meocord.dev.

### Themes per server and per user

[Themes per server and per user](https://meocord.dev/docs/latest/theming#per-server-and-per-user) on meocord.dev.

### Adding tokens of your own

[Adding tokens of your own](https://meocord.dev/docs/latest/theming#adding-tokens-of-your-own) on meocord.dev.

### Where calls are counted

[Where calls are counted](https://meocord.dev/docs/latest/cooldowns#where-calls-are-counted) on meocord.dev.

### Store recipes

[Cooldown stores](https://meocord.dev/docs/latest/recipes/cooldown-stores) on meocord.dev.

### Stack traces

[Stack traces](https://meocord.dev/docs/latest/configuration#stack-traces) on meocord.dev.

### Running tests

[Running tests](https://meocord.dev/docs/latest/testing#running-tests) on meocord.dev.
