import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { inspect, stripVTControlCharacters } from 'util'
import { ApplicationCommandType, EntryPointCommandHandlerType, type PrimaryEntryPointCommandInteraction, REST, SlashCommandBuilder } from 'discord.js'
import { createTranslator } from '@src/common/index.js'
import { vi } from 'vitest'
import { Command, CommandBuilder, Controller } from '@src/decorator/index.js'
import { CommandType, MetadataKey } from '@src/enum/index.js'
import { type CommandRegistrationConfig } from '@src/interface/index.js'
import { type CollectedCommand, collectCommands, planTargets, registerCommands, type RegistrationTarget } from '@src/core/command-registration.js'

const createLogger = () => ({ log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })

/** A controller with one slash command per name; a builder's `guilds` restricts that command. */
function controllerWith(commands: { name: string; guilds?: (string | undefined)[] }[]) {
  @Controller()
  class GeneratedController {}

  for (const { name, guilds } of commands) {
    @CommandBuilder(CommandType.SLASH, guilds ? { guilds } : {})
    class Builder {
      build = () => ({ toJSON: () => ({ name, type: 1, description: name }) }) as any
    }
    const handler = async () => {}
    Object.defineProperty(GeneratedController.prototype, name, { value: handler, writable: true, configurable: true })
    const descriptor = Object.getOwnPropertyDescriptor(GeneratedController.prototype, name)!
    Command(name, Builder as any)(GeneratedController.prototype, name, descriptor as any)
  }

  return GeneratedController
}

const createRest = (existing: Record<string, { name: string }[]> = {}) => ({
  put: vi.fn().mockResolvedValue([]),
  get: vi.fn((route: string) => Promise.resolve(existing[route] ?? [])),
})

const sentTo = (rest: ReturnType<typeof createRest>) =>
  Object.fromEntries(rest.put.mock.calls.map(([route, { body }]) => [route, body.map((command: { name: string }) => command.name)]))

describe('collectCommands', () => {
  const builderFor = (name: string) => ({ toJSON: () => ({ name, type: 1, options: [] }) })

  it('collects one command when a builder is declared on two methods', () => {
    const builder = builderFor('settings')
    class SettingsBuilder {
      build = () => builder as any
    }
    Reflect.defineMetadata(MetadataKey.CommandType, CommandType.SLASH, SettingsBuilder)

    @Controller()
    class SettingsController {
      @Command('settings', SettingsBuilder as any)
      async one(..._args: any[]) {}

      @Command('settings', SettingsBuilder as any)
      async two(..._args: any[]) {}
    }

    const logger = createLogger()
    expect(collectCommands([SettingsController], logger)).toHaveLength(1)
    // The same builder twice is how subcommands split across methods are declared.
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('reads the prototypes, so no controller is constructed', () => {
    const constructed = vi.fn()
    class PingBuilder {
      build = () => builderFor('ping') as any
    }
    Reflect.defineMetadata(MetadataKey.CommandType, CommandType.SLASH, PingBuilder)

    @Controller()
    class PingController {
      constructor() {
        constructed()
        throw new Error('needs a database')
      }

      @Command('ping', PingBuilder as any)
      async ping(..._args: any[]) {}
    }

    expect(collectCommands([PingController], createLogger())).toHaveLength(1)
    expect(constructed).not.toHaveBeenCalled()
  })

  // A bulk update without that command would delete it from Discord, so nothing is sent at all.
  it('collects nothing, and says which, when a builder cannot be serialised', () => {
    class BrokenBuilder {
      build = () =>
        ({
          toJSON: () => {
            throw new Error('description is required')
          },
        }) as any
    }
    Reflect.defineMetadata(MetadataKey.CommandType, CommandType.SLASH, BrokenBuilder)

    @Controller()
    class BrokenController {
      @Command('broken', BrokenBuilder as any)
      async handle(..._args: any[]) {}
    }

    const logger = createLogger()
    expect(collectCommands([BrokenController], logger)).toBeUndefined()
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('"broken" (description is required)'))
  })

  // discord.js has no builder class for entry point commands, so their builder returns the REST body itself.
  it('collects an entry point command from a raw REST body', () => {
    const body = {
      type: ApplicationCommandType.PrimaryEntryPoint as const,
      name: 'launch',
      description: 'Launch the activity',
      handler: EntryPointCommandHandlerType.AppHandler,
    }

    @CommandBuilder(CommandType.PRIMARY_ENTRY_POINT)
    class LaunchBuilder {
      build = () => body
    }

    @Controller()
    class LaunchController {
      @Command('launch', LaunchBuilder as any)
      async launch(_interaction: PrimaryEntryPointCommandInteraction) {}
    }

    expect(collectCommands([LaunchController], createLogger())?.map(command => command.body)).toEqual([body])
  })

  // Discord identifies a command by its type together with its name.
  describe('a name shared across application command types', () => {
    const collectPair = (first: ApplicationCommandType, second: ApplicationCommandType) => {
      const menu = (type: ApplicationCommandType) => ({ toJSON: () => ({ name: 'Genshin Profile', type }) })
      class FirstBuilder {
        build = () => menu(first) as any
      }
      class SecondBuilder {
        build = () => menu(second) as any
      }
      Reflect.defineMetadata(MetadataKey.CommandType, CommandType.CONTEXT_MENU, FirstBuilder)
      Reflect.defineMetadata(MetadataKey.CommandType, CommandType.CONTEXT_MENU, SecondBuilder)

      @Controller()
      class ProfileController {
        @Command('Genshin Profile', FirstBuilder as any)
        @Command('Genshin Profile', SecondBuilder as any)
        async profile(..._args: any[]) {}
      }

      const logger = createLogger()
      return { commands: collectCommands([ProfileController], logger)!, logger }
    }

    it('collects both, without a warning, when the types differ', () => {
      const { commands, logger } = collectPair(ApplicationCommandType.User, ApplicationCommandType.Message)

      expect(commands).toHaveLength(2)
      expect(logger.warn).not.toHaveBeenCalled()
    })

    it('collects one and warns when the types match', () => {
      const { commands, logger } = collectPair(ApplicationCommandType.User, ApplicationCommandType.User)

      expect(commands).toHaveLength(1)
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('built more than once'))
    })
  })

  // An untyped slash body is the chat input command Discord infers, so two of them are one command.
  it('treats slash builders with no declared type as one command, and warns', () => {
    class FirstBuilder {
      build = () => ({ toJSON: () => ({ name: 'settings', options: [] }) }) as any
    }
    class SecondBuilder {
      build = () => ({ toJSON: () => ({ name: 'settings', options: [] }) }) as any
    }
    Reflect.defineMetadata(MetadataKey.CommandType, CommandType.SLASH, FirstBuilder)
    Reflect.defineMetadata(MetadataKey.CommandType, CommandType.SLASH, SecondBuilder)

    @Controller()
    class SettingsController {
      @Command('settings', FirstBuilder as any)
      async one(..._args: any[]) {}

      @Command('settings', SecondBuilder as any)
      async two(..._args: any[]) {}
    }

    const logger = createLogger()
    expect(collectCommands([SettingsController], logger)).toHaveLength(1)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('is built more than once'))
  })

  describe('localizations', () => {
    const collectBody = (body: object) => {
      class RawBuilder {
        build = () => body as any
      }
      Reflect.defineMetadata(MetadataKey.CommandType, CommandType.SLASH, RawBuilder)

      @Controller()
      class RawController {
        @Command('ban', RawBuilder as any)
        async ban(..._args: any[]) {}
      }

      const logger = createLogger()
      return { commands: collectCommands([RawController], logger), logger }
    }

    it("collects a command whose localizations Discord accepts, the translator's included", () => {
      const t = createTranslator({
        default: 'en-US',
        locales: { 'en-US': { ban: { name: 'ban', description: 'Ban a member' } }, id: { ban: { name: 'blokir', description: 'Blokir anggota' } } },
      })
      const { commands, logger } = collectBody(
        new SlashCommandBuilder()
          .setName(t.default('ban.name'))
          .setNameLocalizations(t.localizations('ban.name'))
          .setDescription(t.default('ban.description'))
          .setDescriptionLocalizations(t.localizations('ban.description')),
      )

      expect(commands).toHaveLength(1)
      expect(logger.error).not.toHaveBeenCalled()
    })

    // A raw body skips discord.js's builders, which would have refused these while being set.
    it('collects nothing, naming every field Discord would reject, for bad localizations', () => {
      const { commands, logger } = collectBody({
        name: 'ban',
        type: 1,
        description: 'Ban a member',
        name_localizations: { ja: 'Ban Member', xx: 'ban' },
        description_localizations: { id: 'x'.repeat(104), 'es-ES': null },
        options: [
          {
            name: 'user',
            type: 6,
            description: 'Who',
            description_localizations: { ja: '' },
            choices: [{ name: 'a', value: 'a', name_localizations: { ja: 'y'.repeat(101) } }],
          },
        ],
      })

      expect(commands).toBeUndefined()
      const [message] = logger.error.mock.calls[0] as [string]
      expect(message).toContain('Discord would reject 5 localization(s)')
      expect(message).toContain('"ban" name_localizations.ja: "Ban Member" must be lowercase')
      expect(message).toContain('"ban" name_localizations.xx: "xx" is not a Discord locale')
      expect(message).toContain('"ban" description_localizations.id: 104 characters (1 to 100)')
      expect(message).toContain('"ban" options.user.description_localizations.ja: 0 characters (1 to 100)')
      expect(message).toContain('"ban" options.user.choices.a.name_localizations.ja: 101 characters (1 to 100)')
    })

    it('names a locale key that is not a language tag, rather than throwing on it', () => {
      const { commands, logger } = collectBody({ name: 'ban', type: 1, description: 'Ban', name_localizations: { en_US: 'ban' } })

      expect(commands).toBeUndefined()
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('"ban" name_localizations.en_US: "en_US" is not a Discord locale'))
    })

    it('allows capitals and spaces in a context menu name', () => {
      const { commands } = collectBody({ name: 'Report', type: 2, name_localizations: { ja: 'ユーザーを報告', de: 'Nutzer Melden' } })

      expect(commands).toHaveLength(1)
    })
  })

  it("carries a builder's guilds", () => {
    const commands = collectCommands([controllerWith([{ name: 'ban', guilds: ['staff'] }])], createLogger())

    expect(commands?.[0].guilds).toEqual(['staff'])
  })
})

describe('planTargets', () => {
  const plan = (commands: { name: string; guilds?: (string | undefined)[] }[], config?: CommandRegistrationConfig, development = false, logger = createLogger()) =>
    planTargets(collectCommands([controllerWith(commands)], logger)!, { config, development }, logger).map(({ scope, commands }) => [
      scope === 'global' ? 'global' : scope.guild,
      commands.map(command => command.name),
    ])

  it('registers globally by default', () => {
    expect(plan([{ name: 'ping' }])).toEqual([['global', ['ping']]])
  })

  it('registers to each configured guild instead of globally', () => {
    expect(plan([{ name: 'ping' }], { guilds: ['one', 'two'] })).toEqual([
      ['one', ['ping']],
      ['two', ['ping']],
    ])
  })

  it("sends a builder's command to its own guilds, and the rest to the default scope", () => {
    expect(plan([{ name: 'ping' }, { name: 'ban', guilds: ['staff'] }])).toEqual([
      ['global', ['ping']],
      ['staff', ['ban']],
    ])
  })

  it("adds a builder's command to a configured guild it shares", () => {
    expect(plan([{ name: 'ping' }, { name: 'ban', guilds: ['one', 'staff'] }], { guilds: ['one'] })).toEqual([
      ['one', ['ping', 'ban']],
      ['staff', ['ban']],
    ])
  })

  // An unset variable must not quietly publish a staff-only command everywhere.
  it('registers a command whose builder lists no guild ids nowhere, and warns', () => {
    const logger = createLogger()

    expect(plan([{ name: 'ping' }, { name: 'ban', guilds: [undefined, ' '] }], undefined, false, logger)).toEqual([['global', ['ping']]])
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"ban" lists no guild ids'))
  })

  // `guilds: [process.env.GUILD_ID]` with the variable unset names guilds, just no ids
  it('registers the default scope nowhere, not globally, when every configured guild id is empty, and warns', () => {
    const logger = createLogger()

    expect(plan([{ name: 'ping' }, { name: 'ban', guilds: ['staff'] }], { guilds: [undefined, ' '] }, false, logger)).toEqual([['staff', ['ban']]])
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(logger.warn).toHaveBeenCalledWith(
      'commands.guilds lists no guild id, as an unset environment variable leaves it, so "ping" is not registered, ' +
        'rather than registered globally. Set the guild ids, or remove commands.guilds to register globally.',
    )
  })

  it('still sends everything to the development guild when the configured guild ids are empty', () => {
    const logger = createLogger()

    expect(plan([{ name: 'ping' }], { guilds: [undefined], developmentGuild: 'dev' }, true, logger)).toEqual([['dev', ['ping']]])
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('sends everything to the development guild in development', () => {
    expect(plan([{ name: 'ping' }, { name: 'ban', guilds: ['staff'] }], { guilds: ['one'], developmentGuild: 'dev' }, true)).toEqual([
      ['dev', ['ping', 'ban']],
    ])
  })

  it('ignores the development guild in production', () => {
    expect(plan([{ name: 'ping' }], { developmentGuild: 'dev' }, false)).toEqual([['global', ['ping']]])
  })

  it('still sends the default scope when it has no commands, so removed ones are removed', () => {
    expect(plan([{ name: 'ban', guilds: ['staff'] }])).toEqual([
      ['global', []],
      ['staff', ['ban']],
    ])
  })
})

describe('registerCommands', () => {
  let cwd: string

  beforeEach(() => {
    cwd = mkdtempSync(path.join(tmpdir(), 'meocord-registration-'))
    mkdirSync(path.join(cwd, 'node_modules'))
    vi.spyOn(process, 'cwd').mockReturnValue(cwd)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(cwd, { recursive: true, force: true })
  })

  const register = (overrides: Partial<Parameters<typeof registerCommands>[0]> = {}) => {
    const rest = (overrides.rest as ReturnType<typeof createRest>) ?? createRest()
    const logger = createLogger()
    const run = registerCommands({
      rest,
      applicationId: 'app',
      controllerClasses: [controllerWith([{ name: 'ping' }])],
      logger,
      development: false,
      ...overrides,
    })
    return { rest, logger, run }
  }

  it('sends one bulk update per scope, and reports success', async () => {
    const { rest, run } = register({ controllerClasses: [controllerWith([{ name: 'ping' }, { name: 'ban', guilds: ['staff'] }])] })

    await expect(run).resolves.toBe(true)
    expect(sentTo(rest)).toEqual({ '/applications/app/commands': ['ping'], '/applications/app/guilds/staff/commands': ['ban'] })
  })

  it('sends every command to one guild when asked, and checks no other scope', async () => {
    const { rest, run } = register({ onlyGuild: 'target', config: { guilds: ['one'] } })
    await run

    expect(sentTo(rest)).toEqual({ '/applications/app/guilds/target/commands': ['ping'] })
    expect(rest.get).not.toHaveBeenCalled()
  })

  it('sends nothing when a builder cannot be serialised', async () => {
    class BrokenBuilder {
      build = () => ({ toJSON: () => { throw new Error('bad') } }) as any
    }
    Reflect.defineMetadata(MetadataKey.CommandType, CommandType.SLASH, BrokenBuilder)
    @Controller()
    class BrokenController {
      @Command('broken', BrokenBuilder as any)
      async handle(..._args: any[]) {}
    }

    const { rest, run } = register({ controllerClasses: [BrokenController] })

    await expect(run).resolves.toBe(false)
    expect(rest.put).not.toHaveBeenCalled()
  })

  it('logs a rejected scope, keeps sending the others, and reports failure', async () => {
    const rest = createRest()
    rest.put.mockRejectedValueOnce(new Error('Invalid Form Body'))
    const { logger, run } = register({ rest, config: { guilds: ['one', 'two'] } })

    await expect(run).resolves.toBe(false)
    expect(rest.put).toHaveBeenCalledTimes(2)
    expect(logger.error).toHaveBeenCalledWith('Error registering commands to guild one:', expect.any(Error))
  })

  describe('what it logs and touches', () => {
    it('lists what it registered in a table: name, type, sub-commands', async () => {
      const typed = controllerBuilding([
        { name: 'settings', body: { name: 'settings', description: 's', options: [{ name: 'language' }, { name: 'theme' }] } },
        { name: 'Report', body: { name: 'Report', type: 3 } },
        { name: 'Profile', body: { name: 'Profile', type: 2 } },
        { name: 'launch', body: { name: 'launch', type: 4 } },
        { name: 'odd', body: { name: 'odd', type: 9 } },
      ])
      const { logger, run } = register({ controllerClasses: [typed] })
      await run

      // cli-table3 colours its borders on Windows even without a terminal, so compare the plain text
      const [message] = logger.log.mock.calls.map(([line]) => stripVTControlCharacters(String(line))).filter(line => line.startsWith('Registered'))
      expect(message).toMatch(/^Registered 5 bot commands globally:\n/)
      for (const text of ['Name', 'Type', 'Sub-commands', 'SlashCommand', 'MessageContextMenu', 'UserContextMenu', 'PrimaryEntryPoint', 'Command', 'language, theme']) {
        expect(message).toContain(text)
      }
    })

    it('wraps a long list of sub-commands, and names an unknown type "Command"', async () => {
      const options = Array.from({ length: 8 }, (_, index) => ({ name: `option-${index}` }))
      const typed = controllerBuilding([
        { name: 'wide', body: { name: 'wide', type: 1, description: 'w', options } },
        { name: 'odd', body: { name: 'odd', type: 9 } },
      ])
      const { logger, run } = register({ controllerClasses: [typed] })
      await run

      const message = stripVTControlCharacters(String(logger.log.mock.calls.find(([line]) => String(line).startsWith('Registered'))?.[0]))
      expect(message.split('\n').filter(line => line.includes('option-')).length).toBeGreaterThan(1)
      expect(message.split('\n').find(line => line.includes(' odd '))).toMatch(/│ odd\s+│ Command\s+│/)
    })

    it('checks only the scopes the configuration names and it did not send to', async () => {
      const rest = createRest()
      await register({ rest, config: { guilds: ['one'], developmentGuild: 'dev' }, controllerClasses: [controllerWith([{ name: 'ping' }, { name: 'ban', guilds: ['staff'] }])] }).run

      expect(rest.get.mock.calls.map(([route]) => route).sort()).toEqual(['/applications/app/commands', '/applications/app/guilds/dev/commands'])
    })

    // Everything goes to the development guild then, so a command's own guilds are scopes not sent to
    it("checks a command's own guilds while everything goes to the development guild", async () => {
      const rest = createRest({ '/applications/app/guilds/staff/commands': [{ name: 'ban' }] })
      const { logger, run } = register({ rest, development: true, config: { developmentGuild: 'dev' }, controllerClasses: [controllerWith([{ name: 'ban', guilds: ['staff'] }])] })
      await run

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('still registered to guild staff (ban)'))
    })

    // The default scope is sent even when empty, so a configuration naming no guild leaves nothing else to check
    it('checks no scope when the configuration names no guild', async () => {
      const rest = createRest()
      await register({ rest, config: {}, controllerClasses: [controllerWith([{ name: 'ping', guilds: ['staff'] }])] }).run

      expect(rest.get).not.toHaveBeenCalled()
    })

    it('names every command left behind, and removes them with clearOther, saying so', async () => {
      const rest = createRest({ '/applications/app/commands': [{ name: 'ping' }, { name: 'ban' }] })
      const warned = register({ rest, config: { guilds: ['one'] } })
      await warned.run
      const cleared = register({ rest, config: { guilds: ['one'], clearOther: true } })
      await cleared.run

      expect(warned.logger.warn).toHaveBeenCalledWith(
        '2 command(s) are still registered globally (ping, ban), which this configuration does not register to, so Discord keeps showing them there. Set commands.clearOther to remove them.',
      )
      expect(cleared.logger.log).toHaveBeenCalledWith('Removed 2 command(s) left registered globally: ping, ban')
    })

    it('says why it keeps leftovers while sending to the development guild, even with clearOther', async () => {
      const rest = createRest({ '/applications/app/commands': [{ name: 'ping' }] })
      const { logger, run } = register({ rest, development: true, config: { developmentGuild: 'dev', clearOther: true } })
      await run

      expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/clearOther is on, but they are not removed while commands go to the development guild, since a production bot sharing this application may own them\.$/))
    })

    it('clears in development when the development guild is only spaces, which sends to the configured guilds', async () => {
      const rest = createRest({ '/applications/app/commands': [{ name: 'old' }] })
      await register({ rest, development: true, config: { guilds: ['one'], developmentGuild: '   ', clearOther: true } }).run

      expect(sentTo(rest)).toEqual({ '/applications/app/guilds/one/commands': ['ping'], '/applications/app/commands': [] })
    })

    it('says nothing about a scope that lists no commands, or answers with something that is not a list', async () => {
      const rest = createRest()
      rest.get.mockResolvedValueOnce({ unexpected: true } as never)
      const { logger, run } = register({ rest, config: { guilds: ['one'], developmentGuild: 'dev' } })
      await run

      expect(logger.warn).not.toHaveBeenCalled()
      expect(rest.put).toHaveBeenCalledTimes(1)
    })

    it('logs a removal Discord refuses, and still reports the registration a success', async () => {
      const rest = createRest({ '/applications/app/commands': [{ name: 'ping' }] })
      rest.put.mockImplementation(async (_route: string, { body }: { body: unknown[] }) => {
        if (body.length === 0) throw new Error('forbidden')
        return []
      })
      const { logger, run } = register({ rest, config: { guilds: ['one'], clearOther: true } })

      await expect(run).resolves.toBe(true)
      expect(logger.error).toHaveBeenCalledWith('Error removing the commands left registered globally:', new Error('forbidden'))
    })

    it('creates no cache in development when the project has no node_modules', async () => {
      rmSync(path.join(cwd, 'node_modules'), { recursive: true })
      const { logger, run } = register({ development: true })
      await run

      expect(existsSync(path.join(cwd, 'node_modules'))).toBe(false)
      expect(logger.debug).not.toHaveBeenCalled()
    })

    it('registers anyway when the cache cannot be written, saying why at debug level', async () => {
      writeFileSync(path.join(cwd, 'node_modules', '.cache'), 'not a directory')
      const { logger, run } = register({ development: true })

      await expect(run).resolves.toBe(true)
      expect(logger.debug).toHaveBeenCalledWith(expect.stringMatching(/^Could not record the registered commands: /))
    })
  })

  describe('in development', () => {
    it('skips a scope whose payload is unchanged since it was last sent', async () => {
      await register({ development: true }).run
      const { rest, logger, run } = register({ development: true })
      await run

      expect(rest.put).not.toHaveBeenCalled()
      expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('unchanged'))
    })

    it('records the payload per application and scope', async () => {
      await register({ development: true }).run

      expect(readdirSync(path.join(cwd, 'node_modules', '.cache', 'meocord'))).toEqual(['commands-app-global.json'])
    })

    it.each([
      ['forced', { force: true }],
      ['for another application', { applicationId: 'other' }],
      ['for another scope', { config: { guilds: ['one'] } }],
      ['after the commands changed', { controllerClasses: [controllerWith([{ name: 'pong' }])] }],
    ])('sends again when %s', async (_label, overrides) => {
      await register({ development: true }).run
      const { rest, run } = register({ development: true, ...overrides })
      await run

      expect(rest.put).toHaveBeenCalled()
    })

    it('says nothing on a first run, when there is no record yet', async () => {
      const { logger, run } = register({ development: true })
      await run

      expect(logger.debug).not.toHaveBeenCalled()
    })

    it('sends again when the recorded payload cannot be read', async () => {
      await register({ development: true }).run
      writeFileSync(path.join(cwd, 'node_modules', '.cache', 'meocord', 'commands-app-global.json'), '{ not json')
      const { rest, logger, run } = register({ development: true })

      await expect(run).resolves.toBe(true)
      expect(rest.put).toHaveBeenCalled()
      expect(logger.debug).toHaveBeenCalledWith(expect.stringMatching(/^Could not read the registered commands, so they are sent again: SyntaxError/))
    })

    it('records nothing when the update is rejected, so the next start retries', async () => {
      const rest = createRest()
      rest.put.mockRejectedValue(new Error('down'))
      await register({ development: true, rest }).run

      expect(existsSync(path.join(cwd, 'node_modules', '.cache', 'meocord'))).toBe(false)
    })
  })

  it('never skips in production, and records nothing', async () => {
    await register().run
    const { rest, run } = register()
    await run

    expect(rest.put).toHaveBeenCalledTimes(1)
    expect(existsSync(path.join(cwd, 'node_modules', '.cache'))).toBe(false)
  })

  describe('when every configured guild id is empty', () => {
    it('sends only the commands with guilds of their own, and reports failure', async () => {
      const { rest, run } = register({
        controllerClasses: [controllerWith([{ name: 'ping' }, { name: 'ban', guilds: ['staff'] }])],
        config: { guilds: [undefined] },
      })

      await expect(run).resolves.toBe(false)
      expect(sentTo(rest)).toEqual({ '/applications/app/guilds/staff/commands': ['ban'] })
    })

    // The configuration is broken, so what it would clear cannot be trusted
    it('clears nothing, even with clearOther', async () => {
      const rest = createRest({ '/applications/app/commands': [{ name: 'ping' }] })
      const { logger, run } = register({
        rest,
        controllerClasses: [controllerWith([{ name: 'ping' }, { name: 'ban', guilds: ['staff'] }])],
        config: { guilds: [undefined], clearOther: true },
      })
      await run

      expect(rest.put).not.toHaveBeenCalledWith('/applications/app/commands', expect.anything())
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('still registered globally (ping), which this configuration does not register to, so Discord keeps showing them there. ' +
          'clearOther is on, but they are not removed while commands.guilds lists no guild id.'),
      )
    })
  })

  describe('leftovers in scopes the configuration names but does not send to', () => {
    it('warns about global commands left behind by a guild scope', async () => {
      const rest = createRest({ '/applications/app/commands': [{ name: 'ping' }] })
      const { logger, run } = register({ rest, config: { guilds: ['one'] } })
      await run

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('still registered globally (ping)'))
      expect(sentTo(rest)).toEqual({ '/applications/app/guilds/one/commands': ['ping'] })
    })

    it('removes them with clearOther', async () => {
      const rest = createRest({ '/applications/app/commands': [{ name: 'ping' }] })
      await register({ rest, config: { guilds: ['one'], clearOther: true } }).run

      expect(rest.put).toHaveBeenCalledWith('/applications/app/commands', { body: [] })
    })

    // Development and production often share one application; clearing from a development start
    // would delete the commands production registered.
    it('only warns, even with clearOther, while every command goes to the development guild', async () => {
      const rest = createRest({ '/applications/app/commands': [{ name: 'ping' }] })
      const { logger, run } = register({ rest, development: true, config: { developmentGuild: 'dev', clearOther: true } })
      await run

      expect(rest.put).not.toHaveBeenCalledWith('/applications/app/commands', { body: [] })
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('still registered globally (ping)'))
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('not removed while commands go to the development guild'))
    })

    it('still clears with clearOther in development when no development guild is set', async () => {
      const rest = createRest({ '/applications/app/commands': [{ name: 'ping' }] })
      await register({ rest, development: true, config: { guilds: ['one'], clearOther: true } }).run

      expect(rest.put).toHaveBeenCalledWith('/applications/app/commands', { body: [] })
    })

    it('clears with clearOther from a production run that names a development guild', async () => {
      const rest = createRest({ '/applications/app/guilds/dev/commands': [{ name: 'ping' }] })
      await register({ rest, config: { developmentGuild: 'dev', clearOther: true } }).run

      expect(rest.put).toHaveBeenCalledWith('/applications/app/guilds/dev/commands', { body: [] })
    })

    it('checks the development guild from a production start', async () => {
      const rest = createRest({ '/applications/app/guilds/dev/commands': [{ name: 'ping' }] })
      const { logger, run } = register({ rest, config: { developmentGuild: 'dev' } })
      await run

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('still registered to guild dev'))
    })

    it('says nothing when a scope cannot be listed, as for a guild the bot is not in', async () => {
      const rest = createRest()
      rest.get.mockRejectedValue(new Error('Missing Access'))
      const { logger, run } = register({ rest, config: { guilds: ['one'] } })

      await expect(run).resolves.toBe(true)
      expect(logger.warn).not.toHaveBeenCalled()
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Missing Access'))
    })

    it('checks nothing when every scope was unchanged', async () => {
      await register({ development: true, config: { guilds: ['one'] } }).run
      const { rest, run } = register({ development: true, config: { guilds: ['one'] } })
      await run

      expect(rest.get).not.toHaveBeenCalled()
    })
  })
})

/** A controller whose command `name` is built from `body`, through a builder whose `toJSON` returns it. */
function controllerBuilding(entries: { name: string; body: object; method?: string }[]) {
  @Controller()
  class BuiltController {}
  for (const { name, body, method = name } of entries) {
    class RawBuilder {
      build = () => ({ toJSON: () => body }) as any
    }
    Reflect.defineMetadata(MetadataKey.CommandType, CommandType.SLASH, RawBuilder)
    Object.defineProperty(BuiltController.prototype, method, { value: async () => {}, writable: true, configurable: true })
    Command(name, RawBuilder as any)(BuiltController.prototype, method, Object.getOwnPropertyDescriptor(BuiltController.prototype, method)! as any)
  }
  return BuiltController
}

describe('registration, message by message', () => {
  describe('collectCommands', () => {
    it("names a command its builder leaves unnamed after its @Command, keyed apart from the others", () => {
      const commands = collectCommands(
        [controllerBuilding([{ name: 'ping', body: { type: 1, description: 'p' } }, { name: 'pong', body: { type: 1, description: 'q' } }])],
        createLogger(),
      )

      expect(commands?.map(({ name }) => name)).toEqual(['ping', 'pong'])
    })

    it('skips a handler declared without a builder, which has nothing to register', () => {
      @Controller()
      class MixedController {
        @Command('plain', CommandType.SLASH)
        async plain(..._args: any[]) {}
      }

      expect(collectCommands([MixedController, controllerWith([{ name: 'ping' }])], createLogger())?.map(({ name }) => name)).toEqual(['ping'])
    })

    it('says in full why a second builder of the same type is not registered', () => {
      const logger = createLogger()

      collectCommands(
        [controllerBuilding([{ name: 'ping', body: { name: 'ping', type: 1 } }, { name: 'ping', method: 'again', body: { name: 'ping', type: 1 } }])],
        logger,
      )

      expect(logger.warn).toHaveBeenCalledWith(
        'Command "ping" is built more than once for the same application command type; only the first builder is registered. ' +
          'Two builders of one type cannot both own a name, so declare the builder on a single @Command and give the others the plain CommandType.',
      )
    })

    it('says in full why nothing is registered when a builder cannot be serialised', () => {
      class BrokenBuilder {
        build = () => ({ toJSON: () => { throw new Error('description is required') } }) as any
      }
      Reflect.defineMetadata(MetadataKey.CommandType, CommandType.SLASH, BrokenBuilder)
      @Controller()
      class BrokenController {
        @Command('broken', BrokenBuilder as any)
        async handle(..._args: any[]) {}
      }
      const logger = createLogger()

      collectCommands([BrokenController], logger)

      expect(logger.error).toHaveBeenCalledWith(
        'No commands were registered: 1 builder(s) could not be serialised: "broken" (description is required). Registering the rest would remove these from Discord.',
      )
    })

    it('lists each localization Discord would reject on a line of its own', () => {
      const logger = createLogger()

      collectCommands([controllerBuilding([{ name: 'ban', body: { name: 'ban', type: 1, description: 'b', name_localizations: { ja: 'A', fr: 'B' } } }])], logger)

      expect(logger.error).toHaveBeenCalledWith(
        'No commands were registered: Discord would reject 2 localization(s):\n' +
          '  "ban" name_localizations.ja: "A" must be lowercase where a letter has case, and only letters, numbers, - _ or ʼ with no spaces\n' +
          '  "ban" name_localizations.fr: "B" must be lowercase where a letter has case, and only letters, numbers, - _ or ʼ with no spaces',
      )
    })

    it('takes a builder with no type and one with the chat input type as the same command', () => {
      const logger = createLogger()

      const commands = collectCommands(
        [controllerBuilding([{ name: 'ping', body: { name: 'ping' } }, { name: 'ping', method: 'typed', body: { name: 'ping', type: 1 } }])],
        logger,
      )

      expect(commands).toHaveLength(1)
      expect(logger.warn).toHaveBeenCalled()
    })

    it("keys and names a command by its builder's name, when one builder serves a command and its subcommand", () => {
      const body = { name: 'settings', type: 1, description: 's', options: [{ name: 'language', type: 1, description: 'l' }] }
      const builder = { toJSON: () => body }
      class SharedBuilder {
        build = () => builder as any
      }
      Reflect.defineMetadata(MetadataKey.CommandType, CommandType.SLASH, SharedBuilder)
      @Controller()
      class SettingsController {
        // The subcommand first, so the command is first met under a route that is not its name
        @Command('settings language', SharedBuilder as any)
        async language(..._args: any[]) {}

        @Command('settings', SharedBuilder as any)
        async settings(..._args: any[]) {}
      }

      expect(collectCommands([SettingsController], createLogger())?.map(({ name }) => name)).toEqual(['settings'])
    })

    it('lists every builder that cannot be serialised, separated', () => {
      const broken = (message: string) =>
        class {
          build = () => ({ toJSON: () => { throw new Error(message) } }) as any
        }
      const First = broken('one')
      const Second = broken('two')
      Reflect.defineMetadata(MetadataKey.CommandType, CommandType.SLASH, First)
      Reflect.defineMetadata(MetadataKey.CommandType, CommandType.SLASH, Second)
      @Controller()
      class BrokenController {
        @Command('first', First as any)
        async first(..._args: any[]) {}

        @Command('second', Second as any)
        async second(..._args: any[]) {}
      }
      const logger = createLogger()

      collectCommands([BrokenController], logger)

      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('2 builder(s) could not be serialised: "first" (one), "second" (two).'))
    })
  })

  describe('planTargets', () => {
    it('trims the guild of --guild and of developmentGuild', () => {
      const commands = collectCommands([controllerWith([{ name: 'ping' }])], createLogger())!

      expect(planTargets(commands, { development: false, onlyGuild: ' staff ' }, createLogger())[0].scope).toEqual({ guild: 'staff' })
      expect(planTargets(commands, { development: true, config: { developmentGuild: ' dev ' } }, createLogger())[0].scope).toEqual({ guild: 'dev' })
    })

    it('warns only about a command whose builder lists no guild ids', () => {
      const logger = createLogger()

      planTargets(collectCommands([controllerWith([{ name: 'ban', guilds: ['staff'] }])], createLogger())!, { development: false }, logger)

      expect(logger.warn).not.toHaveBeenCalled()
    })
  })

  // Discord refuses a guild bulk update holding one whole: 400, code 50222
  describe('a primary entry point command', () => {
    const ping: CollectedCommand = { name: 'ping', body: { name: 'ping', type: 1 } }
    const launch: CollectedCommand = { name: 'launch', body: { name: 'launch', type: 4 } }
    const where = (targets: RegistrationTarget[]) =>
      targets.map(({ scope, commands }) => [scope === 'global' ? 'global' : scope.guild, commands.map(command => command.name)])

    it('goes in the global update of a production run, whatever commands.guilds says', () => {
      expect(where(planTargets([ping, launch], { development: false }, createLogger()))).toEqual([['global', ['ping', 'launch']]])
      expect(where(planTargets([ping, launch], { development: false, config: { guilds: ['555'] } }, createLogger()))).toEqual([
        ['555', ['ping']],
        ['global', ['launch']],
      ])
    })

    // commands.guilds listing no id registers nothing else globally, as an unset variable leaves it
    it('goes global alone when commands.guilds lists no guild id', () => {
      const logger = createLogger()

      expect(where(planTargets([launch], { development: false, config: { guilds: [undefined] } }, logger))).toEqual([['global', ['launch']]])
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('so only the entry point command is registered globally'))
    })

    it("ignores its builder's guilds, with a warning", () => {
      const logger = createLogger()

      const targets = planTargets([ping, { ...launch, guilds: ['555'] }], { development: false }, logger)

      expect(where(targets)).toEqual([['global', ['ping', 'launch']]])
      expect(logger.warn).toHaveBeenCalledWith('Entry point command "launch" can only be registered globally, so the guilds its builder lists are ignored.')
    })

    it('is left out of a development or --guild update, with a warning, and nothing goes global', () => {
      for (const options of [{ development: true, config: { developmentGuild: '999' } }, { development: false, onlyGuild: '999' }]) {
        const logger = createLogger()

        expect(where(planTargets([ping, launch], options, logger))).toEqual([['999', ['ping']]])
        expect(logger.warn).toHaveBeenCalledWith(
          'Entry point command "launch" is registered globally only; a production run or `meocord register` registers it.',
        )
      }
    })
  })
})

describe('the token', () => {
  const token = 'MTIzNDU2Nzg5MDEyMzQ1Njc4.secret-part.do-not-log'

  /** A real REST client whose requests Discord answers with a status, as a revoked token would get. */
  const restAnswering = (status: number) =>
    new REST({ retries: 0, makeRequest: (async () => new Response(JSON.stringify({ message: '401: Unauthorized', code: 0 }), { status, headers: { 'content-type': 'application/json' } })) as never }).setToken(token)

  const everythingLogged = (logger: ReturnType<typeof createLogger>) =>
    Object.values(logger)
      .flatMap(fn => fn.mock.calls.flat())
      .map(arg => (typeof arg === 'string' ? arg : inspect(arg, { depth: 10, showHidden: true })))
      .join('\n')

  it.each([401, 403])('never appears in what is logged when Discord answers %i', async status => {
    const logger = createLogger()
    const registered = await registerCommands({
      rest: restAnswering(status),
      applicationId: 'app',
      controllerClasses: [controllerWith([{ name: 'ping' }])],
      logger,
      development: false,
    })

    expect(registered).toBe(false)
    expect(logger.error).toHaveBeenCalled()
    expect(everythingLogged(logger)).not.toContain('secret-part')
  })
})
