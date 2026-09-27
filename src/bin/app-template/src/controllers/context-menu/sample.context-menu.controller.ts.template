import { UserContextMenuCommandInteraction } from 'discord.js'
import { respond } from 'meocord/common'
import { Command, Controller, Cooldown } from 'meocord/decorator'
import { SampleCommandBuilder } from '@src/controllers/context-menu/builders/sample.builder'

@Controller()
export class SampleContextMenuController {
  @Command('sample-context-menu', SampleCommandBuilder)
  @Cooldown({ uses: 5, seconds: 60 })
  async handleContextMenu(interaction: UserContextMenuCommandInteraction) {
    await respond(interaction).send('This is sample reply of context menu command.')
  }
}
