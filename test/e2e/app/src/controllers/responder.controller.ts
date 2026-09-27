import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  MessageFlags,
} from 'discord.js'
import { getInstallContext, respond } from 'meocord/common'
import { Command, Controller, Defer, UseGuard } from 'meocord/decorator'
import { CommandType } from 'meocord/enum'
import { PanelCommandBuilder, PrivateFailCommandBuilder } from '@src/controllers/builders/responder.builders'
import { OwnerGuard } from '@src/guards/owner.guard'
import { report, sleep } from '@src/report'

const button = (customId: string, label: string, style = ButtonStyle.Secondary) =>
  new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style)

function panel(ownerId: string) {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      button('e2e/eager', 'Eager, 2s'),
      button('e2e/auto-fast', 'Auto, fast'),
      button('e2e/auto-slow', 'Auto, 3s'),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      button('e2e/slow/a', 'Slow A, 5s'),
      button('e2e/slow/b', 'Slow B, 5s'),
      button('e2e/follow-up', 'Follow-up only, 2s'),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      button(`e2e/owner/${ownerId}`, 'Owner only', ButtonStyle.Primary),
      button('e2e/fail', 'Fail', ButtonStyle.Danger),
      button(`e2e/expiry/${ownerId}`, 'Answer after 15 min'),
    ),
  ]
}

const stamp = () => new Date().toISOString().slice(11, 19)

/** The manual checklist in CONTRIBUTING.md, "Checking against real Discord", drives these. */
@Controller()
export class ResponderController {
  @Command('e2e-panel', PanelCommandBuilder)
  async panel(interaction: ChatInputCommandInteraction) {
    const { where, botInstalled } = getInstallContext(interaction)
    report('interaction', { command: 'e2e-panel', where, botInstalled })
    await respond(interaction).acknowledge({ ephemeral: interaction.options.getBoolean('private') ?? false })
    await respond(interaction).send({
      content: `Where: ${where}; bot present: ${botInstalled}. Opened ${stamp()} UTC.`,
      components: panel(interaction.user.id),
    })
  }

  @Command('e2e-private-fail', PrivateFailCommandBuilder)
  @Defer({ ephemeral: true })
  async privateFail(_interaction: ChatInputCommandInteraction) {
    await sleep(1_000)
    throw new Error('The private deferral failed on purpose.')
  }

  @Command('e2e/eager', CommandType.BUTTON)
  @Defer()
  async eager(interaction: ButtonInteraction) {
    await sleep(2_000)
    await respond(interaction).send({ content: `Eager: updated ${stamp()} UTC.` })
  }

  @Command('e2e/auto-fast', CommandType.BUTTON)
  @Defer({ mode: 'auto' })
  async autoFast(interaction: ButtonInteraction) {
    await respond(interaction).send({ content: `Auto, fast: updated ${stamp()} UTC.` })
  }

  @Command('e2e/auto-slow', CommandType.BUTTON)
  @Defer({ mode: 'auto' })
  async autoSlow(interaction: ButtonInteraction) {
    await sleep(3_000)
    await respond(interaction).send({ content: `Auto, slow: updated ${stamp()} UTC.` })
  }

  // Returns without answering, so each click puts back only its own button
  @Command('e2e/slow/{which}', CommandType.BUTTON)
  @Defer({ disable: 'clicked' })
  async slow(_interaction: ButtonInteraction, { which }: { which: string }) {
    report('slow', { which })
    await sleep(5_000)
  }

  // Answers only with a follow-up, so the panel it locked has to be put back as it was
  @Command('e2e/follow-up', CommandType.BUTTON)
  @Defer()
  async followUpOnly(interaction: ButtonInteraction) {
    await sleep(2_000)
    await respond(interaction).followUp({ content: `Follow-up only: sent ${stamp()} UTC.`, flags: MessageFlags.Ephemeral })
  }

  @Command('e2e/owner/{ownerId}', CommandType.BUTTON)
  @UseGuard(OwnerGuard)
  @Defer()
  async ownerOnly(interaction: ButtonInteraction) {
    await sleep(1_000)
    await respond(interaction).send({ content: `Owner only: handled for its owner ${stamp()} UTC.` })
  }

  @Command('e2e/fail', CommandType.BUTTON)
  @Defer()
  async fail(_interaction: ButtonInteraction) {
    await sleep(1_000)
    throw new Error('The button failed on purpose.')
  }

  @Command('e2e/expiry/{ownerId}', CommandType.BUTTON)
  @UseGuard(OwnerGuard)
  @Defer()
  async expiry(interaction: ButtonInteraction) {
    await sleep(15.5 * 60_000)
    await respond(interaction).send({ content: `Answered after the token expired, ${stamp()} UTC.` })
  }
}
