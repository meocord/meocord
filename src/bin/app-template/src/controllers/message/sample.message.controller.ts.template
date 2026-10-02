import { MessageHandler, Controller } from 'meocord/decorator'
import { Message } from 'discord.js'
import { Logger } from 'meocord/common'

@Controller()
export class SampleMessageController {
  private readonly logger = new Logger(SampleMessageController.name)

  @MessageHandler('baka')
  async baka(message: Message): Promise<void> {
    try {
      await message.reply(`You Baka!`)
    } catch (error) {
      this.logger.error('Error replying to command', error)
    }
  }

  @MessageHandler()
  async handleGeneralMessage(message: Message): Promise<void> {
    try {
      this.logger.info(`Received message: ${message.content}`)
      // TODO: Implement your message handler logic here
    } catch (error) {
      this.logger.error('Error handling the message', error)
    }
  }
}
