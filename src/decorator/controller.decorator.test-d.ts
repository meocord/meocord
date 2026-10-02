import { describe, expectTypeOf, it } from 'vitest'
import {
  ApplicationCommandType,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChannelSelectMenuInteraction,
  type ChatInputCommandInteraction,
  ContextMenuCommandBuilder,
  type MentionableSelectMenuInteraction,
  type MessageContextMenuCommandInteraction,
  type ModalSubmitInteraction,
  type PrimaryEntryPointCommandInteraction,
  type RoleSelectMenuInteraction,
  SlashCommandBuilder,
  type StringSelectMenuInteraction,
  type UserContextMenuCommandInteraction,
  type UserSelectMenuInteraction,
} from 'discord.js'
import { Autocomplete, Command } from './controller.decorator.js'
import { CommandBuilder } from './command-builder.decorator.js'
import { CommandType } from '@src/enum/index.js'
import type {
  CommandBuilderBase,
  CommandInteractionType,
  PrimaryEntryPointCommandData,
} from '@src/interface/command-decorator.interface.js'

/**
 * Which interaction a handler may declare, checked by the compiler; most of it has no
 * runtime counterpart. The negative cases are assertions too — an unfulfilled
 * `@ts-expect-error` fails.
 */

@CommandBuilder(CommandType.SLASH)
class PingBuilder implements CommandBuilderBase<CommandType.SLASH> {
  build(commandName: string) {
    return new SlashCommandBuilder().setName(commandName).setDescription('ping')
  }
}

// Adding an option narrows the chain to SlashCommandOptionsOnlyBuilder, and a subcommand to
// SlashCommandSubcommandsOnlyBuilder. The docs' first slash command is the options case.
@CommandBuilder(CommandType.SLASH)
export class GreetBuilder implements CommandBuilderBase<CommandType.SLASH> {
  build(commandName: string) {
    return new SlashCommandBuilder()
      .setName(commandName)
      .setDescription('greet')
      .addStringOption(option => option.setName('name').setDescription('who').setRequired(true))
  }
}

@CommandBuilder(CommandType.SLASH)
export class SettingsBuilder implements CommandBuilderBase<CommandType.SLASH> {
  build(commandName: string) {
    return new SlashCommandBuilder()
      .setName(commandName)
      .setDescription('settings')
      .addSubcommand(sub => sub.setName('show').setDescription('show settings'))
  }
}

@CommandBuilder(CommandType.CONTEXT_MENU)
class ReportBuilder implements CommandBuilderBase<CommandType.CONTEXT_MENU> {
  build(commandName: string) {
    return new ContextMenuCommandBuilder().setName(commandName).setType(ApplicationCommandType.User)
  }
}

@CommandBuilder(CommandType.CONTEXT_MENU)
class QuoteBuilder implements CommandBuilderBase<CommandType.CONTEXT_MENU> {
  build(commandName: string) {
    return new ContextMenuCommandBuilder().setType(ApplicationCommandType.Message).setName(commandName)
  }
}

declare const eitherKind: boolean

// Its kind is only known at runtime
@CommandBuilder(CommandType.CONTEXT_MENU)
class EitherBuilder implements CommandBuilderBase<CommandType.CONTEXT_MENU> {
  build(commandName: string) {
    return new ContextMenuCommandBuilder()
      .setName(commandName)
      .setType(eitherKind ? ApplicationCommandType.User : ApplicationCommandType.Message)
  }
}

@CommandBuilder(CommandType.PRIMARY_ENTRY_POINT)
class LaunchBuilder implements CommandBuilderBase<CommandType.PRIMARY_ENTRY_POINT> {
  build(commandName: string): PrimaryEntryPointCommandData {
    return { type: ApplicationCommandType.PrimaryEntryPoint, name: commandName, description: 'launch' }
  }
}

describe('CommandInteractionType', () => {
  it('maps every component command type to the one interaction it can receive', () => {
    expectTypeOf<CommandInteractionType<never, CommandType.BUTTON>>().toEqualTypeOf<ButtonInteraction>()
    expectTypeOf<CommandInteractionType<never, CommandType.SELECT_MENU>>().toEqualTypeOf<StringSelectMenuInteraction>()
    expectTypeOf<
      CommandInteractionType<never, CommandType.USER_SELECT_MENU>
    >().toEqualTypeOf<UserSelectMenuInteraction>()
    expectTypeOf<
      CommandInteractionType<never, CommandType.ROLE_SELECT_MENU>
    >().toEqualTypeOf<RoleSelectMenuInteraction>()
    expectTypeOf<
      CommandInteractionType<never, CommandType.MENTIONABLE_SELECT_MENU>
    >().toEqualTypeOf<MentionableSelectMenuInteraction>()
    expectTypeOf<
      CommandInteractionType<never, CommandType.CHANNEL_SELECT_MENU>
    >().toEqualTypeOf<ChannelSelectMenuInteraction>()
    expectTypeOf<CommandInteractionType<never, CommandType.MODAL_SUBMIT>>().toEqualTypeOf<ModalSubmitInteraction>()
  })

  it('maps each builder to the interaction its command produces', () => {
    expectTypeOf<
      CommandInteractionType<CommandType.SLASH, typeof PingBuilder>
    >().toEqualTypeOf<ChatInputCommandInteraction>()
    expectTypeOf<
      CommandInteractionType<CommandType.CONTEXT_MENU, typeof ReportBuilder>
    >().toEqualTypeOf<UserContextMenuCommandInteraction>()
    expectTypeOf<
      CommandInteractionType<CommandType.CONTEXT_MENU, typeof QuoteBuilder>
    >().toEqualTypeOf<MessageContextMenuCommandInteraction>()
    expectTypeOf<CommandInteractionType<CommandType.CONTEXT_MENU, typeof EitherBuilder>>().toEqualTypeOf<
      UserContextMenuCommandInteraction | MessageContextMenuCommandInteraction
    >()
    expectTypeOf<
      CommandInteractionType<CommandType.PRIMARY_ENTRY_POINT, typeof LaunchBuilder>
    >().toEqualTypeOf<PrimaryEntryPointCommandInteraction>()
  })
})

describe('@Command', () => {
  it('accepts a handler typed for the command type it declares', () => {
    class Accepted {
      @Command('pick/{scope}', CommandType.USER_SELECT_MENU)
      users(_interaction: UserSelectMenuInteraction) {
        // asserted at the type level only
      }

      @Command('pick/{scope}', CommandType.CHANNEL_SELECT_MENU)
      channels(_interaction: ChannelSelectMenuInteraction) {
        // asserted at the type level only
      }

      @Command('launch', CommandType.PRIMARY_ENTRY_POINT)
      launch(_interaction: PrimaryEntryPointCommandInteraction) {
        // asserted at the type level only
      }

      @Command('ping', PingBuilder)
      ping(_interaction: ChatInputCommandInteraction) {
        // asserted at the type level only
      }

      @Command('report', ReportBuilder)
      report(_interaction: UserContextMenuCommandInteraction | MessageContextMenuCommandInteraction) {
        // asserted at the type level only
      }

      @Command('launch', LaunchBuilder)
      launchBuilt(_interaction: PrimaryEntryPointCommandInteraction) {
        // asserted at the type level only
      }
    }

    expectTypeOf<Accepted>().toBeObject()
  })

  it("types a context menu handler with the kind its builder's setType() names, and refuses the other", () => {
    class ContextMenus {
      @Command('report', ReportBuilder)
      reportUser(_interaction: UserContextMenuCommandInteraction) {
        // asserted at the type level only
      }

      @Command('quote', QuoteBuilder)
      quote(_interaction: MessageContextMenuCommandInteraction) {
        // asserted at the type level only
      }

      // Taking either kind accepts the one the builder names
      @Command('report', ReportBuilder)
      reportAny(_interaction: UserContextMenuCommandInteraction | MessageContextMenuCommandInteraction) {
        // asserted at the type level only
      }

      // @ts-expect-error the builder registers a user command, so a message interaction never reaches it
      @Command('report', ReportBuilder)
      reportMessage(_interaction: MessageContextMenuCommandInteraction) {
        // asserted at the type level only
      }

      // @ts-expect-error the builder registers a message command, so a user interaction never reaches it
      @Command('quote', QuoteBuilder)
      quoteUser(_interaction: UserContextMenuCommandInteraction) {
        // asserted at the type level only
      }

      // @ts-expect-error a chat input interaction never reaches a context menu handler
      @Command('report', ReportBuilder)
      chat(_interaction: ChatInputCommandInteraction) {
        // asserted at the type level only
      }
    }

    expectTypeOf<ContextMenus>().toBeObject()
  })

  it('lets a handler declare either kind, or one, when the compiler cannot tell which its builder registers', () => {
    class Unknown {
      @Command('either', EitherBuilder)
      either(_interaction: UserContextMenuCommandInteraction | MessageContextMenuCommandInteraction) {
        // asserted at the type level only
      }

      // Checked against the builder as the bot starts
      @Command('either', EitherBuilder)
      one(_interaction: MessageContextMenuCommandInteraction) {
        // asserted at the type level only
      }

      @Command('any', CommandType.CONTEXT_MENU)
      any(_interaction: UserContextMenuCommandInteraction | MessageContextMenuCommandInteraction) {
        // asserted at the type level only
      }
    }

    expectTypeOf<Unknown>().toBeObject()
  })

  it('rejects a handler typed for a different select menu', () => {
    class Rejected {
      // @ts-expect-error a user select menu handler cannot take a string select menu
      @Command('pick/{scope}', CommandType.USER_SELECT_MENU)
      users(_interaction: StringSelectMenuInteraction) {
        // asserted at the type level only
      }

      // @ts-expect-error an entry point handler cannot take a chat input interaction
      @Command('launch', CommandType.PRIMARY_ENTRY_POINT)
      launch(_interaction: ChatInputCommandInteraction) {
        // asserted at the type level only
      }
    }

    expectTypeOf<Rejected>().toBeObject()
  })

  it('rejects a slash builder bound to a component handler', () => {
    class Rejected {
      // @ts-expect-error a command built by a slash builder is a chat input interaction
      @Command('ping', PingBuilder)
      ping(_interaction: ButtonInteraction) {
        // asserted at the type level only
      }
    }

    expectTypeOf<Rejected>().toBeObject()
  })
})

describe('@Autocomplete', () => {
  it('accepts a handler typed for an autocomplete interaction', () => {
    class Accepted {
      @Autocomplete('search', 'query')
      complete(_interaction: AutocompleteInteraction) {
        // asserted at the type level only
      }

      @Autocomplete('search')
      completeAny(_interaction: AutocompleteInteraction, _params: Record<string, unknown>) {
        // asserted at the type level only
      }
    }

    expectTypeOf<Accepted>().toBeObject()
  })

  it('rejects a handler typed for a command interaction', () => {
    class Rejected {
      // @ts-expect-error autocomplete handlers receive an AutocompleteInteraction
      @Autocomplete('search', 'query')
      complete(_interaction: ChatInputCommandInteraction) {
        // asserted at the type level only
      }
    }

    expectTypeOf<Rejected>().toBeObject()
  })
})

describe('CommandBuilderBase', () => {
  it('types the entry point body as raw REST JSON', () => {
    expectTypeOf(new LaunchBuilder().build('launch')).toEqualTypeOf<PrimaryEntryPointCommandData>()
  })

  it('rejects a builder whose payload does not match its command type', () => {
    class Wrong implements CommandBuilderBase<CommandType.SLASH> {
      // @ts-expect-error a slash builder cannot return a context menu builder
      build(commandName: string) {
        return new ContextMenuCommandBuilder().setName(commandName).setType(ApplicationCommandType.User)
      }
    }

    expectTypeOf<Wrong>().toBeObject()
  })
})
