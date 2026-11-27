import path from 'path'
import { ComponentType } from 'discord.js'

const CDN_HOSTS = new Set(['cdn.discordapp.com', 'media.discordapp.net'])
const CDN_PATHS = ['/attachments/', '/ephemeral-attachments/']

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

function rewrite(url: unknown, kept: ReadonlySet<string>): unknown {
  const name = attachmentFileName(url)
  return name && kept.has(name) ? `attachment://${name}` : url
}

function rewriteAt(target: Json | undefined, key: string, kept: ReadonlySet<string>): Json | undefined {
  if (!target || typeof target !== 'object') return target
  return key in target ? { ...target, [key]: rewrite(target[key], kept) } : target
}

function rewriteEmbed(embed: Json, kept: ReadonlySet<string>): Json {
  return {
    ...embed,
    ...(embed.image ? { image: rewriteAt(embed.image as Json, 'url', kept) } : {}),
    ...(embed.thumbnail ? { thumbnail: rewriteAt(embed.thumbnail as Json, 'url', kept) } : {}),
    ...(embed.author ? { author: rewriteAt(embed.author as Json, 'icon_url', kept) } : {}),
    ...(embed.footer ? { footer: rewriteAt(embed.footer as Json, 'icon_url', kept) } : {}),
  }
}

function rewriteComponent(component: Json, kept: ReadonlySet<string>): Json {
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
 * The names of the files a message has after an edit: the files the edit sends, and the message's
 * current attachments unless the edit lists the ones to keep.
 */
export function keptAttachmentNames(
  payload: { files?: readonly unknown[]; attachments?: readonly unknown[] },
  current: Iterable<{ name?: string | null }>,
): Set<string> {
  const names = new Set<string>()
  for (const file of payload.files ?? []) {
    const name = fileName(file)
    if (name) names.add(name)
  }
  for (const attachment of payload.attachments ?? current) {
    const name = (attachment as { name?: unknown })?.name
    if (typeof name === 'string') names.add(name)
  }
  return names
}

/**
 * Points embed images, thumbnails, author and footer icons, and Components V2 media, thumbnails and
 * files at `attachment://` when they are Discord CDN attachment URLs of a file the edited message
 * keeps, so re-sending a message's own content does not break its images. Other URLs are unchanged.
 */
export function rewriteAttachmentUrls<P extends { embeds?: readonly unknown[]; components?: readonly unknown[] }>(
  payload: P,
  kept: ReadonlySet<string>,
): P {
  if (kept.size === 0) return payload
  return {
    ...payload,
    ...(payload.embeds ? { embeds: payload.embeds.map(embed => rewriteEmbed(toJson<Json>(embed as Json), kept)) } : {}),
    ...(payload.components
      ? { components: payload.components.map(component => rewriteComponent(toJson<Json>(component as Json), kept)) }
      : {}),
  }
}
