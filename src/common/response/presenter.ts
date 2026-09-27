import {
  type APIContainerComponent,
  type APIEmbed,
  ComponentType,
  ContainerBuilder,
  EmbedBuilder,
  resolveColor,
  TextDisplayBuilder,
} from 'discord.js'
import { type PresentedError, type ResponseContext, type ResponsePresenter, type ResponseView } from '@src/interface/index.js'
import { renderText, translatorOfClient } from '@src/common/meocord-text.js'

/** One of the presenter's texts, in the context's locale through the app's translator; English for a context without one. */
const text = ({ interaction, locale }: Partial<ResponseContext>, key: string) =>
  renderText(translatorOfClient(interaction?.client), locale, { key })

/**
 * MeoCord's own presenter, styled by the call's theme: a "Working on it…" loading view with the theme's loading
 * emoji in its primary colour, and errors under "Oops!" in the colour their tone names, `warning` for the user's own
 * outcome and `danger` for a fault. Both texts are in the user's language where the app's catalogs have it.
 */
export const defaultPresenter: ResponsePresenter = {
  loading: (context: ResponseContext) => ({
    text: text(context, 'meocord.presenter.loading'),
    emoji: context.theme.emojis.loading,
    color: context.theme.colors.primary,
  }),
  error: (context: ResponseContext, { message, tone }: PresentedError) => ({
    title: text(context, 'meocord.presenter.errorTitle'),
    text: message,
    color: context.theme.colors[tone],
  }),
}

/** The id MeoCord gives the containers it renders, so a view left behind can be found again. */
export const RENDERED_CONTAINER_ID = 0x4d43

const presenters = new WeakMap<object, ResponsePresenter>()

/** Sets the presenter for the interactions a client receives. */
export function setPresenter(client: object, presenter: ResponsePresenter): void {
  presenters.set(client, presenter)
}

/** The presenter for an interaction's client, or the default one. */
export function presenterFor(client: object | null | undefined): ResponsePresenter {
  return (client && presenters.get(client)) || defaultPresenter
}

function textOf(view: ResponseView): string {
  return view.emoji ? `${view.emoji} ${view.text}` : view.text
}

/** A view as an embed. */
export function renderEmbed(view: ResponseView): APIEmbed {
  const embed = new EmbedBuilder().setDescription(textOf(view))
  if (view.title) embed.setTitle(view.title)
  if (view.color !== undefined) embed.setColor(view.color)
  return embed.toJSON()
}

/** A view as a Components V2 container, carrying MeoCord's id. */
export function renderContainer(view: ResponseView): APIContainerComponent {
  const container = new ContainerBuilder().setId(RENDERED_CONTAINER_ID)
  if (view.color !== undefined) container.setAccentColor(resolveColor(view.color))
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(view.title ? `### ${view.title}\n${textOf(view)}` : textOf(view)),
  )
  const json = container.toJSON()
  const extra = (view.components ?? []).map(component =>
    'toJSON' in component ? component.toJSON() : component,
  ) as APIContainerComponent['components']
  return { ...json, type: ComponentType.Container, components: [...json.components, ...extra] }
}
