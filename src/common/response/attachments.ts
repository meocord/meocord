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
 * The files a message has after an edit, as `attachment://` reaches them. `names` are the files the edit sends: a URL
 * of a file of that name points at the new one. `uploads` are the kept uploads the edit's media may point at, by id,
 * each the newest of its file name: `attachment://` of a name two kept uploads share reaches the newer, so the older
 * keeps its URL.
 */
export interface KeptFiles {
  names: ReadonlySet<string>
  uploads: ReadonlyMap<string, string>
}

/** A snowflake's order; an id that is no snowflake counts as oldest. */
const age = (id: string): bigint => (/^\d+$/.test(id) ? BigInt(id) : -1n)

/** The `{ id, filename }` entries of an edit's `attachments`. */
function listedOf(attachments: readonly unknown[] | undefined): ListedUpload[] {
  return (attachments ?? []).filter((entry): entry is ListedUpload => {
    const { id, filename } = (entry ?? {}) as { id?: unknown; filename?: unknown }
    return typeof id === 'string' && typeof filename === 'string'
  })
}

/** The names of the files an edit sends. */
function sentNames(files: readonly unknown[] | undefined): Set<string> {
  return new Set((files ?? []).map(fileName).filter((name): name is string => name !== undefined))
}

/** `uploads` by id, each the newest of its file name. */
function newestOf(uploads: readonly ListedUpload[]): Map<string, string> {
  const newest = new Map<string, ListedUpload>()
  for (const upload of uploads) {
    const other = newest.get(upload.filename)
    if (!other || age(upload.id) > age(other.id)) newest.set(upload.filename, upload)
  }
  return new Map([...newest.values()].map(upload => [upload.id, upload.filename]))
}

/**
 * An `attachments` entry as Discord names its upload: a discord.js `Attachment`, or any entry with an `id` and a `name`
 * but no `filename`, becomes `{ id, filename }`, with its `description` when set. Discord resolves `attachment://` of a
 * Components V2 media item only through `filename`. Any other entry is left as it is.
 */
export function asListedEntry(entry: unknown): unknown {
  const { id, name, filename, description } = (entry ?? {}) as { id?: unknown; name?: unknown; filename?: unknown; description?: unknown }
  if (typeof id !== 'string' || typeof name !== 'string' || filename !== undefined) return entry
  return { id, filename: name, ...(typeof description === 'string' && description !== '' && { description }) }
}

/** The ids of the uploads a payload's media and embeds show by a CDN URL or, for media, by `attachment_id`. */
function shownIds(payload: { components?: readonly unknown[]; embeds?: readonly unknown[] }): Set<string> {
  const ids = new Set<string>()
  for (const media of mediaIn(payload.components ?? [])) {
    const id = typeof media?.attachment_id === 'string' ? media.attachment_id : uploadPath(media?.url)?.id
    if (id !== undefined) ids.add(id)
  }
  for (const url of (payload.embeds ?? []).flatMap(embedUrls)) {
    const id = uploadPath(url)?.id
    if (id !== undefined) ids.add(id)
  }
  return ids
}

/** How an edit keeps a message's uploads: see {@link keptUploads}. */
export interface KeptUploads<P> {
  /** The edit, with its entries reshaped, its list built when it needs one, and its media pointed at kept uploads. */
  payload: P
  /** The File components whose upload a newer one of its name shadows, which Discord then refuses. */
  shadowed: string[]
  /** Set when the edit's files and the uploads it shows pass Discord's limit, so it keeps none of them: those dropped. */
  overLimit?: { files: number; dropped: string[] }
}

/**
 * An edit of a message holding `own` uploads, as Discord takes it, so that the uploads it shows stay on the message and
 * attachment-backed:
 * - An edit that lists `attachments` keeps exactly those: each entry is only reshaped ({@link asListedEntry}), and its
 *   media point at the uploads it lists.
 * - One with neither `attachments` nor files keeps every upload: its media point at the message's own.
 * - One with files and no `attachments` would keep only the new files, as discord.js then lists them alone: it lists
 *   the message's own uploads it shows, unless those and the files pass `limit`.
 *
 * Only Discord CDN URLs of the message's own uploads are rewritten, to `attachment://<filename>`, and a URL of a file
 * the edit sends points at that file; `attachment://` and other URLs are left as they are.
 */
export function keptUploads<P extends { files?: readonly unknown[]; attachments?: readonly unknown[]; components?: readonly unknown[]; embeds?: readonly unknown[] }>(
  payload: P,
  own: readonly ListedUpload[],
  limit: number,
): KeptUploads<P> {
  const names = sentNames(payload.files)
  let edit = payload
  let candidates: readonly ListedUpload[]
  let overLimit: KeptUploads<P>['overLimit']
  if (Array.isArray(payload.attachments)) {
    const attachments = payload.attachments.map(asListedEntry)
    edit = { ...payload, attachments }
    candidates = listedOf(attachments)
  } else if ((payload.files?.length ?? 0) === 0) {
    candidates = own
  } else if (own.length === 0) {
    candidates = []
  } else {
    const shown = shownIds(payload)
    const listed = own.filter(upload => shown.has(upload.id) && !names.has(upload.filename))
    if (listed.length + names.size > limit) {
      candidates = []
      overLimit = { files: payload.files?.length ?? 0, dropped: listed.map(upload => upload.filename) }
    } else {
      candidates = listed
      if (listed.length > 0) edit = { ...payload, attachments: listed.map(upload => ({ ...upload })) }
    }
  }
  const kept: KeptFiles = { names, uploads: newestOf(candidates) }
  return { payload: rewriteAttachmentUrls(edit, kept), shadowed: shadowedFiles(edit, candidates, kept), ...(overLimit && { overLimit }) }
}

/**
 * The file names of the File components showing one of `candidates`, but whose `attachment://` a newer upload of the
 * same name takes. Such a File keeps its URL, which Discord refuses for a File.
 */
export function shadowedFiles(payload: { components?: readonly unknown[] }, candidates: readonly ListedUpload[], kept: KeptFiles): string[] {
  const listed = new Map(candidates.map(upload => [upload.id, upload.filename]))
  // Without a candidate nothing is read, so an app's builders are built once, as discord.js sends them
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
    return filename !== undefined && id !== undefined && !kept.uploads.has(id) && !kept.names.has(filename) ? [filename] : []
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
