import {
  type APIContainerComponent,
  type APIEmbed,
  AttachmentBuilder,
  ComponentType,
  ContainerBuilder,
  EmbedBuilder,
  FileBuilder,
  MediaGalleryBuilder,
  resolveColor,
  SectionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from 'discord.js'
import {
  type PresentedError,
  type ResponseContext,
  type ResponseFile,
  type ResponsePresenter,
  type ResponseView,
} from '@src/interface/index.js'
import { renderText, translatorOfClient } from '@src/common/meocord-text.js'

/** One of the presenter's texts, in the context's locale through the app's translator; English for a context without one. */
const text = ({ interaction, locale }: Partial<ResponseContext>, key: string) =>
  renderText(translatorOfClient(interaction?.client), locale, { key })

/**
 * MeoCord's own presenter, styled by the call's theme: a "Working on it…" loading view with the theme's loading
 * emoji in its primary colour, and errors under "Oops!" in the colour their tone names, `warning` for the user's own
 * outcome and `danger` for a fault. Both texts are in the user's language where the app's catalogs have it.
 */
export const defaultPresenter = {
  loading: (context: ResponseContext): ResponseView => ({
    text: text(context, 'meocord.presenter.loading'),
    emoji: context.theme.emojis.loading,
    color: context.theme.colors.primary,
  }),
  error: (context: ResponseContext, { message, tone }: PresentedError): ResponseView => ({
    title: text(context, 'meocord.presenter.errorTitle'),
    text: message,
    color: context.theme.colors[tone],
  }),
} satisfies ResponsePresenter

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

/** Discord's limit of attachments on one message. */
export const ATTACHMENT_LIMIT = 10

/** Discord's default size limit of each uploaded file, for an interaction that does not give its own. */
export const DEFAULT_ATTACHMENT_SIZE_LIMIT = 20 * 1024 * 1024

const IMAGE = /\.(png|jpe?g|gif|webp)$/i

/** The name a view's file goes by, which its `attachment://` URL uses. */
function nameOf(file: ResponseFile): string {
  return file instanceof AttachmentBuilder ? (file.name ?? '') : file.name
}

/** The size of a view's file in bytes, when it holds its bytes rather than a path or a stream. */
function sizeOf(file: ResponseFile): number | undefined {
  const data = file instanceof AttachmentBuilder ? file.attachment : file.data
  return data instanceof Uint8Array ? data.byteLength : undefined
}

/** A view's files as discord.js sends them. */
export function attachmentsOf(view: ResponseView): AttachmentBuilder[] {
  return (view.files ?? []).map(file =>
    file instanceof AttachmentBuilder ? file : new AttachmentBuilder(Buffer.from(file.data), { name: file.name, description: file.description }),
  )
}

/**
 * Why Discord would refuse a view's files, if it would: more attachments than a message takes, counting the
 * `kept` ones a message it is added to keeps, or a file over `sizeLimit` bytes.
 */
export function filesProblem(view: ResponseView, { kept = 0, sizeLimit = DEFAULT_ATTACHMENT_SIZE_LIMIT } = {}): string | undefined {
  const files = view.files ?? []
  if (files.length === 0) return undefined
  if (files.length + kept > ATTACHMENT_LIMIT) {
    const total = kept > 0 ? `${files.length} files beside the ${kept} the message keeps` : `${files.length} files`
    return `it has ${total}, and Discord takes ${ATTACHMENT_LIMIT} files on a message`
  }
  const unnamed = files.find(file => !nameOf(file))
  if (unnamed) return 'a file has no name, which its attachment:// URL needs'
  const large = files.find(file => (sizeOf(file) ?? 0) > sizeLimit)
  if (large) return `${nameOf(large)} is ${sizeOf(large)} bytes, over the ${sizeLimit} bytes Discord takes for each file here`
  return undefined
}

/**
 * The view as Discord takes it: without its files, after `warn` says why, when {@link filesProblem} finds Discord
 * would refuse them, so the answer still reaches the user.
 */
export function withSendableFiles(
  view: ResponseView,
  limits: { kept?: number; sizeLimit?: number },
  warn: (problem: string) => void,
): ResponseView {
  const problem = filesProblem(view, limits)
  if (!problem) return view
  warn(problem)
  const { files: _files, ...rest } = view
  return rest
}

/** Where an image the view names is: one of its files by `attachment://`, or the URL it gives. */
function urlOf(view: ResponseView, image: string): string {
  return (view.files ?? []).some(file => nameOf(file) === image) ? `attachment://${image}` : image
}

/** The view's files its own components, image and thumbnail do not already show, which MeoCord shows for it. */
function unshownFiles(view: ResponseView): ResponseFile[] {
  const shown = JSON.stringify((view.components ?? []).map(component => ('toJSON' in component ? component.toJSON() : component)))
  const named = [view.image, view.thumbnail].filter((image): image is string => image !== undefined).map(image => urlOf(view, image))
  return (view.files ?? []).filter(file => {
    const url = `attachment://${nameOf(file)}`
    return !shown.includes(url) && !named.includes(url)
  })
}

/** A view as an embed: its image, or else its first image file not its thumbnail, as the embed's image. */
export function renderEmbed(view: ResponseView): APIEmbed {
  const embed = new EmbedBuilder().setDescription(textOf(view))
  if (view.title) embed.setTitle(view.title)
  if (view.color !== undefined) embed.setColor(view.color)
  const image = view.image ?? unshownFiles(view).map(nameOf).find(name => IMAGE.test(name))
  if (image) embed.setImage(urlOf(view, image))
  if (view.thumbnail) embed.setThumbnail(urlOf(view, view.thumbnail))
  return embed.toJSON()
}

/** A view as a Components V2 container, carrying MeoCord's id. */
export function renderContainer(view: ResponseView): APIContainerComponent {
  const container = new ContainerBuilder().setId(RENDERED_CONTAINER_ID)
  if (view.color !== undefined) container.setAccentColor(resolveColor(view.color))
  const text = new TextDisplayBuilder().setContent(view.title ? `### ${view.title}\n${textOf(view)}` : textOf(view))
  if (view.thumbnail) {
    container.addSectionComponents(
      new SectionBuilder().addTextDisplayComponents(text).setThumbnailAccessory(new ThumbnailBuilder().setURL(urlOf(view, view.thumbnail))),
    )
  } else container.addTextDisplayComponents(text)
  const files = unshownFiles(view).map(nameOf)
  const gallery = [...(view.image ? [urlOf(view, view.image)] : []), ...files.filter(name => IMAGE.test(name)).map(name => `attachment://${name}`)]
  if (gallery.length > 0) container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(...gallery.map(url => ({ media: { url } }))))
  for (const name of files.filter(name => !IMAGE.test(name))) container.addFileComponents(new FileBuilder().setURL(`attachment://${name}`))
  const json = container.toJSON()
  const extra = (view.components ?? []).map(component =>
    'toJSON' in component ? component.toJSON() : component,
  ) as APIContainerComponent['components']
  return { ...json, type: ComponentType.Container, components: [...json.components, ...extra] }
}
