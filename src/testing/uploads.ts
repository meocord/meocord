import { Attachment, Collection, ComponentType, DiscordAPIError, RESTJSONErrorCodes } from 'discord.js'
import { fileName } from '@src/common/response/attachments.js'
import { nextSnowflake } from '@src/testing/snowflake.js'

type Json = Record<string, unknown>

/** A file a mock message holds, as Discord stores an upload. */
export interface Upload {
  id: string
  filename: string
  url: string
  proxy_url: string
  content_type: string | null
  size: number
  width: number | null
  height: number | null
}

/** Where Discord serves a message's uploads, and the proxy it resizes images through. */
const CDN_ORIGIN = 'https://cdn.discordapp.com'
const MEDIA_PROXY_ORIGIN = 'https://media.discordapp.net'
const CDN_HOSTS = new Set(['cdn.discordapp.com', 'media.discordapp.net'])
/** A CDN upload's path: `/attachments/<channel>/<upload id>/<file name>`, under `ephemeral-attachments` when private. */
const UPLOAD_PATH = /^\/(?:ephemeral-)?attachments\/(\d+)\/(\d+)\/[^/]+$/
/** The signed query Discord adds to an upload's URL; the mock's never expires. */
const URL_SIGNATURE = '?ex=0&is=0&hm=mock'
/** The name discord.js gives a file sent without one. */
const UNNAMED_FILE = 'file.jpg'
/** The size a mock resolves an image to, as it resolves linked media. */
const IMAGE_SIDE = 256
/** The content type Discord gives an upload, by its file name's extension; anything else is plain bytes. */
const CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  txt: 'text/plain; charset=utf-8',
  json: 'application/json; charset=utf-8',
  zip: 'application/zip',
}
const BYTES = 'application/octet-stream'

/** Discord's form-field refusals an upload can meet, with the messages its 400 body gives them. */
const NOT_FOUND = 'UNFURLED_MEDIA_ITEM_REFERENCED_ATTACHMENT_NOT_FOUND'
const MUST_USE_ATTACHMENT = 'UNFURLED_MEDIA_ITEM_MUST_USE_ATTACHMENT_PROTOCOL'
const MUST_USE_ATTACHMENT_MESSAGE =
  'This UnfurledMediaItem does not support arbitrary external urls. You must use the `attachment://` reference system.'
const ATTACHMENT_NOT_FOUND = 'ATTACHMENT_NOT_FOUND'
const ATTACHMENT_NOT_FOUND_MESSAGE = 'Attachment data not found'
const CANNOT_CHANGE_FILENAME = 'ATTACHMENT_CANNOT_CHANGE_FILENAME'
const CANNOT_CHANGE_FILENAME_MESSAGE = 'Attachment filenames cannot be changed'

/** A field Discord refuses, by its path in the request body. */
export interface FieldRefusal {
  path: (string | number)[]
  code: string
  message: string
}

/** The upload a Discord CDN URL serves, by its id, or `undefined` for any other URL. */
export function uploadIdOf(url: unknown, channelId?: string): string | undefined {
  if (typeof url !== 'string') return undefined
  try {
    const { hostname, pathname } = new URL(url)
    const match = CDN_HOSTS.has(hostname) ? UPLOAD_PATH.exec(pathname) : null
    return match && (channelId === undefined || match[1] === channelId) ? match[2] : undefined
  } catch {
    return undefined
  }
}

function bytesOf(file: unknown): number {
  const data = (file as { attachment?: unknown; data?: unknown } | null)?.attachment ?? (file as { data?: unknown } | null)?.data ?? file
  return Buffer.isBuffer(data) ? data.length : 0
}

/**
 * The uploads a request's `files` make, in `channelId`, as Discord stores them: one per name, as a second file of a
 * name is neither shown, `attachment://` resolving to the first, nor listed.
 */
export function uploadsOf(files: readonly unknown[], { channelId, ephemeral }: { channelId: string; ephemeral: boolean }): Upload[] {
  const names = new Set<string>()
  const firsts = files.filter(file => !names.has(fileName(file) ?? UNNAMED_FILE) && Boolean(names.add(fileName(file) ?? UNNAMED_FILE)))
  return firsts.map(file => {
    const id = nextSnowflake()
    const filename = fileName(file) ?? UNNAMED_FILE
    const path = `/${ephemeral ? 'ephemeral-attachments' : 'attachments'}/${channelId}/${id}/${encodeURIComponent(filename)}${URL_SIGNATURE}`
    const contentType = CONTENT_TYPES[filename.slice(filename.lastIndexOf('.') + 1).toLowerCase()] ?? BYTES
    const side = contentType.startsWith('image/') ? IMAGE_SIDE : 0
    return { id, filename, url: CDN_ORIGIN + path, proxy_url: MEDIA_PROXY_ORIGIN + path, content_type: contentType, size: bytesOf(file), width: side, height: side }
  })
}

/** The file name a media URL ends in. */
function nameInUrl(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').at(-1) || UNNAMED_FILE)
  } catch {
    return UNNAMED_FILE
  }
}

/**
 * A message's uploads: those its attachments list, those its components' media link by `attachment_id`, and those its
 * media and embeds show by a CDN URL of `channelId`, where an upload whose media an edit re-sent by URL stays held.
 * A CDN URL of another channel is an image the message does not hold.
 */
export function uploadsHeldBy(
  attachments: Iterable<unknown>,
  components: readonly unknown[],
  embeds: readonly unknown[] = [],
  channelId?: string,
): Upload[] {
  const found = new Map<string, Upload>()
  for (const value of attachments) {
    const attachment = value as Partial<Attachment>
    if (typeof attachment.id !== 'string') continue
    found.set(attachment.id, {
      id: attachment.id,
      filename: attachment.name ?? UNNAMED_FILE,
      url: attachment.url ?? '',
      proxy_url: attachment.proxyURL ?? '',
      content_type: attachment.contentType ?? null,
      size: attachment.size ?? 0,
      width: attachment.width ?? null,
      height: attachment.height ?? null,
    })
  }
  for (const media of mediaIn(components)) {
    const linkedId = typeof media.attachment_id === 'string' ? media.attachment_id : undefined
    const id = linkedId ?? (channelId === undefined ? undefined : uploadIdOf(media.url, channelId))
    if (id === undefined || found.has(id) || typeof media.url !== 'string') continue
    found.set(id, {
      id,
      filename: nameInUrl(media.url),
      url: media.url,
      proxy_url: typeof media.proxy_url === 'string' ? media.proxy_url : media.url,
      content_type: typeof media.content_type === 'string' ? media.content_type : null,
      size: 0,
      width: typeof media.width === 'number' ? media.width : null,
      height: typeof media.height === 'number' ? media.height : null,
    })
  }
  for (const { holder, key } of embedSlots(embeds)) {
    const url = holder[key]
    const id = uploadIdOf(url, channelId)
    if (id === undefined || found.has(id)) continue
    found.set(id, {
      id,
      filename: nameInUrl(url as string),
      url: url as string,
      proxy_url: url as string,
      content_type: null,
      size: 0,
      width: null,
      height: null,
    })
  }
  return [...found.values()]
}

/** Where an embed shows an image: its image's and thumbnail's `url`, and its author's and footer's `icon_url`. */
const EMBED_IMAGES = [
  ['image', 'url', 'proxy_url'],
  ['thumbnail', 'url', 'proxy_url'],
  ['author', 'icon_url', 'proxy_icon_url'],
  ['footer', 'icon_url', 'proxy_icon_url'],
] as const

/** Each image an embed shows, as the object holding it and the key of its URL and its proxied URL. */
function* embedSlots(embeds: readonly unknown[]): Generator<{ holder: Json; key: string; proxy: string; sized: boolean }> {
  for (const embed of embeds) {
    for (const [field, key, proxy] of EMBED_IMAGES) {
      const holder = (embed as Json | null)?.[field] as Json | undefined
      if (holder && typeof holder === 'object' && key in holder) yield { holder, key, proxy, sized: key === 'url' }
    }
  }
}

/**
 * Embeds with `attachment://<name>` pointed at the first upload of that name in `pool`, by its CDN URL, as Discord reads
 * an embed back. An embed takes a kept upload however the request lists it; a name it can't reach is left as it is.
 */
export function withEmbedUploads(embeds: readonly unknown[], pool: readonly Upload[]): unknown[] {
  const tree = structuredClone(embeds) as Json[]
  for (const { holder, key, proxy, sized } of embedSlots(tree)) {
    const url = holder[key]
    if (typeof url !== 'string' || !url.startsWith('attachment://')) continue
    const upload = pool.find(candidate => candidate.filename === url.slice('attachment://'.length))
    if (!upload) continue
    holder[key] = upload.url
    holder[proxy] = upload.proxy_url
    if (sized) Object.assign(holder, { width: upload.width, height: upload.height, content_type: upload.content_type })
  }
  return tree
}

/** Every media item under top-level components: gallery items', thumbnails' and files'. */
function* mediaIn(components: readonly unknown[]): Generator<Json> {
  for (const { media } of mediaSlots(components)) yield media
}

/** Each media item under top-level components, with its path in the request body and whether a File holds it. */
function* mediaSlots(components: readonly unknown[], path: (string | number)[] = ['components']): Generator<{ media: Json; path: (string | number)[]; file: boolean }> {
  for (const [index, value] of components.entries()) {
    const component = value as Json
    const at = [...path, index]
    switch (component?.type) {
      case ComponentType.MediaGallery:
        for (const [item, entry] of ((component.items as Json[]) ?? []).entries()) {
          if (entry?.media) yield { media: entry.media as Json, path: [...at, 'items', item, 'media'], file: false }
        }
        break
      case ComponentType.Thumbnail:
        if (component.media) yield { media: component.media as Json, path: [...at, 'media'], file: false }
        break
      case ComponentType.File:
        if (component.file) yield { media: component.file as Json, path: [...at, 'file'], file: true }
        break
      case ComponentType.Section: {
        const accessory = component.accessory as Json | undefined
        if (accessory?.type === ComponentType.Thumbnail && accessory.media) yield { media: accessory.media as Json, path: [...at, 'accessory', 'media'], file: false }
        break
      }
      case ComponentType.Container:
        yield* mediaSlots((component.components as unknown[]) ?? [], [...at, 'components'])
        break
    }
  }
}

/** An upload as linked media reads back: its CDN URL, what Discord resolved of it, and its `attachment_id`. */
function linked(upload: Upload): Json {
  return { ...unlinked(upload), attachment_id: upload.id }
}

/** An upload shown by its CDN URL alone, as media re-sent with that URL reads back: loaded, but no longer linked. */
function unlinked(upload: Upload): Json {
  return { url: upload.url, proxy_url: upload.proxy_url, width: upload.width, height: upload.height, content_type: upload.content_type, loading_state: 2 }
}

/** Media whose upload is gone, as Discord reads it back: not found, the client's "Image failed to load". */
function broken(media: Json): Json {
  const { attachment_id: _gone, ...rest } = media
  return { ...rest, width: null, height: null, content_type: null, loading_state: 3 }
}

/**
 * What the uploads of a request do to its components' media. `resent` media is what the request sends:
 * `attachment://<name>` resolves to the first upload of that name in `pool`, a CDN URL to the upload it serves while
 * `held`, or reads back broken once the request took that upload off, one of those `gone`; any other URL is left as it
 * is. Media kept from before, which the request does not send, stays linked while its upload is `held`.
 */
export function withUploads(
  components: readonly unknown[],
  { pool, held, gone = [], resent }: { pool: readonly Upload[]; held: readonly Upload[]; gone?: readonly Upload[]; resent: boolean },
): { components: unknown[]; refusals: FieldRefusal[] } {
  const tree = structuredClone(components) as Json[]
  const refusals: FieldRefusal[] = []
  for (const { media, path, file } of mediaSlots(tree)) {
    const url = media.url
    let next: Json | undefined
    if (typeof url === 'string' && url.startsWith('attachment://')) {
      const upload = pool.find(candidate => candidate.filename === url.slice('attachment://'.length))
      if (upload) next = linked(upload)
      else refusals.push({ path: [...path, 'url'], code: NOT_FOUND, message: `The referenced attachment ("${url}") was not found` })
    } else if (resent && file) {
      refusals.push({ path: [...path, 'url'], code: MUST_USE_ATTACHMENT, message: MUST_USE_ATTACHMENT_MESSAGE })
    } else {
      // Kept media stays linked by its attachment_id; sent again, only its URL counts, as Discord ignores the id
      const linkedId = !resent && typeof media.attachment_id === 'string' ? media.attachment_id : undefined
      const id = linkedId ?? uploadIdOf(url)
      const upload = id === undefined ? undefined : held.find(candidate => candidate.id === id)
      if (id !== undefined && !upload && gone.some(candidate => candidate.id === id)) next = broken(media)
      else if (upload && linkedId === undefined) next = unlinked(upload)
    }
    if (next) {
      for (const key of Object.keys(media)) delete media[key]
      Object.assign(media, next)
    }
  }
  return { components: tree, refusals }
}

/** The File components' refusals Discord gives whatever the message holds: a file whose URL isn't `attachment://`. */
export function fileRefusals(components: readonly unknown[]): FieldRefusal[] {
  return [...mediaSlots(structuredClone(components) as Json[])]
    .filter(({ media, file }) => file && !(typeof media.url === 'string' && media.url.startsWith('attachment://')))
    .map(({ path }) => ({ path: [...path, 'url'], code: MUST_USE_ATTACHMENT, message: MUST_USE_ATTACHMENT_MESSAGE }))
}

/**
 * The uploads a message keeps through a request: those its `attachments` list, which must each be the message's, or,
 * with `files` and no list, none, as discord.js then lists the new files alone; with neither, all of them. `named` are
 * the listed ones `attachment://` can still reach: those listed with their `filename`, as Discord takes no other entry
 * as naming its upload, a bare `{ id }` or discord.js's `Attachment`, which has a `name` instead. Both come newest
 * first, as `attachment://` of a name two kept uploads share reaches the newer one.
 */
export function keptUploads(
  held: readonly Upload[],
  edit: { files?: unknown; attachments?: unknown },
): { kept: Upload[]; named: Upload[]; listed: boolean; refusals: FieldRefusal[] } {
  if (Array.isArray(edit.attachments)) {
    const refusals: FieldRefusal[] = []
    const kept: Upload[] = []
    const named: Upload[] = []
    for (const [index, entry] of edit.attachments.entries()) {
      const { id, filename } = (entry ?? {}) as { id?: unknown; filename?: unknown }
      const upload = held.find(candidate => candidate.id === id)
      if (!upload) {
        refusals.push({ path: ['attachments', index], code: ATTACHMENT_NOT_FOUND, message: ATTACHMENT_NOT_FOUND_MESSAGE })
        continue
      }
      // A kept upload keeps its name: listed under another, the edit is refused, though attachment:// of the name
      // listed still reaches it, as Discord reports no reference of that name
      if (typeof filename === 'string' && filename !== upload.filename) {
        refusals.push({ path: ['attachments', index], code: CANNOT_CHANGE_FILENAME, message: CANNOT_CHANGE_FILENAME_MESSAGE })
        named.push({ ...upload, filename })
        continue
      }
      kept.push(upload)
      if (filename === upload.filename) named.push(upload)
    }
    return { kept: newestFirst(kept), named: newestFirst(named), listed: true, refusals }
  }
  return Array.isArray(edit.files) ? { kept: [], named: [], listed: true, refusals: [] } : { kept: newestFirst(held), named: newestFirst(held), listed: false, refusals: [] }
}

/** Uploads by their snowflake ids, the newest first; an id a test gave that is no snowflake counts as oldest. */
function newestFirst(uploads: readonly Upload[]): Upload[] {
  const age = (id: string) => (/^\d+$/.test(id) ? BigInt(id) : -1n)
  return [...uploads].sort((a, b) => (age(b.id) > age(a.id) ? 1 : age(b.id) < age(a.id) ? -1 : 0))
}

/** The ids of the uploads a message's components and embeds show, linked or by their CDN URL. */
function referenced(components: readonly unknown[], embeds: readonly unknown[]): Set<string> {
  const ids = new Set<string>()
  for (const media of mediaIn(components)) {
    const id = typeof media.attachment_id === 'string' ? media.attachment_id : uploadIdOf(media.url)
    if (id) ids.add(id)
  }
  for (const { holder, key } of embedSlots(embeds)) {
    const id = uploadIdOf(holder[key])
    if (id) ids.add(id)
  }
  return ids
}

/** A message's `attachments`, as discord.js builds them from Discord's: the uploads no component or embed shows. */
export function attachmentsOf(uploads: readonly Upload[], components: readonly unknown[], embeds: readonly unknown[]): Collection<string, Attachment> {
  const shown = referenced(components, embeds)
  const listed = uploads.filter(upload => !shown.has(upload.id))
  return new Collection(listed.map(upload => [upload.id, new (Attachment as unknown as new (data: unknown) => Attachment)(upload)]))
}

/** Discord's 400 for refused form fields, its message flattened as discord.js flattens Discord's body. */
export function formBodyError(refusals: readonly FieldRefusal[]): DiscordAPIError {
  const errors: Json = {}
  for (const { path, code, message } of refusals) {
    let node = errors
    for (const key of path) node = (node[key] ??= {}) as Json
    ;((node._errors ??= []) as unknown[]).push({ code, message })
  }
  const code = RESTJSONErrorCodes.InvalidFormBodyOrContentType
  return new DiscordAPIError({ message: 'Invalid Form Body', code, errors } as never, code, 400, 'PATCH', 'https://discord.com/api/v10/webhooks', {})
}
