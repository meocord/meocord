import {
  ChannelSelectMenuInteraction,
  ComponentType,
  type Interaction,
  MentionableSelectMenuInteraction,
  ModalSubmitInteraction,
  RoleSelectMenuInteraction,
  StringSelectMenuInteraction,
  UserSelectMenuInteraction,
} from 'discord.js'
import { getCommandMap } from '@src/decorator/controller.decorator.js'
import { type ComponentRoute, matchComponentRoute, type RouteParamValue } from '@src/core/component-routes.js'
import {
  hasCustomId,
  isCustomIdRouted,
  matchesCommandType,
  matchesHandler,
  resolveOptionParams,
} from '@src/util/interaction.util.js'
import { setOwn } from '@src/util/value.util.js'
import { commandRouteKeys, matchCommandRoute } from '@src/core/command-routes.js'

/** The second argument an interaction handler receives, and the names given twice while building it. */
export interface HandlerInput {
  params: Record<string, unknown>
  /** Names both a customId param and a modal field or select menu choice carry; the customId param is kept. */
  collisions: string[]
}

/** The entries of a discord.js Collection, or none for anything else, such as a test double's stub. */
const entriesOf = (collection: unknown): unknown[] => (collection instanceof Map ? [...collection.values()] : [])

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
    // An upload's `values` are the attachments' ids; discord.js resolves the attachments themselves alongside
    if (data.type === ComponentType.FileUpload) setOwn(values, customId, entriesOf(interaction.fields.getUploadedFiles(customId)))
    else setOwn(values, customId, 'value' in data ? data.value : data.values)
  }
  return values
}

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
  const collisions = Object.keys(routeParams).filter(name => Object.hasOwn(fields, name))
  return { params: { ...fields, ...routeParams }, collisions }
}

/**
 * Where dispatch sends an interaction's customId among a module's component routes, for a test calling one
 * handler: the params its route captures when that handler runs, or why it does not, when another handler
 * runs or no route matches. `undefined` when the handler has no customId route or the interaction no customId.
 */
export function componentRouteFor(
  routes: readonly ComponentRoute[],
  controller: { name: string },
  methodName: string,
  interaction: Interaction,
): { params: Record<string, RouteParamValue> } | { mismatch: string } | undefined {
  if (!hasCustomId(interaction) || typeof interaction.customId !== 'string') return undefined
  const own = routes.filter(route => route.controllerClass === controller && route.meta.methodName === methodName)
  if (own.length === 0) return undefined

  const { customId } = interaction
  const handler = `${controller.name}.${methodName}`
  const target = matchComponentRoute(routes, type => matchesCommandType(type, interaction), customId)
  if (target && own.includes(target.route)) return { params: target.params }
  if (target) {
    const other = `${target.route.controllerClass.name}.${target.route.meta.methodName}`
    return { mismatch: `customId '${customId}' does not reach ${handler}: dispatch runs ${other}.` }
  }
  return { mismatch: `customId '${customId}' does not match ${handler}'s route ${own.map(({ pattern }) => `'${pattern}'`).join(' or ')}.` }
}

/**
 * Why a command could not reach a handler by its name, for a test calling the handler directly: the handler is checked
 * against the one dispatch routes the command to, among `controllers`. `undefined` when it is that one, when the
 * handler has no command route, or when the interaction is not a command.
 */
export function commandMismatch<C extends { name: string; prototype: object }>(
  controllers: readonly C[],
  controller: C,
  methodName: string,
  interaction: Interaction,
): string | undefined {
  if (!interaction.isCommand()) return undefined
  const handler = `${controller.name}.${methodName}`
  const named = Object.entries(getCommandMap(controller.prototype) ?? {}).flatMap(([route, metas]) =>
    metas.filter(meta => meta.methodName === methodName && !isCustomIdRouted(meta.type)).map(meta => ({ route, meta })),
  )
  if (typeof interaction.commandName !== 'string' || named.length === 0) return undefined
  const keys = commandRouteKeys(interaction)
  const winner = matchCommandRoute(controllers, interaction)
  if (winner?.controllerClass === controller && winner.meta.methodName === methodName) return undefined
  // A user and a message context menu may share a name; dispatch sends each only to its own kind's handler
  const byName = named.filter(({ route }) => keys.includes(route))
  if (interaction.isContextMenuCommand() && byName.length > 0 && !byName.some(({ meta }) => matchesHandler(meta, interaction))) {
    const [sent, handled] = interaction.isUserContextMenuCommand() ? ['user', 'message'] : ['message', 'user']
    const name = interaction.commandName
    return `A ${sent} context menu command '${name}' does not match ${handler}, which handles the ${handled} context menu command '${name}'.`
  }
  if (winner) return `command '${keys[0]}' does not reach ${handler}: dispatch runs ${winner.controllerClass.name}.${winner.meta.methodName}.`
  return `command '${keys[0]}' does not match ${handler}'s route ${named.map(({ route }) => `'${route}'`).join(' or ')}.`
}

