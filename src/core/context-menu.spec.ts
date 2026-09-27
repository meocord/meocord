import {
  ApplicationCommandType,
  ContextMenuCommandBuilder,
  MessageContextMenuCommandInteraction,
  UserContextMenuCommandInteraction,
} from 'discord.js'
import { Command, CommandBuilder, Controller } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { createMockInteraction, MeoCordTestingModule } from '@src/testing/index.js'

const ran: string[] = []

@CommandBuilder(CommandType.CONTEXT_MENU)
class ReportUserBuilder {
  build(name: string) {
    return new ContextMenuCommandBuilder().setName(name).setType(ApplicationCommandType.User)
  }
}

@CommandBuilder(CommandType.CONTEXT_MENU)
class ReportMessageBuilder {
  build(name: string) {
    return new ContextMenuCommandBuilder().setName(name).setType(ApplicationCommandType.Message)
  }
}

@Controller()
class ReportController {
  @Command('Report', ReportUserBuilder)
  reportUser() {
    ran.push('user')
  }

  @Command('Report', ReportMessageBuilder)
  reportMessage() {
    ran.push('message')
  }
}

beforeEach(() => {
  ran.length = 0
})

describe('context menu commands', () => {
  it('routes a User and a Message command of the same name each to its own handler', async () => {
    const module = MeoCordTestingModule.create({ controllers: [ReportController] }).compile()

    await module.dispatch(createMockInteraction(MessageContextMenuCommandInteraction, { commandName: 'Report' }))
    await module.dispatch(createMockInteraction(UserContextMenuCommandInteraction, { commandName: 'Report' }))

    expect(ran).toEqual(['message', 'user'])
  })
})
