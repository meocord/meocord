import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  type StringSelectMenuInteraction,
  TextDisplayBuilder,
} from 'discord.js'
import { respond } from 'meocord/common'
import { Command, Controller, Defer } from 'meocord/decorator'
import { CommandType } from 'meocord/enum'
import { CardCommandBuilder } from '@src/controllers/builders/responder.builders'
import { report, sleep } from '@src/report'

// A 1x1 lossless WebP, uploaded with the card as its image
const IMAGE = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64')

const stamp = () => new Date().toISOString().slice(11, 19)

/** An option whose value is long JSON, as a real app's select carries state in its values. */
const option = (label: string, isDefault = false) => ({
  label,
  value: JSON.stringify({ theme: label.toLowerCase(), note: 'a value long enough to carry state, as apps do' }),
  emoji: { name: '⭐' },
  default: isDefault,
})

/**
 * A private Components V2 card: an uploaded image, a select with a default option, and buttons, each locked by
 * @Defer. The manual checklist in CONTRIBUTING.md, "Checking against real Discord", drives it.
 */
@Controller()
export class CardController {
  @Command('e2e-card', CardCommandBuilder)
  async card(interaction: ChatInputCommandInteraction) {
    report('interaction', { command: 'e2e-card' })
    const card = new ContainerBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### Card\nOpened ${stamp()} UTC.`))
      .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://card.webp')))
      .addActionRowComponents(
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder().setCustomId('e2e/card/pick').addOptions(option('Light'), option('Dark', true), option('Auto')),
        ),
      )
      .addActionRowComponents(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId('e2e/card/follow-up').setLabel('Follow-up only').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('e2e/card/slow').setLabel('Slow, 3s').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('e2e/card/fail').setLabel('Fail').setStyle(ButtonStyle.Danger),
        ),
      )
    await respond(interaction).send({
      flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
      components: [card],
      files: [new AttachmentBuilder(IMAGE, { name: 'card.webp' })],
    })
  }

  // Answers only with a follow-up, so the card it locked has to be put back as it was, its default option too
  @Command('e2e/card/pick', CommandType.SELECT_MENU)
  @Defer()
  async pick(interaction: StringSelectMenuInteraction, { values }: { values: string[] }) {
    await sleep(2_000)
    const picked = (JSON.parse(values[0]) as { theme: string }).theme
    await respond(interaction).followUp({ content: `Select, follow-up only: picked ${picked}, ${stamp()} UTC.`, flags: MessageFlags.Ephemeral })
  }

  @Command('e2e/card/follow-up', CommandType.BUTTON)
  @Defer()
  async followUpOnly(interaction: ButtonInteraction) {
    await sleep(2_000)
    await respond(interaction).followUp({ content: `Card, follow-up only: sent ${stamp()} UTC.`, flags: MessageFlags.Ephemeral })
  }

  // Returns without answering
  @Command('e2e/card/slow', CommandType.BUTTON)
  @Defer()
  async slow(_interaction: ButtonInteraction) {
    await sleep(3_000)
  }

  @Command('e2e/card/fail', CommandType.BUTTON)
  @Defer()
  async fail(_interaction: ButtonInteraction) {
    await sleep(1_000)
    throw new Error('The card failed on purpose.')
  }
}
