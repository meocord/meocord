import { ButtonInteraction } from 'discord.js'
import { GuardDeniedError } from 'meocord/common'
import {
  createMockInteraction,
  createMockMessage,
  createMockUser,
  getResponse,
  MeoCordTestingModule,
} from 'meocord/testing'
import { SampleButtonController } from '@src/controllers/button/sample.button.controller.js'

const clickBy = (userId: string, customId = 'button-click') => {
  const user = createMockUser()
  user.id = userId
  return createMockInteraction(ButtonInteraction, { customId, user, message: createMockMessage() })
}

describe('SampleButtonController', () => {
  const module = MeoCordTestingModule.create({ controllers: [SampleButtonController] }).compile()

  it('locks the message while it works, then answers', async () => {
    const interaction = clickBy('someone')

    await module.invoke(SampleButtonController, 'handleButton', interaction)

    const { calls } = getResponse(interaction)
    expect(calls.map(call => call.method)).toEqual(['deferUpdate', 'editReply', 'editReply'])
    expect(calls.at(-1)?.payload).toMatchObject({ content: 'Button clicked!' })
  })

  it('answers the owner of the button', async () => {
    const interaction = clickBy('owner', 'button-with/owner')

    // The customId's route gives the handler its ownerId
    await module.invoke(SampleButtonController, 'handleButtonWithId', interaction)

    expect(getResponse(interaction).calls.at(-1)?.payload).toMatchObject({ content: 'Button of <@owner> clicked!' })
  })

  it('denies anyone else before touching the message', async () => {
    const interaction = clickBy('stranger', 'button-with/owner')

    await expect(module.invoke(SampleButtonController, 'handleButtonWithId', interaction)).rejects.toThrow(
      GuardDeniedError,
    )
    expect(getResponse(interaction).calls.map(call => call.method)).toEqual(['deferUpdate'])
  })
})
