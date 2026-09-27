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

**Documentation:** [meocord.dev](https://meocord.dev/docs/4.1) · [Getting started](https://meocord.dev/docs/4.1/getting-started) · [API reference](https://meocord.dev/docs/4.1/api) · [Upgrading to 4.1](https://meocord.dev/docs/4.1/migrating) · [Changelog](https://meocord.dev/docs/4.1/changelog)

## Features

- **Controllers for every interaction** — [slash commands](https://meocord.dev/docs/4.1/slash-commands) and their subcommands, autocomplete, [buttons, selects and modals](https://meocord.dev/docs/4.1/components) routed by customId, context menus, message commands and reactions, each a decorated method.
- **Message commands** — [commands typed in chat](https://meocord.dev/docs/4.1/message-commands), from a pattern such as `ban {target:member} {reason...?}`: typed params, flags and lists, a usage reply when a message does not fit, and built-in help.
- **A request pipeline** — [guards](https://meocord.dev/docs/4.1/guards) decide whether a handler runs, interceptors wrap it, validation and pipes check its input, [cooldowns](https://meocord.dev/docs/4.1/cooldowns) limit how often it runs, and exception filters decide what the user is told.
- **Dependency injection** — services, providers and lifecycle hooks, wired into controllers with no manual instantiation.
- **Answers that fit the interaction** — `respond(interaction)` replies, edits or follows up from whatever state the interaction is in, styled by a presenter and a [theme](https://meocord.dev/docs/4.1/theming).
- **Testing without Discord** — `meocord/testing` runs a handler through its whole pipeline, with [mocks](https://meocord.dev/docs/4.1/testing) for every interaction type.
- **A CLI** — `meocord create`, `build`, `start`, `register` and `generate`, with Rsbuild builds for development and production, sharding, and [deployment](https://meocord.dev/docs/4.1/deployment) without `node_modules`.

## Getting started

MeoCord runs on Node.js 22.13 or newer, or Bun. `discord.js` 14 and `dotenv` 18 are its peer dependencies, and `meocord create` installs both.

```shell
npx meocord create my-bot
cd my-bot
cp .env.example .env       # then put your bot token in DISCORD_TOKEN
npx meocord start --dev    # development, restarting on every change
```

The new project comes with a sample of each controller type, a guard, a presenter, a service and a spec for each. [Getting started](https://meocord.dev/docs/4.1/getting-started) walks through it, and [Your first command](https://meocord.dev/docs/4.1/first-command) adds one.

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

The command's options arrive as the handler's second argument. [Slash commands](https://meocord.dev/docs/4.1/slash-commands) covers options, subcommands and registration.

## Documentation

Everything else is on [meocord.dev](https://meocord.dev/docs/4.1), for each version:

| To                                  | Read                                                            |
| ----------------------------------- | --------------------------------------------------------------- |
| Learn MeoCord from the start        | [Getting started](https://meocord.dev/docs/4.1/getting-started) |
| Look up a decorator, type or helper | [API reference](https://meocord.dev/docs/4.1/api)               |
| Upgrade from 4.0, or from 3.x       | [Upgrading](https://meocord.dev/docs/4.1/migrating)             |
| See what changed in each release    | [Changelog](https://meocord.dev/docs/4.1/changelog)             |

## Support

Questions and ideas go to [Discussions](https://github.com/meocord/meocord/discussions), bugs and requests to [issues](https://github.com/meocord/meocord/issues). For a vulnerability, follow [SECURITY.md](./SECURITY.md) rather than opening an issue.

## Contributing

Issues and pull requests are welcome. [CONTRIBUTING.md](./CONTRIBUTING.md) covers getting set up, what each check catches, and how releases work. Participation is governed by the [Code of Conduct](./CODE_OF_CONDUCT.md).

## License

MeoCord is released under the [MIT License](./LICENSE). It builds on open-source packages under their own licenses, listed in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

## Moved sections

These sections moved to meocord.dev. Their headings stay here so that links from earlier release notes still land.

### Theming

[Theming](https://meocord.dev/docs/4.1/theming) on meocord.dev.

### Themes per server and per user

[Themes per server and per user](https://meocord.dev/docs/4.1/theming#per-server-and-per-user) on meocord.dev.

### Adding tokens of your own

[Adding tokens of your own](https://meocord.dev/docs/4.1/theming#adding-tokens-of-your-own) on meocord.dev.

### Where calls are counted

[Where calls are counted](https://meocord.dev/docs/4.1/cooldowns#where-calls-are-counted) on meocord.dev.

### Store recipes

[Cooldown stores](https://meocord.dev/docs/4.1/recipe-cooldown-stores) on meocord.dev.

### Stack traces

[Stack traces](https://meocord.dev/docs/4.1/configuration#stack-traces) on meocord.dev.

### Running tests

[Running tests](https://meocord.dev/docs/4.1/testing#running-tests) on meocord.dev.
