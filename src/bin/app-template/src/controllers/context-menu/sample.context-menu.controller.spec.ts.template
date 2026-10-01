import { UserContextMenuCommandInteraction } from 'discord.js'
import { createMockInteraction, getResponse, MeoCordTestingModule } from 'meocord/testing'
import { SampleContextMenuController } from '@src/controllers/context-menu/sample.context-menu.controller.js'

describe('SampleContextMenuController', () => {
  const module = MeoCordTestingModule.create({ controllers: [SampleContextMenuController] }).compile()

  it('replies', async () => {
    const interaction = createMockInteraction(UserContextMenuCommandInteraction, { commandName: 'sample-context-menu' })

    await module.invoke(SampleContextMenuController, 'handleContextMenu', interaction)

    const [answer] = getResponse(interaction).calls
    expect(answer?.method).toBe('reply')
    expect(answer?.payload).toMatchObject({ content: 'This is sample reply of context menu command.' })
  })
})
