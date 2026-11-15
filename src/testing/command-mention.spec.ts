import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js'
import { commandMention } from '@src/common/index.js'
import { Command, CommandBuilder, Controller } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { createChatInputOptions, createMockInteraction, MeoCordTestingModule } from '@src/testing/index.js'
import { fixedCommandId, SNOWFLAKE } from '@src/testing/testing-command-ids.js'

@CommandBuilder(CommandType.SLASH)
class SettingsBuilder {
  build(name: string) {
    return new SlashCommandBuilder()
      .setName(name)
      .setDescription('Settings')
      .addSubcommand(sub => sub.setName('channel').setDescription('Channel'))
      .addSubcommand(sub => sub.setName('show').setDescription('Show'))
  }
}

@CommandBuilder(CommandType.SLASH)
class HelpBuilder {
  build(name: string) {
    return new SlashCommandBuilder().setName(name).setDescription('Help')
  }
}

const mentioned: string[] = []

@Controller()
class SettingsController {
  @Command('settings', SettingsBuilder)
  @Command('settings show', CommandType.SLASH)
  async show(interaction: ChatInputCommandInteraction) {
    mentioned.push(await commandMention('settings channel', interaction))
  }

  @Command('help', HelpBuilder)
  async help(interaction: ChatInputCommandInteraction) {
    mentioned.push(await commandMention('help', interaction))
  }
}

const settingsShow = () => createMockInteraction(ChatInputCommandInteraction, { commandName: 'settings', options: createChatInputOptions({ subcommand: 'show' }) })

beforeEach(() => {
  mentioned.length = 0
})

describe('commandMention in a testing module', () => {
  it('answers in invoke from the commands the controllers declare, with a fixed snowflake-shaped ID and no request', async () => {
    const module = MeoCordTestingModule.create({ controllers: [SettingsController] }).compile()

    await module.invoke(SettingsController, 'show', settingsShow())

    expect(mentioned).toEqual([`</settings channel:${fixedCommandId('settings')}>`])
    expect(fixedCommandId('settings')).toMatch(SNOWFLAKE)
    expect(fixedCommandId('settings')).not.toBe(fixedCommandId('help'))
  })

  it('answers in dispatch, with the ID overrideCommandId sets', async () => {
    const module = MeoCordTestingModule.create({ controllers: [SettingsController] }).overrideCommandId('help', '123456789012345678').compile()

    await module.dispatch(createMockInteraction(ChatInputCommandInteraction, { commandName: 'help' }))

    expect(mentioned).toEqual(['</help:123456789012345678>'])
  })

  it('checks the path as the bot does', async () => {
    @Controller()
    class WrongController {
      @Command('help', HelpBuilder)
      async help(interaction: ChatInputCommandInteraction) {
        await commandMention('settings', interaction)
      }
    }
    const module = MeoCordTestingModule.create({ controllers: [WrongController] }).compile()

    const run = module.invoke(WrongController, 'help', createMockInteraction(ChatInputCommandInteraction, { commandName: 'help' }))

    await expect(run).rejects.toThrow(RangeError)
    await expect(run).rejects.toThrow('"settings" names no command of this app\'s')
  })

  it('refuses a mention outside any of the module\'s calls, with a mock no call has used', async () => {
    MeoCordTestingModule.create({ controllers: [SettingsController] }).compile()

    await expect(commandMention('help', settingsShow())).rejects.toThrow('commandMention: the client belongs to no MeoCord app.')
  })

  it.each([
    ['an ID that is not snowflake-shaped', 'help', '42', TypeError, "overrideCommandId('help') takes an ID of 17 to 20 digits"],
    ['a name no controller declares', 'halp', '123456789012345678', RangeError, "overrideCommandId('halp'): no controller of this module declares"],
    ['a subcommand path', 'settings show', '123456789012345678', RangeError, "overrideCommandId('settings show'): no controller"],
  ])('overrideCommandId refuses %s', (_name, command, id, kind, message) => {
    const builder = MeoCordTestingModule.create({ controllers: [SettingsController] })

    expect(() => builder.overrideCommandId(command, id)).toThrow(kind)
    expect(() => builder.overrideCommandId(command, id)).toThrow(message)
  })
})
