import path from 'path'
import { ComponentType } from 'discord.js'

const CDN_HOSTS = new Set(['cdn.discordapp.com', 'media.discordapp.net'])
const CDN_PATHS = ['/attachments/', '/ephemeral-attachments/']
/** A CDN upload's path: `/attachments/<channel>/<upload id>/<file name>`, under `ephemeral-attachments` when private. */
const UPLOAD_PATH = /^\/(?:ephemeral-)?attachments\/(\d+)\/(\d+)\/([^/]+)$/

type Json = Record<string, unknown>

/** Something with a JSON form, as discord.js builders are. */
interface Encodable {
  toJSON(): unknown
}

function toJson<T>(value: T | Encodable): T {
  return typeof (value as Encodable)?.toJSON === 'function' ? ((value as Encodable).toJSON() as T) : (value as T)
}

/** The file name of a Discord CDN attachment URL, or `undefined` for any other URL. */
export function attachmentFileName(url: unknown): string | undefined {
  if (typeof url !== 'string') return undefined
  try {
    const { hostname, pathname } = new URL(url)
    if (!CDN_HOSTS.has(hostname) || !CDN_PATHS.some(prefix => pathname.startsWith(prefix))) return undefined
    return decodeURIComponent(pathname.slice(pathname.lastIndexOf('/') + 1)) || undefined
  } catch {
    return undefined
  }
}

/** The channel, upload id and file name a Discord CDN upload URL names, or `undefined` for any other URL. */
function uploadPath(url: unknown): { channelId: string; id: string; filename: string } | undefined {
  if (typeof url !== 'string') return undefined
  try {
    const { hostname, pathname } = new URL(url)
    const match = CDN_HOSTS.has(hostname) ? UPLOAD_PATH.exec(pathname) : null
    return match ? { channelId: match[1], id: match[2], filename: decodeURIComponent(match[3]) } : undefined
  } catch {
    return undefined
  }
}

/**
 * An upload an edit lists to keep it. Discord lets `attachment://<filename>` reach a kept upload only when its entry
 * names the file as `filename`: an entry with only an `id`, or the `name` of a flattened discord.js `Attachment`, is
 * refused for Components V2 media.
 */
export interface ListedUpload {
  id: string
  filename: string
}

/** The media items of Components V2 components: gallery items, thumbnails and files, through sections and containers. */
function mediaIn(components: readonly unknown[]): Json[] {
  return components.flatMap(value => {
    const component = toJson<Json>(value as Json)
    switch (component?.type) {
      case ComponentType.MediaGallery:
        return ((component.items as Json[] | undefined) ?? []).map(item => item?.media as Json)
      case ComponentType.Thumbnail:
        return [component.media as Json]
      case ComponentType.File:
        return [component.file as Json]
      case ComponentType.Section:
        return mediaIn([component.accessory])
      case ComponentType.Container:
        return mediaIn((component.components as unknown[] | undefined) ?? [])
      default:
        return []
    }
  })
}

/** The URLs an embed shows images from: its image, thumbnail, and author and footer icons. */
function embedUrls(value: unknown): unknown[] {
  const embed = toJson<Json>(value as Json)
  const at = (key: string, field: string) => (embed?.[key] as Json | undefined)?.[field]
  return [at('image', 'url'), at('thumbnail', 'url'), at('author', 'icon_url'), at('footer', 'icon_url')]
}

/**
 * The uploads an edit that keeps `shown` on a message lists, each once: those its components' media and its embeds
 * show, and those the message's `attachments` hold, which are the uploads nothing shows. A media item names its upload
 * by `attachment_id`, or, once an edit re-sent its URL, by the URL's path; an embed only by the path. A path names an
 * upload only in the message's own channel: a URL copied from elsewhere is an image the message doesn't hold.
 */
export function listedUploads(
  shown: { components?: readonly unknown[]; embeds?: readonly unknown[] },
  attachments: Iterable<{ id?: unknown; name?: unknown }>,
  channelId: string | undefined,
): ListedUpload[] {
  const listed = new Map<string, ListedUpload>()
  const add = (id: unknown, filename: unknown) => {
    if (typeof id === 'string' && typeof filename === 'string' && !listed.has(id)) listed.set(id, { id, filename })
  }
  const own = (url: unknown) => {
    const upload = uploadPath(url)
    return upload && upload.channelId === channelId ? upload : undefined
  }
  for (const media of mediaIn(shown.components ?? [])) {
    if (typeof media?.attachment_id === 'string') add(media.attachment_id, attachmentFileName(media.url))
    else {
      const upload = own(media?.url)
      add(upload?.id, upload?.filename)
    }
  }
  for (const url of (shown.embeds ?? []).flatMap(embedUrls)) {
    const upload = own(url)
    add(upload?.id, upload?.filename)
  }
  for (const { id, name } of attachments) add(id, name)
  return [...listed.values()]
}

/**
 * The files a message has after an edit, as `attachment://` reaches them. `names` are the files the edit sends, the
 * entries it lists by `name`, and, unless it lists the ones to keep, the message's current attachments. `uploads` are
 * the uploads it lists as `{ id, filename }`, by id, each the newest of its file name: `attachment://` of a name two kept
 * uploads share reaches the newer, so the older keeps its URL.
 */
export interface KeptFiles {
  names: ReadonlySet<string>
  uploads: ReadonlyMap<string, string>
}

/** A snowflake's order; an id that is no snowflake counts as oldest. */
const age = (id: string): bigint => (/^\d+$/.test(id) ? BigInt(id) : -1n)

/** The `{ id, filename }` entries of an edit's `attachments`. */
function listedOf(payload: { attachments?: readonly unknown[] }): ListedUpload[] {
  return (payload.attachments ?? []).filter((entry): entry is ListedUpload => {
    const { id, filename } = (entry ?? {}) as { id?: unknown; filename?: unknown }
    return typeof id === 'string' && typeof filename === 'string'
  })
}

/** The files a message keeps through an edit: see {@link KeptFiles}. */
export function keptFiles(
  payload: { files?: readonly unknown[]; attachments?: readonly unknown[] },
  current: Iterable<{ name?: string | null }>,
): KeptFiles {
  const names = new Set<string>()
  for (const file of payload.files ?? []) {
    const name = fileName(file)
    if (name) names.add(name)
  }
  // An entry listed as { id, filename } has no name: it is kept by id below
  for (const attachment of payload.attachments ?? current) {
    const name = (attachment as { name?: unknown })?.name
    if (typeof name === 'string') names.add(name)
  }
  const newest = new Map<string, ListedUpload>()
  for (const upload of listedOf(payload)) {
    const other = newest.get(upload.filename)
    if (!other || age(upload.id) > age(other.id)) newest.set(upload.filename, upload)
  }
  return { names, uploads: new Map([...newest.values()].map(upload => [upload.id, upload.filename])) }
}

/**
 * The file names of the File components an edit lists the upload of, but whose `attachment://` a newer upload of the
 * same name takes. Such a File keeps its URL, which Discord refuses for a File.
 */
export function shadowedFiles(payload: { components?: readonly unknown[]; attachments?: readonly unknown[] }, kept: KeptFiles): string[] {
  const listed = new Map(listedOf(payload).map(upload => [upload.id, upload.filename]))
  // Without a listed upload nothing is read, so an app's builders are built once, as discord.js sends them
  if (listed.size === 0) return []
  const files = (payload.components ?? []).flatMap(function walk(value: unknown): Json[] {
    const component = toJson<Json>(value as Json)
    if (component?.type === ComponentType.File) return [component.file as Json]
    if (component?.type === ComponentType.Container) return ((component.components as unknown[] | undefined) ?? []).flatMap(walk)
    return []
  })
  return files.flatMap(file => {
    const id = typeof file?.attachment_id === 'string' ? file.attachment_id : uploadPath(file?.url)?.id
    const filename = id === undefined ? undefined : listed.get(id)
    return filename !== undefined && id !== undefined && !kept.uploads.has(id) ? [filename] : []
  })
}

function rewrite(url: unknown, kept: KeptFiles): unknown {
  const id = uploadPath(url)?.id
  const listed = id === undefined ? undefined : kept.uploads.get(id)
  if (listed !== undefined) return `attachment://${listed}`
  const name = attachmentFileName(url)
  return name && kept.names.has(name) ? `attachment://${name}` : url
}

function rewriteAt(target: Json | undefined, key: string, kept: KeptFiles): Json | undefined {
  if (!target || typeof target !== 'object') return target
  return key in target ? { ...target, [key]: rewrite(target[key], kept) } : target
}

function rewriteEmbed(embed: Json, kept: KeptFiles): Json {
  return {
    ...embed,
    ...(embed.image ? { image: rewriteAt(embed.image as Json, 'url', kept) } : {}),
    ...(embed.thumbnail ? { thumbnail: rewriteAt(embed.thumbnail as Json, 'url', kept) } : {}),
    ...(embed.author ? { author: rewriteAt(embed.author as Json, 'icon_url', kept) } : {}),
    ...(embed.footer ? { footer: rewriteAt(embed.footer as Json, 'icon_url', kept) } : {}),
  }
}

function rewriteComponent(component: Json, kept: KeptFiles): Json {
  switch (component.type) {
    case ComponentType.MediaGallery:
      return {
        ...component,
        items: (component.items as Json[]).map(item => ({ ...item, media: rewriteAt(item.media as Json, 'url', kept) })),
      }
    case ComponentType.Thumbnail:
      return { ...component, media: rewriteAt(component.media as Json, 'url', kept) }
    case ComponentType.File:
      return { ...component, file: rewriteAt(component.file as Json, 'url', kept) }
    case ComponentType.Section:
      return {
        ...component,
        accessory: rewriteComponent(component.accessory as Json, kept),
        components: (component.components as Json[]).map(child => rewriteComponent(child, kept)),
      }
    case ComponentType.Container:
      return { ...component, components: (component.components as Json[]).map(child => rewriteComponent(child, kept)) }
    default:
      return component
  }
}

/** The name a file sent in a payload's `files` goes by. */
export function fileName(file: unknown): string | undefined {
  if (typeof file === 'string') return path.basename(file)
  if (file && typeof file === 'object') {
    const named = file as { name?: unknown; attachment?: unknown }
    if (typeof named.name === 'string') return named.name
    if (typeof named.attachment === 'string') return path.basename(named.attachment)
  }
  return undefined
}

/**
 * Points embed images, thumbnails, author and footer icons, and Components V2 media, thumbnails and
 * files at `attachment://` when they are Discord CDN attachment URLs of a file the edited message
 * keeps, so re-sending a message's own content does not break its images. An upload listed by id is
 * matched by the id in its URL, any other file by name. Other URLs are unchanged.
 */
export function rewriteAttachmentUrls<P extends { embeds?: readonly unknown[]; components?: readonly unknown[] }>(
  payload: P,
  kept: KeptFiles,
): P {
  if (kept.names.size === 0 && kept.uploads.size === 0) return payload
  return {
    ...payload,
    ...(payload.embeds ? { embeds: payload.embeds.map(embed => rewriteEmbed(toJson<Json>(embed as Json), kept)) } : {}),
    ...(payload.components
      ? { components: payload.components.map(component => rewriteComponent(toJson<Json>(component as Json), kept)) }
      : {}),
  }
}
