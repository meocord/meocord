import {
  ApplicationCommandType,
  type AutocompleteInteraction,
  ContextMenuCommandBuilder,
  type MessageContextMenuCommandInteraction,
  type UserContextMenuCommandInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type GuildMember,
  type Message,
  type MessageReaction,
  type ModalSubmitInteraction,
  SlashCommandBuilder,
} from 'discord.js'
import { createMetadata } from '@src/common/index.js'
import {
  Autocomplete,
  Command,
  CommandBuilder,
  Controller,
  MessageHandler,
  On,
  Once,
  ReactionHandler,
  Service,
} from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { HandlerRegistry } from '@src/core/handler-registry.js'
import { MeoCordTestingModule } from '@src/testing/index.js'

const Category = createMetadata<string>('category')

@CommandBuilder(CommandType.SLASH)
class SettingsBuilder {
  build(name: string) {
    return new SlashCommandBuilder()
      .setName(name)
      .setDescription('Change your settings')
      .addSubcommand(sub => sub.setName('language').setDescription('Pick a language'))
  }
}

@Controller()
@Category('Account')
class SettingsController {
  @Command('settings', SettingsBuilder)
  settings(_interaction: ChatInputCommandInteraction) {}

  @Command('settings language', CommandType.SLASH)
  @Category('Preferences')
  language(_interaction: ChatInputCommandInteraction) {}

  @Autocomplete('settings language', 'code')
  completeLanguage(_interaction: AutocompleteInteraction) {}

  @Command('profile/{uid}', CommandType.BUTTON)
  profile(_interaction: ButtonInteraction) {}

  @Command('feedback', CommandType.MODAL_SUBMIT)
  feedback(_interaction: ModalSubmitInteraction) {}

  @MessageHandler('ping')
  ping(_message: Message) {}

  @ReactionHandler()
  react(_reaction: MessageReaction) {}
}

@Service()
class WelcomeService {
  @On('guildMemberAdd')
  greet(_member: GuildMember) {}

  @Once('clientReady')
  warm() {}
}

@Service()
class HelpService {
  constructor(readonly handlers: HandlerRegistry) {}
}

describe('HandlerRegistry', () => {
  const registry = () =>
    MeoCordTestingModule.create({
      controllers: [SettingsController],
      providers: [
        { provide: WelcomeService, useClass: WelcomeService },
        { provide: HelpService, useClass: HelpService },
      ],
    })
      .compile()
      .get(HelpService).handlers

  it('lists every kind of handler with its name', () => {
    const entries = registry()
      .list()
      .map(({ kind, controller, method, name }) => ({ kind, controller: controller.name, method, name }))

    expect(entries).toEqual(
      expect.arrayContaining([
        { kind: 'command', controller: 'SettingsController', method: 'settings', name: 'settings' },
        { kind: 'command', controller: 'SettingsController', method: 'language', name: 'settings language' },
        { kind: 'autocomplete', controller: 'SettingsController', method: 'completeLanguage', name: 'settings language code' },
        { kind: 'component', controller: 'SettingsController', method: 'profile', name: 'profile/{uid}' },
        { kind: 'modal', controller: 'SettingsController', method: 'feedback', name: 'feedback' },
        { kind: 'message', controller: 'SettingsController', method: 'ping', name: 'ping' },
        { kind: 'reaction', controller: 'SettingsController', method: 'react', name: undefined },
        { kind: 'event', controller: 'WelcomeService', method: 'greet', name: 'guildMemberAdd' },
        { kind: 'event', controller: 'WelcomeService', method: 'warm', name: 'clientReady' },
      ]),
    )
    expect(entries).toHaveLength(9)
  })

  it('gives a subcommand the top-level command JSON and its command type', () => {
    const language = registry()
      .list({ kind: 'command' })
      .find(entry => entry.name === 'settings language')

    expect(language?.commandType).toBe(CommandType.SLASH)
    expect(language?.command?.name).toBe('settings')
    expect(language?.command).toMatchObject({ description: 'Change your settings' })
    expect(language?.description).toBe('Pick a language')
    expect(registry().list({ kind: 'command' }).find(entry => entry.name === 'settings')?.description).toBe(
      'Change your settings',
    )
  })

  it('reads metadata as ExecutionContext does, the method before the controller', () => {
    const commands = registry().list({ kind: 'command' })

    expect(commands.find(entry => entry.method === 'language')?.get(Category)).toBe('Preferences')
    expect(commands.find(entry => entry.method === 'settings')?.get(Category)).toBe('Account')
    expect(commands.find(entry => entry.method === 'language')?.getAll(Category)).toEqual(['Preferences', 'Account'])
  })

  it('filters by kind and by controller, and narrows the entry type', () => {
    const events = registry().list({ kind: 'event' })
    expect(events.map(entry => [entry.name, entry.once])).toEqual([
      ['guildMemberAdd', false],
      ['clientReady', true],
    ])

    expect(registry().list({ controller: WelcomeService })).toHaveLength(2)
    expect(registry().list({ kind: 'modal', controller: WelcomeService })).toEqual([])
  })
})

describe('HandlerRegistry, at its edges', () => {
  @CommandBuilder(CommandType.SLASH)
  class NamelessBuilder {
    // No description: toJSON throws, which registration reports, not the registry
    build(name: string) {
      return new SlashCommandBuilder().setName(name)
    }
  }

  @CommandBuilder(CommandType.CONTEXT_MENU)
  class ReportBuilder {
    build(name: string) {
      return new ContextMenuCommandBuilder().setName(name).setType(ApplicationCommandType.Message)
    }
  }

  @Controller()
  class EdgeController {
    @Command('broken', NamelessBuilder)
    broken(_interaction: ChatInputCommandInteraction) {}

    @Command('Report message', ReportBuilder)
    report(_interaction: MessageContextMenuCommandInteraction | UserContextMenuCommandInteraction) {}

    @Command('settings missing', CommandType.SLASH)
    missing(_interaction: ChatInputCommandInteraction) {}
  }

  class BaseController {
    @MessageHandler('base')
    base(_message: Message) {}
  }

  @Controller()
  class DerivedController extends BaseController {}

  @Controller()
  class EmptyController {}

  it('lists a command whose builder cannot build, with no JSON rather than throwing', () => {
    const [broken] = new HandlerRegistry([EdgeController]).list({ kind: 'command' })

    expect(broken).toMatchObject({ name: 'broken', command: undefined, description: undefined })
  })

  it('gives a context menu command, and a subcommand its JSON lacks, no description', () => {
    const entries = new HandlerRegistry([SettingsController, EdgeController]).list({ kind: 'command' })

    expect(entries.find(entry => entry.name === 'Report message')?.description).toBeUndefined()
    expect(entries.find(entry => entry.name === 'settings missing')).toMatchObject({
      description: undefined,
      command: expect.objectContaining({ name: 'settings' }),
    })
  })

  it('gives an entry point command, whose builder returns the REST body, its JSON and description', () => {
    const body = { name: 'launch', description: 'Open the activity', type: ApplicationCommandType.PrimaryEntryPoint as const, handler: 2 }
    @CommandBuilder(CommandType.PRIMARY_ENTRY_POINT)
    class LaunchBuilder {
      build() {
        return body
      }
    }
    @Controller()
    class LaunchController {
      @Command('launch', LaunchBuilder)
      launch() {}
    }

    const [launch] = new HandlerRegistry([LaunchController]).list({ kind: 'command' })

    expect(launch).toMatchObject({ name: 'launch', command: body, description: 'Open the activity' })
  })

  // Discord tells commands apart by type and name, so a slash command and a context menu may share a name
  it('gives a handler with no builder the JSON of its own command kind, a context menu by its whole name', () => {
    @CommandBuilder(CommandType.SLASH)
    class ReportBuilder {
      build(name: string) {
        return new SlashCommandBuilder().setName(name).setDescription('Report something')
      }
    }
    @CommandBuilder(CommandType.CONTEXT_MENU)
    class ReportMenuBuilder {
      build(name: string) {
        return new ContextMenuCommandBuilder().setName(name).setType(ApplicationCommandType.Message)
      }
    }
    @Controller()
    class Built {
      @Command('report', ReportBuilder)
      report() {}

      @Command('Report message', ReportMenuBuilder)
      reportMessage() {}
    }
    @Controller()
    class Unbuilt {
      @Command('report', CommandType.CONTEXT_MENU)
      reportUser() {}

      @Command('Report message', CommandType.CONTEXT_MENU)
      reportAgain() {}
    }

    const entries = new HandlerRegistry([Built, Unbuilt]).list({ controller: Unbuilt, kind: 'command' })

    expect(entries.map(({ name, command }) => [name, command?.name, command?.type])).toEqual([
      ['report', undefined, undefined],
      ['Report message', 'Report message', ApplicationCommandType.Message],
    ])
  })

  it('lists an inherited handler under the subclass bound', () => {
    expect(new HandlerRegistry([DerivedController]).list()).toEqual([
      expect.objectContaining({ kind: 'message', name: 'base', controller: DerivedController, method: 'base' }),
    ])
  })

  it('lists nothing for a controller without handlers, or a filter nothing matches', () => {
    const registry = new HandlerRegistry([EmptyController, SettingsController])

    expect(registry.list({ controller: EmptyController })).toEqual([])
    expect(registry.list({ kind: 'event' })).toEqual([])
    expect(registry.list({ kind: 'command', controller: EmptyController })).toEqual([])
  })

  it('reads metadata nothing declared as undefined, and as no values', () => {
    const [ping] = new HandlerRegistry([SettingsController]).list({ kind: 'message' })
    const Unset = createMetadata<string>('unset')

    expect(ping.get(Unset)).toBeUndefined()
    expect(ping.getAll(Unset)).toEqual([])
  })

  it('describes a message command once, with its aliases, description, scope and usage', () => {
    @Controller()
    class ModerationController {
      @MessageHandler('mute {target:member} {duration:duration?} {reason...?}', {
        aliases: ['m', 'shush now'],
        description: 'Times a member out.',
        scope: 'guild',
      })
      mute() {}

      @MessageHandler('{word}')
      echo() {}

      @MessageHandler()
      everything() {}
    }

    @Controller()
    class Flagged {
      @MessageHandler('purge {count:int} {--bots} {ids:string...?} {--reason:string}')
      purge() {}
    }

    const [mute, echo, everything] = new HandlerRegistry([ModerationController]).list({ kind: 'message' })

    expect(mute).toMatchObject({
      name: 'mute {target:member} {duration:duration?} {reason...?}',
      command: 'mute',
      aliases: ['m', 'shush now'],
      description: 'Times a member out.',
      scope: 'guild',
    })
    expect(mute.usage('!')).toBe('!mute <target> [duration] [reason…]')
    expect(mute.usage()).toBe('mute <target> [duration] [reason…]')
    expect(['mute', 'MUTE', 'm', 'shush  now'].map(words => mute.matches(words))).toEqual([true, true, true, true])
    expect(['shush', 'ban', ''].map(words => mute.matches(words))).toEqual([false, false, false])
    expect(echo).toMatchObject({ command: undefined, aliases: [], description: undefined, scope: 'any' })
    expect(echo.usage('!')).toBe('!<word>')
    expect(everything.usage('!')).toBeUndefined()
    expect(new HandlerRegistry([Flagged]).list({ kind: 'message' })[0].usage('!')).toBe('!purge <count> [ids…] [--bots] --reason=<reason>')
    expect(everything.matches('everything')).toBe(false)
  })

  // As help gives it: a member, role or channel param or flag makes the command server-only
  it('gives a message command the scope its params narrow it to', () => {
    @Controller()
    class Scoped {
      @MessageHandler('kick {target:member}')
      kick() {}

      @MessageHandler('lock {--in:channel}')
      lock() {}

      @MessageHandler('roll {sides:int}')
      roll() {}
    }

    expect(new HandlerRegistry([Scoped]).list({ kind: 'message' }).map(({ command, scope }) => [command, scope])).toEqual([
      ['kick', 'guild'],
      ['lock', 'guild'],
      ['roll', 'any'],
    ])
  })

  it("matches a command's words in case when the handler or the app is case-sensitive", () => {
    @Controller()
    class Cased {
      @MessageHandler('Ping', { aliases: ['P'] })
      ping() {}

      @MessageHandler('pong', { caseSensitive: false })
      pong() {}
    }

    const [ping, pong] = new HandlerRegistry([Cased], { caseSensitive: true }).list({ kind: 'message' })

    expect(['Ping', 'ping', 'P', 'p'].map(words => ping.matches(words))).toEqual([true, false, true, false])
    expect(pong.matches('PONG')).toBe(true)
  })

  it('returns a new list each call, so a caller changing one cannot change the registry', () => {
    const registry = new HandlerRegistry([SettingsController])
    const first = registry.list()
    first.length = 0

    expect(registry.list().length).toBeGreaterThan(0)
  })
})
