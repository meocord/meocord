import { type ClientEvents, type ClientOptions, GatewayIntentBits, IntentsBitField, Partials } from 'discord.js'

/** One intent a handler needs, satisfied by any of the listed bits (a guild and a direct-message variant, say). */
type IntentRequirement = readonly GatewayIntentBits[]

/** What a handler needs from the client options before discord.js delivers its events. */
export interface EventRequirements {
  intents: readonly IntentRequirement[]
  partials?: readonly Partials[]
}

const MESSAGES: IntentRequirement = [GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages]
const REACTIONS: IntentRequirement = [
  GatewayIntentBits.GuildMessageReactions,
  GatewayIntentBits.DirectMessageReactions,
]
// Partials.User is left out: guild reactions carry their user, and requiring it would warn on the generated app
const REACTION_PARTIALS = [Partials.Message, Partials.Reaction]

/** The intents Discord only sends once they are also enabled for the app in the developer portal. */
const PRIVILEGED = new Set<GatewayIntentBits>([
  GatewayIntentBits.GuildMembers,
  GatewayIntentBits.GuildPresences,
  GatewayIntentBits.MessageContent,
])

/** The client events whose delivery depends on an intent or a partial; the rest need nothing. */
const EVENT_REQUIREMENTS: Partial<Record<keyof ClientEvents, EventRequirements>> = {
  ...Object.fromEntries(
    [
      'guildCreate',
      'guildDelete',
      'guildUpdate',
      'guildAvailable',
      'guildUnavailable',
      'roleCreate',
      'roleDelete',
      'roleUpdate',
      'channelCreate',
      'channelDelete',
      'channelUpdate',
      'channelPinsUpdate',
      'threadCreate',
      'threadDelete',
      'threadUpdate',
      'threadListSync',
      'threadMemberUpdate',
      'stageInstanceCreate',
      'stageInstanceDelete',
      'stageInstanceUpdate',
    ].map(event => [event, { intents: [[GatewayIntentBits.Guilds]] }]),
  ),
  ...Object.fromEntries(
    ['guildMemberAdd', 'guildMemberRemove', 'guildMemberUpdate', 'guildMemberAvailable', 'threadMembersUpdate'].map(
      event => [event, { intents: [[GatewayIntentBits.GuildMembers]] }],
    ),
  ),
  guildAuditLogEntryCreate: { intents: [[GatewayIntentBits.GuildModeration]] },
  guildBanAdd: { intents: [[GatewayIntentBits.GuildModeration]] },
  guildBanRemove: { intents: [[GatewayIntentBits.GuildModeration]] },
  ...Object.fromEntries(
    ['emojiCreate', 'emojiDelete', 'emojiUpdate', 'stickerCreate', 'stickerDelete', 'stickerUpdate'].map(event => [
      event,
      { intents: [[GatewayIntentBits.GuildExpressions]] },
    ]),
  ),
  guildIntegrationsUpdate: { intents: [[GatewayIntentBits.GuildIntegrations]] },
  webhooksUpdate: { intents: [[GatewayIntentBits.GuildWebhooks]] },
  inviteCreate: { intents: [[GatewayIntentBits.GuildInvites]] },
  inviteDelete: { intents: [[GatewayIntentBits.GuildInvites]] },
  voiceStateUpdate: { intents: [[GatewayIntentBits.GuildVoiceStates]] },
  presenceUpdate: { intents: [[GatewayIntentBits.GuildPresences]] },
  messageCreate: { intents: [MESSAGES] },
  messageUpdate: { intents: [MESSAGES], partials: [Partials.Message] },
  messageDelete: { intents: [MESSAGES], partials: [Partials.Message] },
  messageDeleteBulk: { intents: [[GatewayIntentBits.GuildMessages]] },
  messageReactionAdd: { intents: [REACTIONS], partials: REACTION_PARTIALS },
  messageReactionRemove: { intents: [REACTIONS], partials: REACTION_PARTIALS },
  messageReactionRemoveAll: { intents: [REACTIONS], partials: [Partials.Message] },
  messageReactionRemoveEmoji: { intents: [REACTIONS], partials: [Partials.Reaction] },
  typingStart: {
    intents: [[GatewayIntentBits.GuildMessageTyping, GatewayIntentBits.DirectMessageTyping]],
  },
  messagePollVoteAdd: { intents: [[GatewayIntentBits.GuildMessagePolls, GatewayIntentBits.DirectMessagePolls]] },
  messagePollVoteRemove: { intents: [[GatewayIntentBits.GuildMessagePolls, GatewayIntentBits.DirectMessagePolls]] },
  ...Object.fromEntries(
    [
      'guildScheduledEventCreate',
      'guildScheduledEventDelete',
      'guildScheduledEventUpdate',
      'guildScheduledEventUserAdd',
      'guildScheduledEventUserRemove',
    ].map(event => [event, { intents: [[GatewayIntentBits.GuildScheduledEvents]] }]),
  ),
  autoModerationRuleCreate: { intents: [[GatewayIntentBits.AutoModerationConfiguration]] },
  autoModerationRuleDelete: { intents: [[GatewayIntentBits.AutoModerationConfiguration]] },
  autoModerationRuleUpdate: { intents: [[GatewayIntentBits.AutoModerationConfiguration]] },
  autoModerationActionExecution: { intents: [[GatewayIntentBits.AutoModerationExecution]] },
}

/** A `@MessageHandler` reads the message's text, which also needs MessageContent. */
export const MESSAGE_HANDLER_REQUIREMENTS: EventRequirements = {
  intents: [MESSAGES, [GatewayIntentBits.MessageContent]],
}

/** A `@MessageHandler` only messages that mention the bot can reach: Discord sends their text without MessageContent. */
export const MENTION_ONLY_HANDLER_REQUIREMENTS: EventRequirements = { intents: [MESSAGES] }

/**
 * A `@MessageHandler` that works in direct messages only. They carry their text without MessageContent, but arrive
 * only with DirectMessages, and only with Partials.Channel: no DM channel is cached after the bot starts, and
 * discord.js drops a message from a channel it has not cached unless that partial is on.
 */
export const DM_HANDLER_REQUIREMENTS: EventRequirements = {
  intents: [[GatewayIntentBits.DirectMessages]],
  partials: [Partials.Channel],
}

/**
 * What a `@MessageHandler` needs: MessageContent, unless it has a pattern that only a mention of the bot starts;
 * one that works in direct messages only needs what lets them arrive instead.
 */
export function messageHandlerRequirements(
  handler: { pattern?: string; options: { mention?: unknown; prefix?: unknown; scope?: unknown } },
  app: { mention?: unknown },
): EventRequirements {
  if (handler.pattern === undefined) return MESSAGE_HANDLER_REQUIREMENTS
  if (handler.options.scope === 'dm') return DM_HANDLER_REQUIREMENTS
  const mentionOnly = handler.options.mention === 'only' || (app.mention === 'only' && handler.options.prefix === undefined)
  return mentionOnly ? MENTION_ONLY_HANDLER_REQUIREMENTS : MESSAGE_HANDLER_REQUIREMENTS
}

/** A `@ReactionHandler` needs the reaction intents, and the partials for messages sent before the bot started. */
export const REACTION_HANDLER_REQUIREMENTS: EventRequirements = { intents: [REACTIONS], partials: REACTION_PARTIALS }

/** What handling `event` needs, or nothing when discord.js delivers it without an intent. */
export function eventRequirements(event: keyof ClientEvents): EventRequirements {
  return EVENT_REQUIREMENTS[event] ?? { intents: [] }
}

/** A handler that needs something, named for the warning, such as `@On('guildMemberAdd') in WelcomeController.greet`. */
export interface RequiringHandler {
  label: string
  requirements: EventRequirements
}

function intentName(bit: GatewayIntentBits): string {
  return GatewayIntentBits[bit]
}

/**
 * The warnings for handlers whose events the client options will not deliver: one per missing intent
 * or partial, naming every handler that needs it. Privileged intents also say to enable them in the
 * developer portal.
 */
export function missingRequirementWarnings(options: ClientOptions, handlers: readonly RequiringHandler[]): string[] {
  const intents = new IntentsBitField(options.intents)
  const partials = new Set(options.partials ?? [])
  const missingIntents = new Map<string, { bits: IntentRequirement; labels: string[] }>()
  const missingPartials = new Map<Partials, string[]>()

  for (const { label, requirements } of handlers) {
    for (const requirement of requirements.intents) {
      if (requirement.some(bit => intents.has(bit))) continue
      const key = requirement.map(intentName).join(' or ')
      const entry = missingIntents.get(key) ?? { bits: requirement, labels: [] }
      if (!entry.labels.includes(label)) entry.labels.push(label)
      missingIntents.set(key, entry)
    }
    for (const partial of requirements.partials ?? []) {
      if (partials.has(partial)) continue
      const labels = missingPartials.get(partial) ?? []
      if (!labels.includes(label)) labels.push(label)
      missingPartials.set(partial, labels)
    }
  }

  const warnings: string[] = []
  for (const [name, { bits, labels }] of missingIntents) {
    const privileged = bits.filter(bit => PRIVILEGED.has(bit)).map(intentName)
    warnings.push(
      `The ${name} intent is not in clientOptions.intents, so Discord will not send what ${labels.join(', ')} ` +
        `handle${labels.length === 1 ? 's' : ''}.` +
        (privileged.length > 0
          ? ` ${privileged.join(' and ')} is privileged: also enable it for the app in the Discord developer portal.`
          : '') +
        (bits.includes(GatewayIntentBits.MessageContent)
          ? ' Without it, only messages that mention the bot and direct messages carry their text' +
            // A command can be started by a mention alone; a listener takes every message, so it cannot
            (labels.some(label => label.startsWith("@MessageHandler('")) ? "; messages: { mention: 'only' } needs none." : '.')
          : ''),
    )
  }
  for (const [partial, labels] of missingPartials) {
    warnings.push(
      `Partials.${Partials[partial]} is not in clientOptions.partials, so ${labels.join(', ')} will miss ` +
        (partial === Partials.Channel
          ? 'direct messages: no DM channel is cached after the bot starts, and discord.js drops a message from a ' +
            'channel it has not cached.'
          : 'events about messages, reactions or users the bot has not cached, such as messages sent before it started.'),
    )
  }
  return warnings
}
