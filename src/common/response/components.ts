import { ComponentType, parseEmoji } from 'discord.js'
import { RENDERED_CONTAINER_ID } from '@src/common/response/presenter.js'

type Json = Record<string, unknown>

/** Discord's limit on the components of one Components V2 message, nested ones included. */
export const V2_COMPONENT_LIMIT = 40

/** Discord's limit on the embeds of one message. */
export const EMBED_LIMIT = 10

const SELECTS = new Set<unknown>([
  ComponentType.StringSelect,
  ComponentType.UserSelect,
  ComponentType.RoleSelect,
  ComponentType.MentionableSelect,
  ComponentType.ChannelSelect,
])

/** How `@Defer` locks a message: every control, or only the one the user used. */
export interface LockOptions {
  disable: 'all' | 'clicked'
  clickedId?: string
  loadingEmoji?: string
}

function children(node: Json): Json[] | undefined {
  return Array.isArray(node.components) ? (node.components as Json[]) : undefined
}

/**
 * The components with their controls disabled — buttons, section accessories and the five select
 * menus — and the clicked button showing the loading emoji. Every other node is kept as it was.
 */
export function lockComponents(components: readonly Json[], options: LockOptions): Json[] {
  const parsed = options.loadingEmoji ? parseEmoji(options.loadingEmoji) : null
  const emoji = parsed?.id ? { id: parsed.id, name: parsed.name, animated: parsed.animated } : parsed ? { name: parsed.name } : null
  const walk = (node: Json): Json => {
    const clicked = options.clickedId !== undefined && node.custom_id === options.clickedId
    if (node.type === ComponentType.Button || SELECTS.has(node.type)) {
      if (options.disable === 'clicked' && !clicked) return node
      return {
        ...node,
        disabled: true,
        ...(clicked && emoji && node.type === ComponentType.Button ? { emoji } : {}),
      }
    }
    if (node.type === ComponentType.Section && node.accessory) {
      return { ...node, accessory: walk(node.accessory as Json) }
    }
    const nested = children(node)
    return nested ? { ...node, components: nested.map(walk) } : node
  }
  return components.map(walk)
}

/** How many components a Components V2 message carries, nested ones and accessories included. */
export function countComponents(components: readonly Json[]): number {
  return components.reduce((total, node) => {
    const nested = children(node) ?? []
    return total + 1 + countComponents(nested) + (node.accessory ? 1 : 0)
  }, 0)
}

/** The components without a loading container MeoCord rendered, left behind by a crash or restart. */
export function withoutRenderedViews(components: readonly Json[]): Json[] {
  return components.filter(node => !(node.type === ComponentType.Container && node.id === RENDERED_CONTAINER_ID))
}

/** Keys in code-unit order: a locale's collation could rank two different keys equal, and would load ICU to do it. */
const byCodeUnit = ([a]: [string, unknown], [b]: [string, unknown]) => (a < b ? -1 : a > b ? 1 : 0)

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(byCodeUnit)
        .map(([key, entry]) => [key, canonical(entry)]),
    )
  }
  return value
}

/**
 * Whether two JSON values are equal whatever their key order, for comparing a message with what
 * MeoCord last wrote to it.
 */
export function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))
}

const EMBED_CONTENT = ['title', 'description', 'url', 'timestamp', 'color', 'footer', 'image', 'thumbnail', 'video', 'provider', 'author', 'fields']

/** Whether two embeds show the same content, ignoring what Discord adds to the embeds it returns, such as `type`. */
export function sameEmbed(a: object, b: object): boolean {
  const content = (embed: object) => Object.fromEntries(EMBED_CONTENT.map(key => [key, (embed as Json)[key]]))
  return sameJson(content(a), content(b))
}
