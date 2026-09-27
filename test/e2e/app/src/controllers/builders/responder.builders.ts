import { ApplicationIntegrationType, InteractionContextType, SlashCommandBuilder } from 'discord.js'
import { CommandBuilder } from 'meocord/decorator'
import { CommandType } from 'meocord/enum'

/** Installable to a server and to a user, and usable in servers, the bot's DMs and other DMs and group DMs. */
const everywhere = (builder: SlashCommandBuilder) =>
  builder
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall)
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel)

@CommandBuilder(CommandType.SLASH)
export class PanelCommandBuilder {
  build(commandName: string) {
    return everywhere(new SlashCommandBuilder())
      .setName(commandName)
      .setDescription('MeoCord e2e: a panel of respond() and @Defer checks')
      .addBooleanOption(option => option.setName('private').setDescription('Show the panel only to you'))
  }
}

@CommandBuilder(CommandType.SLASH)
export class PrivateFailCommandBuilder {
  build(commandName: string) {
    return everywhere(new SlashCommandBuilder())
      .setName(commandName)
      .setDescription('MeoCord e2e: defers privately, then fails')
  }
}

@CommandBuilder(CommandType.SLASH)
export class CardCommandBuilder {
  build(commandName: string) {
    return everywhere(new SlashCommandBuilder())
      .setName(commandName)
      .setDescription('MeoCord e2e: a private Components V2 card with an image, a select and buttons')
  }
}
