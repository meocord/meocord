import { MessageReaction, ReactionEmoji } from 'discord.js'
import { ReactionHandlerAction } from 'meocord/enum'
import { createMockInteraction, createMockMessage, createMockUser, MeoCordTestingModule } from 'meocord/testing'
import { SampleReactionController } from '@src/controllers/reaction/sample.reaction.controller.js'

const reactionWith = (name: string) =>
  createMockInteraction(MessageReaction, {
    emoji: createMockInteraction(ReactionEmoji, { name, id: null }),
    message: createMockMessage(),
  })

describe('SampleReactionController', () => {
  const module = MeoCordTestingModule.create({ controllers: [SampleReactionController] }).compile()

  // dispatch routes the reaction by its emoji, as the bot does
  it('replies to a 😋 reaction, naming who added it', async () => {
    const reaction = reactionWith('😋')

    await module.dispatch(reaction, { user: createMockUser({ username: 'ada' }) })

    expect(reaction.message.reply).toHaveBeenCalledWith('ada reacted with 😋!')
  })

  it('leaves another emoji, and a 😋 taken back, unanswered', async () => {
    const other = reactionWith('👍')
    const removed = reactionWith('😋')

    await module.dispatch(other, { user: createMockUser() })
    await module.dispatch(removed, { user: createMockUser(), action: ReactionHandlerAction.REMOVE })

    expect(other.message.reply).not.toHaveBeenCalled()
    expect(removed.message.reply).not.toHaveBeenCalled()
  })
})
