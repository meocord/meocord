import { type ChatInputCommandInteraction, type Message, type MessageReaction } from 'discord.js'
import { respond } from 'meocord/common'
import { Command, Controller, MessageHandler, On, ReactionHandler } from 'meocord/decorator'
import { type ReactionHandlerOptions } from 'meocord/interface'
import { PingCommandBuilder } from '@src/controllers/builders/ping.builder'
import { report } from '@src/report'

/** What the automated checks drive: the one registered command, and the message and reaction handlers. */
@Controller()
export class SmokeController {
  @Command('e2e-ping', PingCommandBuilder)
  async ping(interaction: ChatInputCommandInteraction) {
    await respond(interaction).send({ content: 'pong' })
  }

  // Unlike @MessageHandler, a gateway event reaches the handler for messages from bots too
  @On('messageCreate')
  seen(message: Message) {
    report('message-event', { id: message.id, author: message.author.id })
  }

  @MessageHandler('e2e ping')
  async keyword(message: Message) {
    report('message-handler', { id: message.id })
    await message.reply('pong')
  }

  // The helper bot reacts, and a bot's reaction reaches only a handler that takes bots
  @ReactionHandler('✅', { bots: true })
  reacted(reaction: MessageReaction, { user, action }: ReactionHandlerOptions) {
    report('reaction', { message: reaction.message.id, user: user.id, action })
  }

  @ReactionHandler('✅')
  reactedByPerson(reaction: MessageReaction) {
    report('reaction-people-only', { message: reaction.message.id })
  }
}
