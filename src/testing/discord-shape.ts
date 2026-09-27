import { ComponentType } from 'discord.js'

type Json = Record<string, unknown>

/** Where a mock resolves unfurled media to, as Discord's media proxy would. */
const PROXY = 'https://images-ext-1.discordapp.net/external/mock'

let mediaIds = 1_300_000_000_000_000_000n

/** Unfurled media as Discord stores it: the url given, resolved to a proxied image of a fixed size. */
function resolvedMedia(media: Json): Json {
  return {
    id: String(mediaIds++),
    proxy_url: `${PROXY}/${encodeURIComponent(String(media.url))}`,
    width: 256,
    height: 256,
    content_type: 'image/png',
    flags: 0,
    placeholder: 'mock',
    placeholder_version: 1,
    loading_state: 2,
    ...media,
  }
}

/** Whether media is a file uploaded with the message, which Discord processes again on each edit that keeps it. */
const uploaded = (media: Json): boolean =>
  media.attachment_id !== undefined || (typeof media.url === 'string' && (media.url.startsWith('attachment://') || media.url.includes('/attachments/')))

/**
 * An uploaded file as an edit's response has it: processed again, so loading, with a new id and nothing resolved
 * yet. Read back once it has loaded, it is resolved again, with no edit to the message.
 */
function loadingMedia(media: Json): Json {
  const { attachment_id: _attachment, ...rest } = media
  return { ...rest, id: String(mediaIds++), flags: 0, loading_state: 1, content_type: null, width: null, height: null, placeholder: null, placeholder_version: null }
}

/** Every component under `node`, in the order Discord numbers them: each one, then its children, then its accessory. */
function* componentsOf(node: unknown): Generator<Json> {
  if (Array.isArray(node)) {
    for (const item of node) yield* componentsOf(item)
    return
  }
  if (!node || typeof node !== 'object' || typeof (node as Json).type !== 'number') return
  yield node as Json
  yield* componentsOf((node as Json).components)
  yield* componentsOf((node as Json).accessory)
}

/** One component with what Discord adds to it: defaults it fills, and media it resolves, or has yet to. */
function stored(component: Json, loading: boolean): Json {
  const media = (item: Json) => (loading && uploaded(item) ? loadingMedia(item) : resolvedMedia(item))
  const out: Json = { ...component }
  switch (component.type) {
    case ComponentType.Container:
      out.spoiler ??= false
      out.accent_color ??= null
      break
    case ComponentType.Thumbnail:
      out.spoiler ??= false
      out.description ??= null
      out.media = media(component.media as Json)
      break
    case ComponentType.MediaGallery:
      out.items = (component.items as Json[]).map(item => ({ spoiler: false, description: null, ...item, media: media(item.media as Json) }))
      break
    case ComponentType.Button: {
      const emoji = component.emoji as Json | undefined
      if (emoji?.id) out.emoji = { animated: false, ...emoji }
      break
    }
  }
  return out
}

/**
 * Top-level components as Discord stores and returns them: every component numbered with an `id` it lacks, in
 * Discord's order, defaults such as `spoiler: false` filled, and media resolved. Ids given are kept. With `loading`,
 * as an edit's response has them: files uploaded with the message still loading, as Discord processes them again.
 */
export function asDiscordStores(components: readonly unknown[], { loading = false }: { loading?: boolean } = {}): Json[] {
  const tree = structuredClone(components) as Json[]
  const taken = new Set([...componentsOf(tree)].map(component => component.id).filter(id => typeof id === 'number'))
  let next = 1
  const rebuild = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(rebuild)
    if (!node || typeof node !== 'object' || typeof (node as Json).type !== 'number') return node
    const component = node as Json
    const out = stored(component, loading)
    if (typeof out.id !== 'number') {
      while (taken.has(next)) next++
      out.id = next
      taken.add(next)
    }
    if (component.components) out.components = rebuild(component.components)
    if (component.accessory) out.accessory = rebuild(component.accessory)
    return out
  }
  return rebuild(tree) as Json[]
}

/** Embeds as Discord stores them: `type: 'rich'`, and their thumbnail and image resolved. */
export function embedsAsDiscordStores(embeds: readonly unknown[]): Json[] {
  return (structuredClone(embeds) as Json[]).map(embed => ({
    type: 'rich',
    ...embed,
    ...(embed.thumbnail ? { thumbnail: resolvedMedia(embed.thumbnail as Json) } : {}),
    ...(embed.image ? { image: resolvedMedia(embed.image as Json) } : {}),
  }))
}
