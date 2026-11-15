import {
  ApplicationCommandType,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  ContextMenuCommandBuilder,
  type MessageContextMenuCommandInteraction,
  type UserContextMenuCommandInteraction,
} from 'discord.js'
import { vi } from 'vitest'
import { Logger } from '@src/common/logger.js'
import { MeoCordFactory } from '@src/core/meocord-factory.js'
import { Command, CommandBuilder, Controller, MeoCord } from '@src/decorator/index.js'
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
afterEach(() => vi.restoreAllMocks())

/** The warnings about context menu handlers' params arguments. */
const paramsWarnings = () => warned.filter(line => /declares? a params argument/.test(line))

const contextMenuBuilder = (kind: ApplicationCommandType.User | ApplicationCommandType.Message) => {
  @CommandBuilder(CommandType.CONTEXT_MENU)
  class Builder {
    build(commandName: string) {
      return new ContextMenuCommandBuilder().setName(commandName).setType(kind)
    }
  }
  return Builder
}

const create = (...controllers: (new (...args: any[]) => unknown)[]) => {
  @MeoCord({ controllers, clientOptions: { intents: [] } })
  class App {}
  MeoCordFactory.create(App)
}

describe('a context menu handler that declares a params argument', () => {
  it('is named at create(), a user and a message context menu handler in one warning', () => {
    @Controller()
    class Reports {
      @Command('report', contextMenuBuilder(ApplicationCommandType.User))
      async report(_interaction: UserContextMenuCommandInteraction, { reason }: { reason: string }) {
        return reason
      }

      @Command('quote', contextMenuBuilder(ApplicationCommandType.Message))
      async quote(_interaction: MessageContextMenuCommandInteraction, _params: Record<string, unknown>) {}
    }

    create(Reports)

    expect(paramsWarnings()).toEqual([
      [
        '2 context menu handlers declare a params argument they are never given:',
        '  Reports.report: a context menu command has no options, so its second argument is always {}.',
        '  Reports.quote: a context menu command has no options, so its second argument is always {}.',
        'Remove the argument. In the next major version (5.0), such a handler fails to compile.',
      ].join('\n'),
    ])
  })

  it('is named alone, and on a handler declared with CommandType.CONTEXT_MENU and no builder', () => {
    @Controller()
    class Reports {
      @Command('report', CommandType.CONTEXT_MENU)
      async report(_interaction: UserContextMenuCommandInteraction, _params: Record<string, unknown>) {}
    }

    create(Reports)

    expect(paramsWarnings()).toEqual([
      [
        '1 context menu handler declares a params argument it is never given:',
        '  Reports.report: a context menu command has no options, so its second argument is always {}.',
        'Remove the argument. In the next major version (5.0), such a handler fails to compile.',
      ].join('\n'),
    ])
  })

  it('is named once for a method that handles two context menu commands', () => {
    @Controller()
    class Reports {
      @Command('report', contextMenuBuilder(ApplicationCommandType.User))
      @Command('flag', contextMenuBuilder(ApplicationCommandType.Message))
      async report(_interaction: UserContextMenuCommandInteraction | MessageContextMenuCommandInteraction, _params: Record<string, unknown>) {}
    }

    create(Reports)

    expect(paramsWarnings()).toHaveLength(1)
    expect(paramsWarnings()[0]).toContain('1 context menu handler declares')
  })

  it('is named in the testing module too, as it compiles', () => {
    @Controller()
    class Reports {
      @Command('report', contextMenuBuilder(ApplicationCommandType.User))
      async report(_interaction: UserContextMenuCommandInteraction, _params: Record<string, unknown>) {}
    }

    MeoCordTestingModule.create({ controllers: [Reports] }).compile()

    expect(paramsWarnings()).toEqual([expect.stringContaining('  Reports.report: a context menu command has no options')])
  })

  it('leaves alone a context menu handler with only its interaction, a slash command and a button with params', () => {
    @Controller()
    class Handlers {
      @Command('report', contextMenuBuilder(ApplicationCommandType.User))
      async report(_interaction: UserContextMenuCommandInteraction) {}

      @Command('stats', CommandType.SLASH)
      async stats(_interaction: ChatInputCommandInteraction, _params: { period: string }) {}

      @Command('page/{n}', CommandType.BUTTON)
      async page(_interaction: ButtonInteraction, _params: { n: string }) {}
    }

    create(Handlers)
    MeoCordTestingModule.create({ controllers: [Handlers] }).compile()

    expect(paramsWarnings()).toEqual([])
  })

  // The check reads the method's `length`, which stops before a parameter with a default value and leaves out a rest
  // parameter; 5.0's type check catches such a handler instead
  it('misses a second parameter with a default value, and a rest parameter', () => {
    @Controller()
    class Reports {
      @Command('report', contextMenuBuilder(ApplicationCommandType.User))
      async report(_interaction: UserContextMenuCommandInteraction, _params: Record<string, unknown> = {}) {}

      @Command('quote', contextMenuBuilder(ApplicationCommandType.Message))
      async quote(...args: [MessageContextMenuCommandInteraction, Record<string, unknown>]) {
        return args
      }
    }

    create(Reports)

    expect(paramsWarnings()).toEqual([])
  })
})
