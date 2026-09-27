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

  it("refuses to invoke a handler with the other kind's interaction, as dispatch would never send it there", async () => {
    const module = MeoCordTestingModule.create({ controllers: [ReportController] }).compile()
    const user = createMockInteraction(UserContextMenuCommandInteraction, { commandName: 'Report' })

    await expect(module.invoke(ReportController, 'reportMessage', user)).rejects.toThrow(
      "A user context menu command 'Report' does not match ReportController.reportMessage, which handles the message context menu command 'Report'.",
    )
    await expect(module.invoke(ReportController, 'reportUser', user)).resolves.toMatchObject({ ran: true })
    expect(ran).toEqual(['user'])
  })
})
