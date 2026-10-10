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

/** Discord's limits on a message's text, counted by `String.length` as discord.js's builders count them. */
export const TEXT_LIMITS = { embed: 4096, v2: 4000, content: 2000 } as const

/** `text` cut to `limit` characters ending in `…`, on a code point boundary so no surrogate pair is split. */
export function fitText(text: string, limit: number): string {
  if (text.length <= limit) return text
  let cut = text.slice(0, Math.max(0, limit - 1))
  const last = cut.charCodeAt(cut.length - 1)
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1)
  return `${cut}…`
}

/**
 * An error's message as a presenter is given it: fitted to `limit`, and, when empty or only whitespace, which Discord
 * refuses as a text, MeoCord's generic error text, so a presenter that writes it as its text always renders.
 */
export function presentedMessage(message: string, limit: number, generic: () => string): string {
  return fitText(message.trim() === '' ? generic() : message, limit)
}

/**
 * The view's text after what MeoCord puts before it, its emoji and a Text Display's title line. When only those take
 * the two past `limit`, the text is cut so they fit; a text past `limit` by itself is left, a view MeoCord can't render.
 */
function textAfter(prefix: string, view: ResponseView, limit: number): string {
  const total = prefix.length + view.text.length
  if (total <= limit || view.text.length > limit || prefix.length >= limit) return prefix + view.text
  return prefix + fitText(view.text, limit - prefix.length)
}

const emojiOf = (view: ResponseView) => (view.emoji ? `${view.emoji} ` : '')

/** Discord's limit of attachments on one message. */
export const ATTACHMENT_LIMIT = 10

/** The most items Discord shows in one media gallery. */
const MEDIA_GALLERY_LIMIT = 10

/**
 * Discord's default size limit of each uploaded file, for a send without an interaction's `attachmentSizeLimit`:
 * "The default limit is `20 MiB` for all users", in discord-api-docs' Uploading Files (developers/reference.mdx).
 */
export const DEFAULT_ATTACHMENT_SIZE_LIMIT = 20 * 1024 * 1024

/** Discord's refusal of a request larger than it takes. */
const ENTITY_TOO_LARGE = 40005

/** Whether Discord refused a send as too large: its error 40005, or an HTTP 413 without one. */
export function isTooLarge(error: unknown): boolean {
  const { code, status } = (error ?? {}) as { code?: unknown; status?: unknown }
  return code === ENTITY_TOO_LARGE || status === 413
}

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
 * `kept` ones a message it is added to keeps, a file without a name, or a file over `sizeLimit` bytes.
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
  return withoutFiles(view)
}

/** The view without its files, and without an image or a thumbnail that named one of them. */
export function withoutFiles(view: ResponseView): ResponseView {
  const { files = [], image, thumbnail, ...rest } = view
  const names = new Set(files.map(nameOf))
  return {
    ...rest,
    ...(image !== undefined && !names.has(image) && { image }),
    ...(thumbnail !== undefined && !names.has(thumbnail) && { thumbnail }),
  }
}

/** The warning's reason when Discord refuses a send of a view's files as too large. */
export const REFUSED_AS_TOO_LARGE = 'Discord refused them as too large'

/** Where an image the view names is: one of its files by `attachment://`, or the URL it gives. */
function urlOf(view: ResponseView, image: string): string {
  return (view.files ?? []).some(file => nameOf(file) === image) ? `attachment://${image}` : image
}

/** Every `attachment://` URL in a value, such as the JSON of a view's components. */
function attachmentUrls(value: unknown, urls = new Set<string>()): Set<string> {
  if (typeof value === 'string') {
    if (value.startsWith('attachment://')) urls.add(value)
  } else if (Array.isArray(value)) for (const item of value) attachmentUrls(item, urls)
  else if (value && typeof value === 'object') for (const item of Object.values(value)) attachmentUrls(item, urls)
  return urls
}

/** The view's files its own components, image and thumbnail do not already show, which MeoCord shows for it. */
function unshownFiles(view: ResponseView): ResponseFile[] {
  const shown = attachmentUrls((view.components ?? []).map(component => ('toJSON' in component ? component.toJSON() : component)))
  for (const image of [view.image, view.thumbnail]) if (image !== undefined) shown.add(urlOf(view, image))
  return (view.files ?? []).filter(file => !shown.has(`attachment://${nameOf(file)}`))
}

/** A view as an embed: its image, or else its first image file not its thumbnail, as the embed's image. */
export function renderEmbed(view: ResponseView): APIEmbed {
  const embed = new EmbedBuilder().setDescription(textAfter(emojiOf(view), view, TEXT_LIMITS.embed))
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
  const titleLine = view.title ? `### ${view.title}\n` : ''
  const text = new TextDisplayBuilder().setContent(textAfter(titleLine + emojiOf(view), view, TEXT_LIMITS.v2))
  if (view.thumbnail) {
    container.addSectionComponents(
      new SectionBuilder().addTextDisplayComponents(text).setThumbnailAccessory(new ThumbnailBuilder().setURL(urlOf(view, view.thumbnail))),
    )
  } else container.addTextDisplayComponents(text)
  const files = unshownFiles(view).map(nameOf)
  const images = [...(view.image ? [urlOf(view, view.image)] : []), ...files.filter(name => IMAGE.test(name)).map(name => `attachment://${name}`)]
  // A gallery holds at most 10, and the image beside 10 image files makes 11, so they fill as many as they need
  for (let start = 0; start < images.length; start += MEDIA_GALLERY_LIMIT) {
    const gallery = images.slice(start, start + MEDIA_GALLERY_LIMIT)
    container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(...gallery.map(url => ({ media: { url } }))))
  }
  for (const name of files.filter(name => !IMAGE.test(name))) container.addFileComponents(new FileBuilder().setURL(`attachment://${name}`))
  const json = container.toJSON()
  const extra = (view.components ?? []).map(component =>
    'toJSON' in component ? component.toJSON() : component,
  ) as APIContainerComponent['components']
  return { ...json, type: ComponentType.Container, components: [...json.components, ...extra] }
}
