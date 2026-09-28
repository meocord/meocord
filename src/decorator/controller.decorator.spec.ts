import {
  Autocomplete,
  Command,
  getAutocompleteHandlers,
  findAmbiguousRoutes,
  getCommandMap,
  getMessageHandlers,
  getReactionHandlers,
  MessageHandler,
  ReactionHandler,
} from '@src/decorator/controller.decorator.js'
import { Controller } from '@src/decorator/controller-class.decorator.js'
import { CommandBuilder } from '@src/decorator/command-builder.decorator.js'
import { ApplicationCommandType, ContextMenuCommandBuilder, type MessageContextMenuCommandInteraction, SlashCommandBuilder } from 'discord.js'
import { type ChatInputCommandInteraction } from 'discord.js'
import { CommandType, MetadataKey } from '@src/enum/index.js'
import {
  ButtonInteraction,
  ChannelSelectMenuInteraction,
  MentionableSelectMenuInteraction,
  PrimaryEntryPointCommandInteraction,
  RoleSelectMenuInteraction,
  StringSelectMenuInteraction,
  UserSelectMenuInteraction,
} from 'discord.js'
import { createMockInteraction } from '@src/testing/index.js'
import { Logger } from '@src/common/logger.js'
import { buildComponentRoutes } from '@src/core/component-routes.js'

describe('@MessageHandler', () => {
  it('registers a handler with a pattern and its options', () => {
    class TestController {
      @MessageHandler('hello')
      handleHello(..._args: any[]) {}
    }

    const handlers = getMessageHandlers(TestController.prototype)
    expect(handlers).toHaveLength(1)
    expect(handlers[0]).toEqual({ pattern: 'hello', method: 'handleHello', options: {} })
  })

  it('registers a handler without a pattern', () => {
    class TestController {
      @MessageHandler()
      handleAny(..._args: any[]) {}
    }

    const handlers = getMessageHandlers(TestController.prototype)
    expect(handlers[0].pattern).toBeUndefined()
    expect(handlers[0].method).toBe('handleAny')
  })

  it('registers multiple handlers on the same class', () => {
    class TestController {
      @MessageHandler('hello')
      handleHello(..._args: any[]) {}

      @MessageHandler('bye')
      handleBye(..._args: any[]) {}
    }

    expect(getMessageHandlers(TestController.prototype)).toHaveLength(2)
  })
})

describe('@ReactionHandler', () => {
  it('registers a handler with an emoji', () => {
    class TestController {
      @ReactionHandler('👍')
      handleThumbsUp(..._args: any[]) {}
    }

    const handlers = getReactionHandlers(TestController.prototype)
    expect(handlers[0]).toEqual({ emoji: '👍', method: 'handleThumbsUp', settings: {} })
  })

  it('registers a handler without an emoji', () => {
    class TestController {
      @ReactionHandler()
      handleAny(..._args: any[]) {}
    }

    const handlers = getReactionHandlers(TestController.prototype)
    expect(handlers[0].emoji).toBeUndefined()
    expect(handlers[0].method).toBe('handleAny')
  })

  it('registers multiple reaction handlers', () => {
    class TestController {
      @ReactionHandler('👍')
      handleLike(..._args: any[]) {}

      @ReactionHandler('👎')
      handleDislike(..._args: any[]) {}
    }

    expect(getReactionHandlers(TestController.prototype)).toHaveLength(2)
  })
})

describe('@Command', () => {
  it('registers a SLASH command with the correct type and method name', () => {
    class TestController {
      @Command('ping', CommandType.SLASH)
      ping(..._args: any[]) {}
    }

    const commandMap = getCommandMap(TestController.prototype)
    expect(commandMap['ping']).toBeDefined()
    expect(commandMap['ping'][0].type).toBe(CommandType.SLASH)
    expect(commandMap['ping'][0].methodName).toBe('ping')
  })

  it('registers a BUTTON command with a regex pattern', () => {
    class TestController {
      @Command('btn/{id}', CommandType.BUTTON)
      handleBtn(..._args: any[]) {}
    }

    const commandMap = getCommandMap(TestController.prototype)
    const meta = commandMap['btn/{id}'][0]
    expect(meta.regex).toBeInstanceOf(RegExp)
    expect(meta.dynamicParams).toContain('id')
  })

  it('matches dynamic BUTTON command IDs correctly', () => {
    class TestController {
      @Command('profile/{userId}', CommandType.BUTTON)
      handleProfile(..._args: any[]) {}
    }

    const { regex } = getCommandMap(TestController.prototype)['profile/{userId}'][0]
    expect(regex!.test('profile/12345')).toBe(true)
    expect(regex!.test('profile/abc')).toBe(true)
    expect(regex!.test('profile/')).toBe(false)
    expect(regex!.test('other/12345')).toBe(false)
  })

  // A parameter stops at `/`, the same rule Express and Rails use for a path segment.
  // That is what lets a uuid be captured whole -- a hyphen inside it is data, not
  // structure -- and what keeps neighbouring patterns from taking each other's ids.
  describe('parameter matching', () => {
    const regexFor = (pattern: string) => {
      class TestController {
        @Command(pattern, CommandType.BUTTON)
        handle(..._args: any[]) {}
      }
      return getCommandMap(TestController.prototype)[pattern][0].regex!
    }

    it('captures a value containing hyphens', () => {
      expect(regexFor('profile/{uuid}').exec('profile/8400e29b-41d4-a716')?.groups).toEqual({
        uuid: '8400e29b-41d4-a716',
      })
    })

    it('captures dots, underscores and colons', () => {
      expect(regexFor('k/{key}').exec('k/a.b_c:d')?.groups?.key).toBe('a.b_c:d')
    })

    it('stops a parameter at the separator', () => {
      expect(regexFor('profile/{uuid}').test('profile/abc/123')).toBe(false)
    })

    it('keeps a hyphenated value out of the following parameter', () => {
      expect(regexFor('profile/{uuid}/{id}').exec('profile/8400e29b-41d4-a716/99')?.groups).toEqual({
        uuid: '8400e29b-41d4-a716',
        id: '99',
      })
    })

    it('still requires a parameter to capture something', () => {
      expect(regexFor('profile/{userId}').test('profile/')).toBe(false)
    })

    it('does not let a shorter pattern take a longer id', () => {
      expect(regexFor('profile/{uuid}').test('profile/abc/123')).toBe(false)
      expect(regexFor('profile/{uuid}/{id}').test('profile/abc')).toBe(false)
    })
  })

  // A parameter that shares a segment with a literal has no boundary a sibling can be
  // told apart by: `profile-{uuid}` and `profile-{uuid}-{id}` both take `profile-a-b`.
  // Rejecting the shape at registration is the only point where it can still be fixed.
  describe('segment validation', () => {
    const declare = (pattern: string) => () => {
      class TestController {
        @Command(pattern, CommandType.BUTTON)
        handle(..._args: any[]) {}
      }
      return TestController
    }

    it('rejects a parameter preceded by anything but the separator', () => {
      expect(declare('profile-{uuid}')).toThrow(/segment/i)
    })

    it('rejects a parameter followed by anything but the separator', () => {
      expect(declare('profile/{uuid}-suffix')).toThrow(/segment/i)
    })

    it('rejects two parameters sharing a segment', () => {
      expect(declare('{a}-{b}')).toThrow(/segment/i)
    })

    it('names the offending parameter and the pattern', () => {
      expect(declare('gi-profile-{ownerId}-{uid}')).toThrow(/ownerId/)
      expect(declare('gi-profile-{ownerId}-{uid}')).toThrow(/gi-profile-\{ownerId}-\{uid}/)
    })

    it('accepts a parameter occupying a whole segment', () => {
      expect(declare('profile/{uuid}')).not.toThrow()
      expect(declare('profile/{uuid}/{id}')).not.toThrow()
    })

    it('accepts a hyphen inside a literal segment', () => {
      expect(declare('gi-profile/{ownerId}/{uid}')).not.toThrow()
    })

    it('accepts a pattern that is only a parameter', () => {
      expect(declare('{uuid}')).not.toThrow()
    })

    it('accepts a parameter between literal segments', () => {
      expect(declare('a/{b}/c')).not.toThrow()
    })

    it('leaves patterns without parameters alone', () => {
      expect(declare('gi-profile-static')).not.toThrow()
    })
  })

  describe('specificity', () => {
    const rank = (pattern: string) => {
      class TestController {
        @Command(pattern, CommandType.BUTTON)
        handle(..._args: any[]) {}
      }
      return getCommandMap(TestController.prototype)[pattern][0].specificity!
    }

    it('ranks the pattern spelling out more of the id above the one leaving it to a parameter', () => {
      expect(rank('profile/summary/{ownerId}/{uid}')).toBeGreaterThan(rank('profile/{uuid}/{uid}'))
    })

    it('breaks a tie between equal-length patterns by parameter count', () => {
      expect(rank('abcd/{a}')).toBeGreaterThan(rank('abc/{a}/{b}'))
    })
  })

  // Different segment counts cannot collide, and neither can segments whose literals
  // differ. What is left is a pair like `a/{x}/c` and `a/b/{y}`: both take `a/b/c`,
  // and neither is more literal than the other, so ranking cannot settle it.
  describe('findAmbiguousRoutes', () => {
    it('reports a pair that trades a literal for a parameter in each direction', () => {
      expect(findAmbiguousRoutes(['a/{x}/c', 'a/b/{y}'])).toEqual([['a/{x}/c', 'a/b/{y}']])
    })

    it('clears patterns of different segment counts', () => {
      expect(findAmbiguousRoutes(['profile/{uuid}', 'profile/{uuid}/{id}'])).toEqual([])
    })

    it('clears patterns whose literals differ', () => {
      expect(findAmbiguousRoutes(['profile/{uuid}', 'settings/{uuid}'])).toEqual([])
    })

    it('reports a broad pattern against a literal sibling of the same shape', () => {
      expect(findAmbiguousRoutes(['profile/summary/{uid}', 'profile/{uuid}/{uid}'])).toEqual([
        ['profile/summary/{uid}', 'profile/{uuid}/{uid}'],
      ])
    })

    it('reports each pair once rather than in both orders', () => {
      expect(findAmbiguousRoutes(['a/{x}', 'a/{y}', 'a/{z}'])).toHaveLength(3)
    })

    it('returns nothing for a single pattern', () => {
      expect(findAmbiguousRoutes(['profile/{uuid}'])).toEqual([])
    })

    it('returns nothing for no patterns', () => {
      expect(findAmbiguousRoutes([])).toEqual([])
    })
  })

  it('registers multiple commands on the same class', () => {
    class TestController {
      @Command('ping', CommandType.SLASH)
      ping(..._args: any[]) {}

      @Command('pong', CommandType.SLASH)
      pong(..._args: any[]) {}
    }

    const commandMap = getCommandMap(TestController.prototype)
    expect(commandMap['ping']).toBeDefined()
    expect(commandMap['pong']).toBeDefined()
  })

  it('does not create a regex for SLASH commands', () => {
    class TestController {
      @Command('ping', CommandType.SLASH)
      ping(..._args: any[]) {}
    }

    const meta = getCommandMap(TestController.prototype)['ping'][0]
    expect(meta.regex).toBeUndefined()
  })
})

describe('@Controller', () => {
  it('makes the class inversify-injectable', () => {
    @Controller()
    class TestController {}

    expect(Reflect.getMetadata(MetadataKey.Injectable, TestController)).toBe(true)
  })

  it('does not throw when applied to an already-injectable class', () => {
    @Controller()
    class TestController {}

    expect(() => Controller()(TestController)).not.toThrow()
  })
})

describe('getMessageHandlers', () => {
  it('returns empty array for a class with no handlers', () => {
    class NoHandlers {}
    expect(getMessageHandlers(NoHandlers.prototype)).toEqual([])
  })
})

describe('getReactionHandlers', () => {
  it('returns empty array for a class with no handlers', () => {
    class NoHandlers {}
    expect(getReactionHandlers(NoHandlers.prototype)).toEqual([])
  })
})

describe('@Command interaction type validation', () => {
  const controllerFor = (type: CommandType) => {
    class TestController {
      received: unknown

      @Command('thing', type)
      handle(interaction: any) {
        this.received = interaction
      }
    }
    return new TestController()
  }

  // Each entity select menu is its own component type on the wire. Accepting one for
  // another would hand the handler an interaction whose resolved data it cannot read.
  const cases: [CommandType, { prototype: any; name: string }][] = [
    [CommandType.SELECT_MENU, StringSelectMenuInteraction],
    [CommandType.USER_SELECT_MENU, UserSelectMenuInteraction],
    [CommandType.ROLE_SELECT_MENU, RoleSelectMenuInteraction],
    [CommandType.MENTIONABLE_SELECT_MENU, MentionableSelectMenuInteraction],
    [CommandType.CHANNEL_SELECT_MENU, ChannelSelectMenuInteraction],
    [CommandType.PRIMARY_ENTRY_POINT, PrimaryEntryPointCommandInteraction],
  ]

  it.each(cases)('passes a matching interaction through for %s', (type, InteractionClass) => {
    const controller = controllerFor(type)
    const interaction = createMockInteraction(InteractionClass)

    controller.handle(interaction)

    expect(controller.received).toBe(interaction)
  })

  it.each(cases)('rejects a button where %s was declared', type => {
    const controller = controllerFor(type)

    expect(() => controller.handle(createMockInteraction(ButtonInteraction))).toThrow(
      'Invalid interaction type passed to @Command for method: handle',
    )
  })

  it('rejects a string select menu where a user select menu was declared', () => {
    const controller = controllerFor(CommandType.USER_SELECT_MENU)

    expect(() => controller.handle(createMockInteraction(StringSelectMenuInteraction))).toThrow(
      'Invalid interaction type passed to @Command',
    )
  })

  // A subcommand handler is declared with the plain CommandType and no builder, so
  // nothing extra is registered with Discord for it.
  it('registers a subcommand path without a builder', () => {
    class TestController {
      @Command('settings notify email', CommandType.SLASH)
      handle(..._args: any[]) {}
    }

    const meta = getCommandMap(TestController.prototype)['settings notify email'][0]
    expect(meta.builder).toBeUndefined()
    expect(meta.regex).toBeUndefined()
  })

  // Entry point commands are registered by name like any other command, so they must
  // not be run through the customId pattern parser -- which would reject a name
  // containing a placeholder-looking character.
  it('does not build a customId pattern for an entry point command', () => {
    class TestController {
      @Command('launch', CommandType.PRIMARY_ENTRY_POINT)
      handle(..._args: any[]) {}
    }

    expect(getCommandMap(TestController.prototype)['launch'][0].regex).toBeUndefined()
  })
})

describe('@Autocomplete', () => {
  it('registers a handler for one option of a command', () => {
    class TestController {
      @Autocomplete('search', 'query')
      complete(..._args: any[]) {}
    }

    expect(getAutocompleteHandlers(TestController.prototype)).toEqual([
      { commandPath: 'search', optionName: 'query', methodName: 'complete' },
    ])
  })

  it('registers a command-wide handler when no option is named', () => {
    class TestController {
      @Autocomplete('search')
      complete(..._args: any[]) {}
    }

    expect(getAutocompleteHandlers(TestController.prototype)[0]).toMatchObject({
      commandPath: 'search',
      optionName: undefined,
    })
  })

  it('accepts a subcommand path', () => {
    class TestController {
      @Autocomplete('settings notify email', 'address')
      complete(..._args: any[]) {}
    }

    expect(getAutocompleteHandlers(TestController.prototype)[0].commandPath).toBe('settings notify email')
  })

  // A command-wide handler is a fallback, not a shadow: declaring it first must not
  // stop an option-specific handler from claiming the option it was written for.
  it('orders option-specific handlers ahead of command-wide ones', () => {
    class TestController {
      @Autocomplete('search')
      completeAnything(..._args: any[]) {}

      @Autocomplete('search', 'query')
      completeQuery(..._args: any[]) {}
    }

    expect(getAutocompleteHandlers(TestController.prototype).map(handler => handler.methodName)).toEqual([
      'completeQuery',
      'completeAnything',
    ])
  })

  it('returns an empty list for a controller with no autocomplete handlers', () => {
    class NoHandlers {}

    expect(getAutocompleteHandlers(NoHandlers.prototype)).toEqual([])
  })
})

describe('controller inheritance', () => {
  class BaseController {
    @Command('base', CommandType.SLASH)
    base(..._args: any[]) {}

    @Command('base/{id}', CommandType.BUTTON)
    baseButton(..._args: any[]) {}

    @MessageHandler('base')
    baseMessage(..._args: any[]) {}

    @ReactionHandler('👍')
    baseReaction(..._args: any[]) {}

    @Autocomplete('base', 'query')
    baseComplete(..._args: any[]) {}
  }

  class ChildController extends BaseController {
    @Command('child', CommandType.SLASH)
    child(..._args: any[]) {}

    @Command('child/{id}', CommandType.BUTTON)
    childButton(..._args: any[]) {}

    @MessageHandler('child')
    childMessage(..._args: any[]) {}

    @ReactionHandler('👎')
    childReaction(..._args: any[]) {}

    @Autocomplete('child', 'query')
    childComplete(..._args: any[]) {}
  }

  it("keeps a subclass's handlers out of its base class", () => {
    expect(Object.keys(getCommandMap(BaseController.prototype))).toEqual(['base', 'base/{id}'])
    expect(getMessageHandlers(BaseController.prototype).map(handler => handler.method)).toEqual(['baseMessage'])
    expect(getReactionHandlers(BaseController.prototype).map(handler => handler.method)).toEqual(['baseReaction'])
    expect(getAutocompleteHandlers(BaseController.prototype).map(handler => handler.methodName)).toEqual([
      'baseComplete',
    ])
    expect(buildComponentRoutes([BaseController]).map(route => route.pattern)).toEqual(['base/{id}'])
  })

  it('gives the subclass its own handlers and the inherited ones', () => {
    expect(Object.keys(getCommandMap(ChildController.prototype))).toEqual(['base', 'base/{id}', 'child', 'child/{id}'])
    expect(getMessageHandlers(ChildController.prototype).map(handler => handler.method)).toEqual([
      'baseMessage',
      'childMessage',
    ])
    expect(getReactionHandlers(ChildController.prototype).map(handler => handler.method)).toEqual([
      'baseReaction',
      'childReaction',
    ])
    expect(getAutocompleteHandlers(ChildController.prototype).map(handler => handler.methodName)).toEqual([
      'baseComplete',
      'childComplete',
    ])
    expect(buildComponentRoutes([ChildController]).map(route => route.pattern).sort()).toEqual([
      'base/{id}',
      'child/{id}',
    ])
  })

  it('keeps sibling subclasses apart', () => {
    class OtherController extends BaseController {
      @Command('base', CommandType.SLASH)
      other(..._args: any[]) {}
    }

    expect(getCommandMap(OtherController.prototype).base.map(meta => meta.methodName)).toEqual(['base', 'other'])
    expect(getCommandMap(BaseController.prototype).base.map(meta => meta.methodName)).toEqual(['base'])
    expect(Object.keys(getCommandMap(ChildController.prototype))).not.toContain('other')
  })
})

// discord.js builders validate while they are set, at decoration time, with errors that name neither
// the command nor the field.
describe('a builder that throws', () => {
  it('is reported with the builder and the command it was building', () => {
    @CommandBuilder(CommandType.SLASH)
    class BanBuilder {
      build(commandName: string) {
        return new SlashCommandBuilder()
          .setName(commandName)
          .setDescription('Ban')
          .setDescriptionLocalizations({ ja: 'x'.repeat(104) })
      }
    }

    expect(() => {
      @Controller()
      class BanController {
        @Command('ban', BanBuilder)
        async ban(_interaction: ChatInputCommandInteraction) {}
      }
      void BanController
    }).toThrow('BanBuilder could not build "ban": Invalid string length')
  })
})

// A subcommand is described by its command's builder: one on the path either fails to build or is registered twice
describe('a builder on a subcommand path', () => {
  @CommandBuilder(CommandType.SLASH)
  class SettingsCommandBuilder {
    build(commandName: string) {
      return new SlashCommandBuilder().setName(commandName).setDescription('Change your settings')
    }
  }

  const declareInstead =
    "Declare the handler with @Command('settings notify email', CommandType.SLASH), and give the builder to " +
    "@Command('settings')."

  it('is refused naming the handler and what to declare, when building from the path fails', () => {
    expect(() => {
      @Controller()
      class SettingsSlashController {
        @Command('settings notify email', SettingsCommandBuilder)
        async notifyEmail(_interaction: ChatInputCommandInteraction) {}
      }
      void SettingsSlashController
    }).toThrow(
      'SettingsSlashController.notifyEmail: the builder SettingsCommandBuilder is declared on "settings notify email", which ' +
        'is a subcommand path: the builder of its command, "settings", describes it, and building it from the path ' +
        `failed (Invalid string format). ${declareInstead}`,
    )
  })

  // It works, since the builder names its command itself and registers once, so it is kept, with a warning
  it('is warned about once, naming the handler, when the builder names its command itself', () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {})
    @CommandBuilder(CommandType.SLASH)
    class FixedNameBuilder {
      build() {
        return new SlashCommandBuilder().setName('settings').setDescription('Change your settings')
      }
    }

    @Controller()
    class SettingsSlashController {
      @Command('settings notify email', FixedNameBuilder)
      async notifyEmail(_interaction: ChatInputCommandInteraction) {}
    }

    expect(getCommandMap(SettingsSlashController.prototype)['settings notify email']).toHaveLength(1)
    expect(warn.mock.calls).toEqual([
      [
        'SettingsSlashController.notifyEmail: the builder FixedNameBuilder is declared on "settings notify email", which is ' +
          `a subcommand path; the builder of its command, "settings", describes it. ${declareInstead}`,
      ],
    ])
    warn.mockRestore()
  })

  it('leaves a context menu name with spaces alone, which Discord allows', () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {})
    @CommandBuilder(CommandType.CONTEXT_MENU)
    class ReportMessageBuilder {
      build(commandName: string) {
        return new ContextMenuCommandBuilder().setName(commandName).setType(ApplicationCommandType.Message)
      }
    }

    expect(() => {
      @Controller()
      class ReportController {
        @Command('Report message', ReportMessageBuilder)
        async report(_interaction: MessageContextMenuCommandInteraction) {}
      }
      void ReportController
    }).not.toThrow()
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})
