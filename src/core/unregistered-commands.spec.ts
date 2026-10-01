import { ApplicationCommandType, ContextMenuCommandBuilder, SlashCommandBuilder } from 'discord.js'
import { vi } from 'vitest'
import { Logger } from '@src/common/logger.js'
import { route } from '@src/common/route.js'
import { MeoCordFactory } from '@src/core/meocord-factory.js'
import { Autocomplete, Command, CommandBuilder, Controller, MeoCord } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { type MeoCordConfig } from '@src/interface/index.js'
import { MeoCordTestingModule } from '@src/testing/index.js'

const { config } = vi.hoisted(() => ({ config: { current: { discordToken: 'token' } as MeoCordConfig } }))
vi.mock('@src/util/meocord-config-loader.util.js', () => ({ loadMeoCordConfig: () => config.current }))
vi.mock('@src/util/platform.util.js', () => ({ assertBuiltForThisPlatform: () => {} }))

let warned: string[]
beforeEach(() => {
  warned = []
  vi.spyOn(Logger.prototype, 'warn').mockImplementation((...args: unknown[]) => void warned.push(args.map(String).join(' ')))
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  config.current = { discordToken: 'token' }
})

@CommandBuilder(CommandType.SLASH)
class SettingsBuilder {
  build(name: string) {
    return new SlashCommandBuilder()
      .setName(name)
      .setDescription('Settings')
      .addSubcommand(sub => sub.setName('view').setDescription('View'))
      .addSubcommand(sub => sub.setName('notify').setDescription('Notify'))
      .addSubcommandGroup(group =>
        group
          .setName('alerts')
          .setDescription('Alerts')
          .addSubcommand(sub => sub.setName('email').setDescription('Email')),
      )
  }
}

@CommandBuilder(CommandType.SLASH)
class PingBuilder {
  build() {
    return new SlashCommandBuilder().setName('ping').setDescription('Ping')
  }
}

@CommandBuilder(CommandType.CONTEXT_MENU)
class ReportBuilder {
  build(name: string) {
    return new ContextMenuCommandBuilder().setName(name).setType(ApplicationCommandType.User)
  }
}

@CommandBuilder(CommandType.SLASH)
class StatsBuilder {
  build() {
    return new SlashCommandBuilder()
      .setName('stats')
      .setDescription('Stats')
      .addSubcommand(sub => sub.setName('daily').setDescription('Daily'))
  }
}

const create = (controllers: (new () => unknown)[]) => {
  @MeoCord({ controllers, clientOptions: { intents: [] } })
  class App {}
  MeoCordFactory.create(App)
}

/** The warning about command handlers that never run, or `undefined` when there was none. */
const unregisteredWarning = () => warned.find(line => /^\d+ command handlers? never runs?:/.test(line))

describe('handlers of commands no builder registers', () => {
  it('are named in one warning at create(), each with what is wrong and what to do', () => {
    @Controller()
    class Settings {
      @Command('settings', SettingsBuilder)
      settings() {}

      @Command('setings notify', CommandType.SLASH)
      misspeltCommand() {}

      @Command('settings notfy', CommandType.SLASH)
      misspeltSubcommand() {}

      @Command('settings alerts', CommandType.SLASH)
      group() {}

      @Command(route('card/{ownerId}/refresh'), CommandType.SLASH)
      refresh() {}

      @Command('Report', CommandType.CONTEXT_MENU)
      report() {}

      @Command('launch', CommandType.PRIMARY_ENTRY_POINT)
      launch() {}

      @Command('pong', PingBuilder)
      pong() {}
    }

    expect(() => create([Settings])).not.toThrow()

    expect(unregisteredWarning()).toBe(
      '7 command handlers never run:\n' +
        '  Settings.misspeltCommand: no builder registers the slash command "setings". Correct the name, or declare the command with a builder.\n' +
        '  Settings.misspeltSubcommand: "settings notfy" is not a subcommand of the slash command "settings", whose builder registers ' +
        '"settings view", "settings notify" and "settings alerts email". Correct the path.\n' +
        '  Settings.group: "settings alerts" is not a subcommand of the slash command "settings", whose builder registers ' +
        '"settings view", "settings notify" and "settings alerts email". Correct the path.\n' +
        '  Settings.refresh: "card/{ownerId}/refresh" is a customId pattern, and a slash command is matched by its name. ' +
        'Declare it with the component type that sends that customId, such as CommandType.BUTTON.\n' +
        '  Settings.report: no builder registers the context menu command "Report". Correct the name, or declare the command with a builder.\n' +
        '  Settings.launch: no builder registers the entry point command "launch". Correct the name, or declare the command with a builder.\n' +
        '  Settings.pong: its builder PingBuilder registers the slash command "ping", not "pong", so Discord sends "ping". ' +
        'Declare it as @Command(\'ping\', PingBuilder), or have the builder use the name build() is given.\n' +
        'The next major version (5.0) refuses to start with these.',
    )
  })

  it('leaves alone a handler of a command, subcommand or group path its builder registers, whatever the builder is declared on', () => {
    @Controller()
    class Settings {
      @Command('settings', SettingsBuilder)
      settings() {}

      @Command('settings notify', CommandType.SLASH)
      notify() {}

      @Command('settings alerts email', CommandType.SLASH)
      email() {}
    }
    @Controller()
    class Reports {
      @Command('Report', ReportBuilder)
      report() {}

      @Command('ping', PingBuilder)
      ping() {}
    }
    // A builder that names its command itself, declared on a subcommand path
    @Controller()
    class Stats {
      @Command('stats daily', StatsBuilder)
      daily() {}

      @Command('stats', CommandType.SLASH)
      stats() {}
    }

    create([Settings, Reports, Stats])

    expect(unregisteredWarning()).toBeUndefined()
  })

  it.each([
    ['as a bot', () => {}, { discordToken: 'token' }, true],
    ['under meocord register', () => vi.stubEnv('MEOCORD_REGISTER_ONLY', '1'), { discordToken: 'token' }, true],
    ['as the shard manager', () => {}, { discordToken: 'token', sharding: { mode: 'process' } }, true],
    // Its manager has given the warning
    ['as a spawned shard', () => vi.stubEnv('SHARDING_MANAGER', 'true'), { discordToken: 'token', sharding: { mode: 'process' } }, false],
  ] as const)('are named once for the whole bot when it runs %s', (_how, setUp, current, warns) => {
    @Controller()
    class Reports {
      @Command('Report', CommandType.CONTEXT_MENU)
      report() {}
    }
    setUp()
    config.current = current as MeoCordConfig

    create([Reports])

    expect(unregisteredWarning() !== undefined).toBe(warns)
  })

  // Registration reports why its JSON fails, and what it would register is unknown
  it('leaves alone the handlers under the name of a builder whose command cannot be serialised', () => {
    @CommandBuilder(CommandType.SLASH)
    class NoDescriptionBuilder {
      build(name: string) {
        return new SlashCommandBuilder().setName(name)
      }
    }
    @Controller()
    class Broken {
      @Command('broken', NoDescriptionBuilder)
      broken() {}

      @Command('broken view', CommandType.SLASH)
      view() {}

      @Autocomplete('broken', 'query')
      query() {}
    }

    expect(() => create([Broken])).not.toThrow()

    expect(unregisteredWarning()).toBeUndefined()
  })

  it('names, in the testing module, what is always a mistake, and leaves a fixture handler with no builder alone', () => {
    @Controller()
    class Settings {
      @Command('settings', SettingsBuilder)
      settings() {}

      @Command('settings notfy', CommandType.SLASH)
      misspeltSubcommand() {}

      @Command('sample', CommandType.SLASH)
      sample() {}

      @Command('Report', CommandType.CONTEXT_MENU)
      report() {}
    }

    MeoCordTestingModule.create({ controllers: [Settings] }).compile()

    expect(unregisteredWarning()).toBe(
      '1 command handler never runs:\n' +
        '  Settings.misspeltSubcommand: "settings notfy" is not a subcommand of the slash command "settings", whose builder registers ' +
        '"settings view", "settings notify" and "settings alerts email". Correct the path.\n' +
        'The next major version (5.0) refuses to start with these.',
    )
  })
})

@CommandBuilder(CommandType.SLASH)
class SearchBuilder {
  build(name: string) {
    return new SlashCommandBuilder()
      .setName(name)
      .setDescription('Search')
      .addStringOption(option => option.setName('query').setDescription('Query').setAutocomplete(true))
      .addIntegerOption(option => option.setName('limit').setDescription('Limit'))
  }
}

@CommandBuilder(CommandType.SLASH)
class ChannelsBuilder {
  build(name: string) {
    return new SlashCommandBuilder()
      .setName(name)
      .setDescription('Channels')
      .addSubcommand(sub => sub.setName('view').setDescription('View'))
      .addSubcommand(sub =>
        sub
          .setName('notify')
          .setDescription('Notify')
          .addStringOption(option => option.setName('channel').setDescription('Channel').setAutocomplete(true)),
      )
      .addSubcommandGroup(group =>
        group
          .setName('alerts')
          .setDescription('Alerts')
          .addSubcommand(sub =>
            sub
              .setName('email')
              .setDescription('Email')
              .addStringOption(option => option.setName('address').setDescription('Address').setAutocomplete(true)),
          ),
      )
  }
}

@Controller()
class Commands {
  @Command('search', SearchBuilder)
  search() {}

  @Command('channels', ChannelsBuilder)
  channels() {}
}

describe('autocomplete handlers Discord never asks', () => {
  // Listed as dispatch tries them: the handlers of one option before those of every option
  it('are named in the same warning at create(), each with what is wrong and what to do', () => {
    @Controller()
    class Completions {
      @Autocomplete('serch', 'query')
      misspeltCommand() {}

      @Autocomplete('channels notfy', 'channel')
      misspeltSubcommand() {}

      @Autocomplete('channels alerts')
      group() {}

      @Autocomplete('search', 'qeury')
      misspeltOption() {}

      @Autocomplete('search', 'limit')
      notAutocomplete() {}

      @Autocomplete('channels view')
      nothingToComplete() {}
    }

    create([Commands, Completions])

    expect(unregisteredWarning()).toBe(
      '6 command handlers never run:\n' +
        '  Completions.misspeltCommand: no builder registers the slash command "serch". Correct the name, or declare the command with a builder.\n' +
        '  Completions.misspeltSubcommand: "channels notfy" is not a subcommand of the slash command "channels", whose builder registers ' +
        '"channels view", "channels notify" and "channels alerts email". Correct the path.\n' +
        '  Completions.misspeltOption: "search" has no option "qeury"; its options with autocomplete are "query". Correct the option name.\n' +
        '  Completions.notAutocomplete: the option "limit" of "search" does not have autocomplete on, so Discord never asks to ' +
        'complete it. Turn it on in the builder with setAutocomplete(true).\n' +
        '  Completions.group: "channels alerts" is not a subcommand of the slash command "channels", whose builder registers ' +
        '"channels view", "channels notify" and "channels alerts email". Correct the path.\n' +
        '  Completions.nothingToComplete: "channels view" has no option with autocomplete on, so Discord never asks it to complete ' +
        'one. Turn it on for an option in the builder with setAutocomplete(true).\n' +
        'The next major version (5.0) refuses to start with these.',
    )
  })

  it('leaves alone a handler of an option, a subcommand or a whole command its builder asks to complete', () => {
    @Controller()
    class Completions {
      @Autocomplete('search', 'query')
      query() {}

      @Autocomplete('search')
      anySearchOption() {}

      @Autocomplete('channels notify', 'channel')
      channel() {}

      @Autocomplete('channels alerts email')
      email() {}

      // Every autocomplete of the command, whichever subcommand it is in
      @Autocomplete('channels', 'address')
      address() {}
    }

    create([Commands, Completions])

    expect(unregisteredWarning()).toBeUndefined()
  })

  it('names, in the testing module, what is always a mistake, and leaves a fixture with no builder alone', () => {
    @Controller()
    class Completions {
      @Autocomplete('sample', 'query')
      fixture() {}

      @Autocomplete('search', 'qeury')
      misspeltOption() {}
    }

    MeoCordTestingModule.create({ controllers: [Commands, Completions] }).compile()

    expect(unregisteredWarning()).toBe(
      '1 command handler never runs:\n' +
        '  Completions.misspeltOption: "search" has no option "qeury"; its options with autocomplete are "query". Correct the option name.\n' +
        'The next major version (5.0) refuses to start with these.',
    )
  })
})

describe('two @Autocomplete handlers of one option', () => {
  @CommandBuilder(CommandType.SLASH)
  class FruitBuilder {
    build(name: string) {
      return new SlashCommandBuilder()
        .setName(name)
        .setDescription('Fruit')
        .addStringOption(option => option.setName('name').setDescription('Name').setAutocomplete(true))
    }
  }
  @Controller()
  class Fruit {
    @Command('fruit', FruitBuilder)
    fruit() {}
  }
  @Controller()
  class First {
    @Autocomplete('fruit', 'name')
    one() {}

    @Autocomplete('fruit')
    anyOption() {}
  }
  @Controller()
  class Second {
    @Autocomplete('fruit', 'name')
    two() {}

    @Autocomplete('fruit')
    alsoAnyOption() {}
  }
  const expected =
    '2 command handlers never run:\n' +
    '  Second.two: First.one also completes the option "name" of "fruit", and runs first. Keep one, or give this one a ' +
    'path or option of its own.\n' +
    '  Second.alsoAnyOption: First.anyOption also completes every option of "fruit", and runs first. Keep one, or give ' +
    'this one a path or option of its own.\n' +
    'The next major version (5.0) refuses to start with these.'

  it('are named at create(), the one dispatch runs first and the one it never runs', () => {
    create([Fruit, First, Second])

    expect(unregisteredWarning()).toBe(expected)
  })

  it('are named in the testing module too', () => {
    MeoCordTestingModule.create({ controllers: [Fruit, First, Second] }).compile()

    expect(unregisteredWarning()).toBe(expected)
  })

  // Discord asks neither, so neither runs first: each is named for the option, not one for the other
  it('are named only for the option, when Discord never asks to complete it', () => {
    @CommandBuilder(CommandType.SLASH)
    class PlainFruitBuilder {
      build(name: string) {
        return new SlashCommandBuilder()
          .setName(name)
          .setDescription('Fruit')
          .addStringOption(option => option.setName('name').setDescription('Name'))
      }
    }
    @Controller()
    class PlainFruit {
      @Command('fruit', PlainFruitBuilder)
      fruit() {}
    }
    @Controller()
    class FirstName {
      @Autocomplete('fruit', 'name')
      one() {}
    }
    @Controller()
    class SecondName {
      @Autocomplete('fruit', 'name')
      two() {}
    }

    create([PlainFruit, FirstName, SecondName])

    const notOn =
      'the option "name" of "fruit" does not have autocomplete on, so Discord never asks to complete it. Turn it on ' +
      'in the builder with setAutocomplete(true).'
    expect(warned.filter(line => line.includes('never run'))).toEqual([
      `2 command handlers never run:\n  FirstName.one: ${notOn}\n  SecondName.two: ${notOn}\n` +
        'The next major version (5.0) refuses to start with these.',
    ])
  })
})
