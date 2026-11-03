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

Discord bots often start with a handful of event listeners and command handlers. As they grow, interaction routing, permission checks, validation, error handling, shared services, and testing can become responsibilities scattered throughout the application.

MeoCord brings those responsibilities into one consistent architecture.

Instead of building your own infrastructure around discord.js, you get an application framework designed to handle the entire lifecycle of your bot.

### One architecture for every Discord interaction

Build slash commands, autocomplete, buttons, select menus, modals, context menus, message commands, reactions, and gateway events with structured handlers.

### A unified execution pipeline

Every handler can participate in the same execution lifecycle: guards, interceptors, validation, pipes, cooldowns, and exception filters.

### Answers that fit the interaction

Answering Discord means knowing where an interaction stands. An unanswered command takes a reply, an unanswered component an update of its own message, and a deferred or answered interaction an edit. `respond(interaction).send()` reads that state on every call and picks the right one, so handlers, guards and exception filters say what to send, not how. It also sees answers made directly with discord.js, and its answers work wherever the interaction happened, including user-installed apps in servers and direct messages the bot is not in.

### Dependency injection built in

Organize business logic into reusable services and providers. Inject dependencies instead of manually instantiating and passing them around.

### Test without Discord

Execute handlers through the framework's testing module, including their guards, interceptors, validation, pipes, cooldowns, and exception filters. No live Discord connection required.

### Production tooling included

Scaffold applications and components, build with Rsbuild, register commands, run development workflows, and configure sharding through the MeoCord CLI.

---

## Features

| Capability                  | What you get                                                              |
| --------------------------- | ------------------------------------------------------------------------- |
| **Interaction controllers** | Decorator-based handlers for Discord interaction types                    |
| **Message commands**        | Typed command patterns, parameters, flags, and built-in help              |
| **Execution pipeline**      | Guards, interceptors, validation, pipes, cooldowns, and exception filters |
| **Dependency injection**    | Services, providers, injection tokens, and lifecycle hooks                |
| **Interaction responses**   | State-aware replies, edits, follow-ups, and presenters                    |
| **Gateway events**          | Typed event handlers with the same execution pipeline                     |
| **Testing utilities**       | Isolated handler execution and interaction mocks                          |
| **Command management**      | Registration for global, guild, and development commands                  |
| **CLI**                     | Project scaffolding, component generation, building, and execution        |
| **Production builds**       | Rsbuild, self-contained builds, and sharding                              |

### 1. Complete Discord interaction coverage

A Discord bot isn't just slash commands.

MeoCord provides a consistent controller-based approach to handling the interactions your application receives.

- Slash commands and subcommands
- Autocomplete
- Buttons
- String, user, role, mentionable, and channel select menus
- Modal submissions
- User and message context menus
- Activity entry points
- Message commands
- Message reactions
- Gateway events

Define handlers as methods and let MeoCord take care of dispatching the appropriate interaction.

[Explore Controllers](https://meocord.dev/docs/latest/slash-commands) · [Components](https://meocord.dev/docs/latest/components) · [Message Commands](https://meocord.dev/docs/latest/message-commands)

### 2. A unified execution pipeline

Handlers shouldn't have to implement their own permission checks, validation, rate limiting, and error handling.

MeoCord provides a consistent pipeline around handler execution.

| Stage             | Responsibility                                    |
| ----------------- | ------------------------------------------------- |
| Guards            | Decide whether a handler is allowed to execute    |
| Interceptors      | Wrap execution and modify or observe its result   |
| Validation        | Check incoming handler input                      |
| Pipes             | Transform validated input                         |
| Cooldowns         | Control how frequently a handler can execute      |
| Exception filters | Handle errors and determine how they are reported |

Guards, interceptors and exception filters apply to a method, a controller or the whole app. Validation and pipes check a handler's input, and cooldowns go on a method or a controller.

```typescript
@Controller()
@UseGuard(StaffGuard)
@UseInterceptor(TimingInterceptor)
export class ProfileController {
  @Command('profile', CommandType.SLASH)
  @Cooldown({ uses: 3, seconds: 10 })
  async profile(interaction: ChatInputCommandInteraction) {
    // Your application logic
  }
}
```

Each stage has a defined place in the execution lifecycle, making behavior predictable and reusable across your application.

[How a call runs](https://meocord.dev/docs/latest/how-a-call-runs) · [Guards](https://meocord.dev/docs/latest/guards) · [Interceptors](https://meocord.dev/docs/latest/interceptors) · [Validation and pipes](https://meocord.dev/docs/latest/validation) · [Cooldowns](https://meocord.dev/docs/latest/cooldowns)

### 3. Dependency injection and application services

Separate application logic from Discord interaction handlers.

MeoCord provides dependency injection for controllers, services, and providers, so your application can share reusable logic without manual instantiation.

```typescript
import { Service } from 'meocord/decorator'

@Service()
export class GreetingService {
  greet(name: string) {
    return `Hello, ${name}!`
  }
}
```

Inject services into controllers and other services to keep your application modular.

Providers also support values, classes, and asynchronous factories under injection tokens.

[Services and providers](https://meocord.dev/docs/latest/services)

### 4. Interaction-aware responses

Discord interactions have different response rules depending on their type and current state.

A command may need a reply. A component may need to update its original message. A deferred interaction needs an edit. A completed interaction may need a follow-up.

MeoCord's `respond()` abstraction handles these states for you.

```typescript
import { respond } from 'meocord/common'

@Controller()
export class ProfileController {
  constructor(private readonly profiles: ProfileService) {}

  @Command('profile', CommandType.SLASH)
  async profile(interaction: ChatInputCommandInteraction) {
    await respond(interaction).acknowledge()

    const embed = await this.profiles.render(interaction.user.id)

    await respond(interaction).send({ embeds: [embed] })
  }
}
```

You describe the response you want to send. MeoCord determines the appropriate Discord operation based on the interaction's current state.

The response abstraction also supports editing, follow-ups, deletion, modals, and presenter-based error responses.

[Responses](https://meocord.dev/docs/latest/responses) · [Presenters](https://meocord.dev/docs/latest/presenters)

### 5. Message commands with typed parameters

Not everything needs to be a slash command.

MeoCord supports message commands with parameter patterns, typed arguments, optional values, flags, and lists.

```typescript
@MessageHandler('ban {target:member} {reason...?}')
async ban(
  message: Message,
  { target, reason }: { target: GuildMember; reason?: string },
) {
  await target.ban({ reason })

  await message.reply(`Banned ${target.user.tag}.`)
}
```

The framework handles parsing and parameter extraction, so your handler receives structured values instead of manually parsing message content.

[Message Commands](https://meocord.dev/docs/latest/message-commands)

### 6. Test handlers without Discord

Testing Discord bot logic shouldn't require a running bot or a real Discord connection.

MeoCord includes a dedicated `meocord/testing` entry point for isolated application testing.

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

const { ran } = await module.invoke(GreetController, 'greet', interaction, { name: 'Romeo' })
expect(ran).toBe(true)
```

The testing module can execute handlers through their framework pipeline and provides mocks for Discord interaction types.

You can test:

- Handler execution
- Guards and interceptors
- Validation and pipes
- Cooldowns
- Exception filters
- Dependency injection
- Gateway event handlers

The mocks work under Vitest, Jest, Node's test runner and bun test.

[Testing](https://meocord.dev/docs/latest/testing) · [Mocks](https://meocord.dev/docs/latest/mocks)

### 7. CLI and production tooling

MeoCord includes a CLI for the entire development workflow.

```bash
# Create a new application
npx meocord create my-bot

# Generate a controller
npx meocord g co slash Greeting

# Build the application
npx meocord build

# Start the application
npx meocord start

# Register Discord commands
npx meocord register
```

The CLI provides:

- Project scaffolding
- Controller and component generation
- Development and production builds
- Command registration
- Rsbuild-powered bundling
- Self-contained builds
- Gateway sharding

Self-contained builds can package the bot's runtime dependencies into the build output, allowing deployment without installing `node_modules` on the target environment.

[CLI Reference](https://meocord.dev/docs/latest/cli) · [Self-contained Builds](https://meocord.dev/docs/latest/self-contained-builds) · [Sharding](https://meocord.dev/docs/latest/sharding)

---

## Getting Started

### Requirements

| Requirement | Version                |
| ----------- | ---------------------- |
| Node.js     | 22.13 or newer         |
| Bun         | Supported              |
| discord.js  | 14.27 or a later 14.x  |
| dotenv      | 18.0.5 or a later 18.x |

MeoCord supports ESM and CommonJS builds. Newly generated applications are configured for ESM.

### Create a project

```bash
npx meocord create my-bot
cd my-bot
```

The CLI detects your package manager and helps you configure the generated project.

You can also choose one explicitly:

```bash
npx meocord create my-bot --use-npm
npx meocord create my-bot --use-yarn
npx meocord create my-bot --use-pnpm
npx meocord create my-bot --use-bun
```

### Configure your bot

Copy the example environment file:

```bash
cp .env.example .env
```

Set your Discord bot token:

```env
DISCORD_TOKEN=your_discord_bot_token
```

### Start development

```bash
npx meocord start --dev
```

Your generated project includes example controllers, a guard, a presenter, a service, and tests to help you understand how the framework fits together.

Follow the [Getting Started guide](https://meocord.dev/docs/latest/getting-started) to configure your application and build your first command.

---

## Example

Here's a complete example of a slash command using a command builder, controller, cooldown, and interaction-aware response.

```typescript
import { type ChatInputCommandInteraction, GatewayIntentBits, SlashCommandBuilder } from 'discord.js'

import { respond } from 'meocord/common'
import { Command, CommandBuilder, Controller, Cooldown, MeoCord } from 'meocord/decorator'
import { CommandType } from 'meocord/enum'

// Define the command registered with Discord.
@CommandBuilder(CommandType.SLASH)
export class GreetCommandBuilder {
  build(commandName: string) {
    return new SlashCommandBuilder()
      .setName(commandName)
      .setDescription('Greets someone')
      .addStringOption(option => option.setName('name').setDescription('Who to greet').setRequired(true))
  }
}

// Handle the interaction.
@Controller()
export class GreetController {
  @Command('greet', GreetCommandBuilder)
  @Cooldown({ uses: 3, seconds: 10 })
  async greet(interaction: ChatInputCommandInteraction, { name }: { name: string }) {
    await respond(interaction).send({
      content: `Hello, ${name}!`,
    })
  }
}

// Bootstrap the application.
@MeoCord({
  controllers: [GreetController],
  clientOptions: {
    intents: [GatewayIntentBits.Guilds],
  },
})
export default class App {}
```

Start the bot and it registers `/greet` with Discord. `npx meocord register` registers commands without starting it.

For more examples, see the [documentation](https://meocord.dev/docs/latest).

---

## Documentation

The full documentation is available at **[meocord.dev](https://meocord.dev)**.

| Resource                                                            | Description                                 |
| ------------------------------------------------------------------- | ------------------------------------------- |
| [Getting Started](https://meocord.dev/docs/latest/getting-started)  | Create and configure your first application |
| [Your First Command](https://meocord.dev/docs/latest/first-command) | Build your first Discord command            |
| [API Reference](https://meocord.dev/docs/latest/api)                | Look up decorators, types, and helpers      |
| [Migration Guide](https://meocord.dev/docs/latest/migrating)        | Upgrade between framework versions          |
| [Changelog](https://meocord.dev/docs/latest/changelog)              | Explore changes and improvements            |

Documentation is versioned alongside MeoCord releases.

---

## Community and Support

Have a question, found a bug, or want to suggest an improvement?

- **Questions and ideas:** [GitHub Discussions](https://github.com/meocord/meocord/discussions)
- **Bug reports and feature requests:** [GitHub Issues](https://github.com/meocord/meocord/issues)
- **Security vulnerabilities:** Follow [SECURITY.md](./SECURITY.md)

---

## Contributing

Contributions are welcome!

Before submitting a pull request, read [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup, project checks, and release procedures.

Please also follow the project's [Code of Conduct](./CODE_OF_CONDUCT.md).

---

## License

MeoCord is released under the [MIT License](./LICENSE).

MeoCord builds on open-source packages distributed under their respective licenses. See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for details.

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

---

<p align="center">
  <strong>Build better Discord bots with MeoCord.</strong>
  <br>
  <a href="https://meocord.dev/docs/latest/getting-started">Get Started</a>
  ·
  <a href="https://github.com/meocord/meocord">GitHub</a>
  ·
  <a href="https://www.npmjs.com/package/meocord">npm</a>
</p>
