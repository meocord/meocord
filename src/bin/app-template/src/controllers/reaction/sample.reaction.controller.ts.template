import { MessageReaction } from 'discord.js'
import { Controller, ReactionHandler } from 'meocord/decorator'
import { Logger } from 'meocord/common'
import { ReactionHandlerAction } from 'meocord/enum'
import { type ReactionEvent } from 'meocord/interface'

@Controller()
export class SampleReactionController {
  private readonly logger = new Logger(SampleReactionController.name)

  // Reactions from bots, this one's included, reach a handler only with { bots: true }
  @ReactionHandler('😋')
  async handleReaction(reaction: MessageReaction, { user, action }: ReactionEvent) {
    if (action !== ReactionHandlerAction.ADD) return
    await reaction.message.reply(`${user.username ?? 'Someone'} reacted with 😋!`)
  }

  // Runs for every reaction, after the handlers for its emoji
  @ReactionHandler()
  async handleAnyReaction(reaction: MessageReaction, { action }: ReactionEvent) {
    const verb = action === ReactionHandlerAction.ADD ? 'added' : 'removed'
    this.logger.log(`Reaction ${reaction.emoji.name} ${verb}.`)
  }
}
