import {
  ApplicationCommandType,
  type ChatInputCommandInteraction,
  ContextMenuCommandBuilder,
  type MessageContextMenuCommandInteraction,
  SlashCommandBuilder,
  type UserContextMenuCommandInteraction,
} from 'discord.js'
import { vi } from 'vitest'
import { Logger } from '@src/common/logger.js'
import { assertDistinctCommands } from '@src/core/command-conflicts.js'
import { Command, CommandBuilder, Controller } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { MeoCordTestingModule } from '@src/testing/index.js'

// A builder on a subcommand path warns as it is decorated; these tests are about what comes after
beforeEach(() => vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {}))

const slashBuilder = (fixedName?: string) => {
  @CommandBuilder(CommandType.SLASH)
  class StatsBuilder {
    build(commandName: string) {
      return new SlashCommandBuilder().setName(fixedName ?? commandName).setDescription('Stats')
    }
  }
  return StatsBuilder
}

const contextMenuBuilder = (kind: ApplicationCommandType.User | ApplicationCommandType.Message) => {
  @CommandBuilder(CommandType.CONTEXT_MENU)
  class ReportBuilder {
    build(commandName: string) {
      return new ContextMenuCommandBuilder().setName(commandName).setType(kind)
    }
  }
  return ReportBuilder
}

describe('assertDistinctCommands', () => {
  it('refuses two handlers of one slash command, naming both', () => {
    @Controller()
    class StatsController {
      @Command('stats', slashBuilder())
      async stats(_interaction: ChatInputCommandInteraction) {}
    }
    @Controller()
    class AdminController {
      @Command('stats', CommandType.SLASH)
      async adminStats(_interaction: ChatInputCommandInteraction) {}
    }

    expect(() => assertDistinctCommands([StatsController, AdminController])).toThrow(
      'StatsController.stats: it and AdminController.adminStats both handle the slash command "stats", so only ' +
        'StatsController.stats would ever run. Keep one handler for it, or give the other a name or subcommand path of its own.',
    )
  })

  it('refuses two handlers of one subcommand path, and takes a command and its subcommands apart', () => {
    @Controller()
    class SettingsController {
      @Command('settings', slashBuilder())
      async settings(_interaction: ChatInputCommandInteraction) {}

      @Command('settings notify email', CommandType.SLASH)
      async email(_interaction: ChatInputCommandInteraction) {}
    }
    @Controller()
    class NotifyController {
      @Command('settings notify email', CommandType.SLASH)
      async notifyEmail(_interaction: ChatInputCommandInteraction) {}
    }

    expect(() => assertDistinctCommands([SettingsController])).not.toThrow()
    expect(() => assertDistinctCommands([SettingsController, NotifyController])).toThrow(
      'SettingsController.email: it and NotifyController.notifyEmail both handle the slash command "settings notify email"',
    )
  })

  it('refuses two builder classes that build one command, naming both builders and both handlers', () => {
    const StatsBuilder = slashBuilder()
    // A copy of it under another name, which builds the same command
    @CommandBuilder(CommandType.SLASH)
    class CopiedStatsBuilder {
      build() {
        return new SlashCommandBuilder().setName('stats').setDescription('Stats')
      }
    }
    @Controller()
    class StatsController {
      @Command('stats', StatsBuilder)
      async stats(_interaction: ChatInputCommandInteraction) {}

      @Command('statistics', CopiedStatsBuilder)
      async statistics(_interaction: ChatInputCommandInteraction) {}
    }

    expect(() => assertDistinctCommands([StatsController])).toThrow(
      'StatsController.stats: its builder StatsBuilder and CopiedStatsBuilder on StatsController.statistics both build the slash command ' +
        '"stats", and Discord registers one command per name and type, so only the first would be. Keep one builder, ' +
        'on a single @Command, and declare the other handlers with CommandType.SLASH.',
    )
  })

  it('takes one builder on a command and its own subcommand path as one command', () => {
    const SettingsBuilder = slashBuilder('settings')
    @Controller()
    class SettingsController {
      @Command('settings', SettingsBuilder)
      async settings(_interaction: ChatInputCommandInteraction) {}

      @Command('settings language', SettingsBuilder)
      async language(_interaction: ChatInputCommandInteraction) {}
    }

    expect(() => assertDistinctCommands([SettingsController])).not.toThrow()
  })

  it('takes a user and a message context menu of one name apart, and refuses two of one kind', () => {
    const UserReport = contextMenuBuilder(ApplicationCommandType.User)
    const MessageReport = contextMenuBuilder(ApplicationCommandType.Message)
    @Controller()
    class ReportController {
      @Command('Report', UserReport)
      async reportUser(_interaction: UserContextMenuCommandInteraction) {}

      @Command('Report', MessageReport)
      async reportMessage(_interaction: MessageContextMenuCommandInteraction) {}
    }
    @Controller()
    class ModerationController {
      @Command('Report', CommandType.CONTEXT_MENU)
      async report(_interaction: MessageContextMenuCommandInteraction) {}
    }

    expect(() => assertDistinctCommands([ReportController])).not.toThrow()
    // Without a builder, a handler takes both kinds, so it meets the first
    expect(() => assertDistinctCommands([ReportController, ModerationController])).toThrow(
      'ReportController.reportUser: it and ModerationController.report both handle the user context menu command "Report"',
    )
  })

  it('reads a controller listed twice as one', () => {
    @Controller()
    class StatsController {
      @Command('stats', slashBuilder())
      async stats(_interaction: ChatInputCommandInteraction) {}
    }

    expect(() => assertDistinctCommands([StatsController, StatsController])).not.toThrow()
  })
})

// As the app does when it is created, so a test builds nothing the bot would refuse to start
describe('the testing module', () => {
  it('refuses two handlers of one command as it compiles', () => {
    @Controller()
    class StatsController {
      @Command('stats', CommandType.SLASH)
      async stats(_interaction: ChatInputCommandInteraction) {}
    }
    @Controller()
    class AdminController {
      @Command('stats', CommandType.SLASH)
      async adminStats(_interaction: ChatInputCommandInteraction) {}
    }

    expect(() => MeoCordTestingModule.create({ controllers: [StatsController, AdminController] }).compile()).toThrow(
      'StatsController.stats: it and AdminController.adminStats both handle the slash command "stats"',
    )
  })
})
