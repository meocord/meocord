import {
  ChannelSelectMenuInteraction,
  type Interaction,
  MentionableSelectMenuInteraction,
  ModalSubmitInteraction,
  RoleSelectMenuInteraction,
  StringSelectMenuInteraction,
  UserSelectMenuInteraction,
} from 'discord.js'
import { getCommandMap } from '@src/decorator/controller.decorator.js'
import { readCustomId, type RouteParamValue } from '@src/core/component-routes.js'
import {
  hasCustomId,
  isCustomIdRouted,
  matchesCommandType,
  matchesHandler,
  resolveCommandPaths,
  resolveOptionParams,
} from '@src/util/interaction.util.js'

/** The second argument an interaction handler receives, and the names given twice while building it. */
export interface HandlerInput {
  params: Record<string, unknown>
  /** Names both a customId param and a modal field or select menu choice carry; the customId param is kept. */
  collisions: string[]
}

/**
 * What a modal field submits: a text input's text, a select's chosen ids, a file upload's attachments,
 * or a checkbox's state. Keyed by the field's customId.
 */
function modalFields(interaction: ModalSubmitInteraction): Record<string, unknown> {
  // A Collection when discord.js built it; anything else, such as a test double's stub, has no fields.
  const fields: unknown = interaction.fields?.fields
  if (!(fields instanceof Map)) return {}

  const values: Record<string, unknown> = {}
  for (const [customId, field] of fields as Map<string, unknown>) {
    const data = field as unknown as Record<string, unknown>
    values[customId] = 'value' in data ? data.value : 'values' in data ? data.values : data.attachments
  }
  return values
}

/** The entries of a discord.js Collection, or none for anything else, such as a test double's stub. */
const entriesOf = (collection: unknown): unknown[] => (collection instanceof Map ? [...collection.values()] : [])

/**
 * What a select menu's user chose: `values`, the chosen strings or ids, and the objects discord.js resolved
 * for them: `users` and `members` for a user select, `roles` for a role select, `channels` for a channel
 * select, and `users`, `members` and `roles` for a mentionable one.
 */
function selectChoices(interaction: Interaction): Record<string, unknown> {
  const selected = interaction as Interaction & { values?: unknown; users?: unknown; members?: unknown; roles?: unknown; channels?: unknown }
  const values = Array.isArray(selected.values) ? [...(selected.values as string[])] : []
  if (interaction instanceof StringSelectMenuInteraction) return { values }
  if (interaction instanceof UserSelectMenuInteraction) {
    return { values, users: entriesOf(selected.users), members: entriesOf(selected.members) }
  }
  if (interaction instanceof RoleSelectMenuInteraction) return { values, roles: entriesOf(selected.roles) }
  if (interaction instanceof ChannelSelectMenuInteraction) return { values, channels: entriesOf(selected.channels) }
  if (interaction instanceof MentionableSelectMenuInteraction) {
    return { values, users: entriesOf(selected.users), members: entriesOf(selected.members), roles: entriesOf(selected.roles) }
  }
  return {}
}

/**
 * Builds a handler's input in one object: a chat command's or an autocomplete's options, or a
 * component's customId params with, for a modal, its fields and, for a select menu, its choices. When a
 * customId param and a field or choice share a name, the customId param wins, since the route was chosen by it.
 *
 * @param routeParams - The params the customId's pattern captured.
 */
export function handlerInput(interaction: Interaction, routeParams: Record<string, RouteParamValue> = {}): HandlerInput {
  if (interaction.isChatInputCommand() || interaction.isAutocomplete()) {
    return { params: resolveOptionParams(interaction), collisions: [] }
  }
  if (!hasCustomId(interaction)) return { params: {}, collisions: [] }

  const fields = interaction instanceof ModalSubmitInteraction ? modalFields(interaction) : selectChoices(interaction)
  const collisions = Object.keys(routeParams).filter(name => name in fields)
  return { params: { ...fields, ...routeParams }, collisions }
}

/**
 * The params a handler's own customId pattern captures from an interaction, as routing would: for a
 * test that calls the handler with no params of its own.
 */
export function routeParamsFor(prototype: object, methodName: string, interaction: Interaction): Record<string, RouteParamValue> {
  if (!hasCustomId(interaction)) return {}

  for (const [pattern, metaList] of Object.entries(getCommandMap(prototype) ?? {})) {
    for (const meta of metaList) {
      if (meta.methodName !== methodName || !meta.regex || !matchesCommandType(meta.type, interaction)) continue
      const params = readCustomId(pattern, meta.regex, interaction.customId)
      if (params) return params
    }
  }
  return {}
}

/**
 * Why an interaction could not reach a handler through its routes, for a test calling the handler
 * directly: a customId its patterns do not match, or a command its name is not. `undefined` when it
 * could, when the handler has no route, or when the interaction carries no customId or command name.
 */
export function routeMismatch(controller: { name: string; prototype: object }, methodName: string, interaction: Interaction): string | undefined {
  const routes = Object.entries(getCommandMap(controller.prototype) ?? {}).flatMap(([route, metas]) =>
    metas.filter(meta => meta.methodName === methodName).map(meta => ({ route, meta })),
  )
  const handler = `${controller.name}.${methodName}`
  const describe = (kind: string, value: string, candidates: { route: string }[]) =>
    `${kind} '${value}' does not match ${handler}'s route ${candidates.map(({ route }) => `'${route}'`).join(' or ')}.`

  if (hasCustomId(interaction)) {
    const patterned = routes.filter(({ meta }) => isCustomIdRouted(meta.type) && meta.regex)
    if (typeof interaction.customId !== 'string' || patterned.length === 0) return undefined
    if (patterned.some(({ route, meta }) => readCustomId(route, meta.regex!, interaction.customId))) return undefined
    return describe('customId', interaction.customId, patterned)
  }

  if (!interaction.isCommand()) return undefined
  const named = routes.filter(({ meta }) => !isCustomIdRouted(meta.type))
  if (typeof interaction.commandName !== 'string' || named.length === 0) return undefined
  // A chat command reaches the handler of its full path, or of its bare name, as dispatch tries them
  const keys = interaction.isChatInputCommand() ? resolveCommandPaths(interaction) : [interaction.commandName]
  const byName = named.filter(({ route }) => keys.includes(route))
  // A user and a message context menu may share a name; dispatch sends each only to its own kind's handler
  if (byName.some(({ meta }) => !interaction.isContextMenuCommand() || matchesHandler(meta, interaction))) return undefined
  if (byName.length > 0) {
    const [sent, handled] = interaction.isUserContextMenuCommand() ? ['user', 'message'] : ['message', 'user']
    const name = interaction.commandName
    return `A ${sent} context menu command '${name}' does not match ${handler}, which handles the ${handled} context menu command '${name}'.`
  }
  return describe('command', keys[0], named)
}

