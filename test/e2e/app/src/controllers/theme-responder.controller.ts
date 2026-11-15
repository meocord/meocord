import {
  ActionRowBuilder,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  type ChatInputCommandInteraction,
  ComponentType,
  ContainerBuilder,
  EmbedBuilder,
  MessageFlags,
  TextDisplayBuilder,
} from 'discord.js'
import { bindTheme, respond, UserError } from 'meocord/common'
import { Command, Controller, Defer } from 'meocord/decorator'
import { CommandType } from 'meocord/enum'
import { ThemeCommandBuilder } from '@src/controllers/builders/theme.builder'
import { sleep } from '@src/report'

const button = (customId: string, label: string, style = ButtonStyle.Secondary) =>
  new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style)

const buttons = () => [
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    button('e2e-theme/v2', 'Containers'),
    button('e2e-theme/follow-up', 'Follow-up'),
    button('e2e-theme/loading', 'Loading, 3s'),
  ),
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    button('e2e-theme/danger', 'Fail', ButtonStyle.Danger),
    button('e2e-theme/warning', 'Refuse'),
    button('e2e-theme/collect', 'Collector'),
  ),
]

const text = (content: string) => new TextDisplayBuilder().setContent(content)

/** The manual checklist's theme steps, in CONTRIBUTING.md: what a person checks by eye, which a bot cannot start. */
@Controller()
export class ThemeResponderController {
  @Command('e2e-theme', ThemeCommandBuilder)
  async theme(interaction: ChatInputCommandInteraction) {
    await respond(interaction).send({
      embeds: [
        { description: 'No colour: the theme’s primary' },
        { description: 'Colour 0: kept, no bar', color: 0 },
        new EmbedBuilder().setDescription('EmbedBuilder, no colour: the theme’s primary'),
        { description: '#26A042: kept', color: 0x26a042 },
      ],
      components: buttons(),
    })
  }

  @Command('e2e-theme/v2', CommandType.BUTTON)
  async containers(interaction: ButtonInteraction) {
    await respond(interaction).followUp({
      components: [
        new ContainerBuilder().addTextDisplayComponents(text('Container, no accent: the theme’s primary')),
        { type: ComponentType.Container, accent_color: null, components: [text('Container, accent null: no bar').toJSON()] },
      ],
      flags: MessageFlags.IsComponentsV2,
    })
  }

  @Command('e2e-theme/follow-up', CommandType.BUTTON)
  async followUp(interaction: ButtonInteraction) {
    await respond(interaction).followUp({ embeds: [{ description: 'Follow-up, no colour: the theme’s primary' }] })
  }

  @Command('e2e-theme/loading', CommandType.BUTTON)
  @Defer()
  async loading(interaction: ButtonInteraction) {
    await sleep(3_000)
    await respond(interaction).followUp({ content: 'Loading ended: the view showed the theme’s loading emoji in its primary colour.' })
  }

  @Command('e2e-theme/danger', CommandType.BUTTON)
  danger(_interaction: ButtonInteraction) {
    throw new Error('The theme showcase failed on purpose.')
  }

  @Command('e2e-theme/warning', CommandType.BUTTON)
  warning(_interaction: ButtonInteraction) {
    throw new UserError('The theme showcase refused this on purpose.')
  }

  @Command('e2e-theme/collect', CommandType.BUTTON)
  async collect(interaction: ButtonInteraction) {
    const message = await respond(interaction).followUp({
      content: 'Click Collected within a minute.',
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button('e2e-theme-collected', 'Collected'))],
    })
    // The collector's callback runs in the client's event; bindTheme gives it the handler's theme, rebuilt for each clicker
    message?.createMessageComponentCollector({ time: 60_000 }).on(
      'collect',
      bindTheme(async (click: ButtonInteraction) => {
        await respond(click).send({ content: '', embeds: [{ description: 'Collected, no colour: the theme’s primary' }], components: [] })
      }),
    )
  }
}
