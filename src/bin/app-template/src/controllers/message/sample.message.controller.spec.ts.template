import { createMockMessage, MeoCordTestingModule } from 'meocord/testing'
import { SampleMessageController } from '@src/controllers/message/sample.message.controller.js'

describe('SampleMessageController', () => {
  const module = MeoCordTestingModule.create({ controllers: [SampleMessageController] }).compile()

  // dispatch routes the message as the bot does, to every handler that takes it
  it('replies to "baka"', async () => {
    const message = createMockMessage({ content: 'baka' })

    await module.dispatch(message)

    expect(message.reply).toHaveBeenCalledWith('You Baka!')
  })

  it('leaves any other message unanswered', async () => {
    const message = createMockMessage({ content: 'hello' })

    const { ran } = await module.dispatch(message)

    expect(ran).toBe(true)
    expect(message.reply).not.toHaveBeenCalled()
  })
})
