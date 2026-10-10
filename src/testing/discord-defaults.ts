import {
  AutocompleteInteraction,
  BaseGuild,
  BaseGuildVoiceChannel,
  BaseChannel,
  BaseInteraction,
  ChatInputCommandInteraction,
  ChannelType,
  Client,
  ClientUser,
  Collection,
  CommandInteraction,
  DMChannel,
  ForumChannel,
  Guild,
  GuildChannel,
  GuildMember,
  GuildMemberFlagsBitField,
  GuildNSFWLevel,
  GuildPremiumTier,
  GuildVerificationLevel,
  Locale,
  MediaChannel,
  Message,
  MessageMentions,
  MessageReaction,
  ModalSubmitInteraction,
  MessageType,
  NewsChannel,
  PermissionFlagsBits,
  PermissionsBitField,
  PresenceManager,
  ReactionManager,
  ReactionUserManager,
  Role,
  SnowflakeUtil,
  TextChannel,
  ThreadChannel,
  User,
  UserFlagsBitField,
  VoiceChannel,
} from 'discord.js'
import {
  createChatInputOptions,
  createMockChannel,
  createMockGuild,
  createMockMessage,
  createMockUser,
  isRawMember,
  memberRoles,
  ownedManager,
} from './mock-interaction.js'
import { strictMocks } from './strict-mocks.js'
import { Logger } from '@src/common/logger.js'
import { warnOnce } from '@src/common/deprecation.js'

const mockLogger = new Logger('Mocks')

/**
 * A member's permissions where an interaction was made, as Discord computes them: under strict mocks, the channel's
 * overwrites on top of `member.permissions`, so a test that sets those keeps the base; otherwise `member.permissions`,
 * with a warning once where the overwrites would change them.
 */
function inChannel(interaction: BaseInteraction, member: GuildMember): Readonly<PermissionsBitField> {
  const base = member.permissions
  const channel: unknown = interaction.channel
  // A thread takes its parent's overwrites
  const at = channel instanceof ThreadChannel ? channel.parent : channel
  // Only a server the mock caches has the overwrites to apply
  const { guild } = interaction
  if (!(guild instanceof Guild) || !(at instanceof GuildChannel) || base.has(PermissionFlagsBits.Administrator) || member.id === guild.ownerId) {
    return base
  }
  // Private in discord.js's typings, though it is the method its own permissionsFor uses
  interface Overwrite { allow: PermissionsBitField; deny: PermissionsBitField }
  const overwrites = (at as unknown as { overwritesFor(member: GuildMember): { everyone?: Overwrite; roles: Overwrite[]; member?: Overwrite } }).overwritesFor(member)
  const computed = new PermissionsBitField(base)
    .remove(overwrites.everyone?.deny ?? 0n)
    .add(overwrites.everyone?.allow ?? 0n)
    .remove(overwrites.roles.length > 0 ? overwrites.roles.map(role => role.deny) : 0n)
    .add(overwrites.roles.length > 0 ? overwrites.roles.map(role => role.allow) : 0n)
    .remove(overwrites.member?.deny ?? 0n)
    .add(overwrites.member?.allow ?? 0n)
    .freeze()
  if (strictMocks()) return computed
  if (!computed.equals(base)) {
    const lost = new PermissionsBitField(base).remove(computed).toArray()
    const gained = new PermissionsBitField(computed).remove(base).toArray()
    const change = lost.length > 0 ? [`without ${lost.join(', ')}`] : []
    if (gained.length > 0) change.push(`with ${gained.join(', ')}`)
    warnOnce(
      mockLogger,
      `${interaction.constructor.name}.memberPermissions reads the member's permissions without the channel's ` +
        `overwrites here; in the next major version (5.0) it applies them, as Discord does, and reads ` +
        `${change.join(' and ')}. Set memberPermissions on the mock, or call useStrictMocks() to apply them now.`,
    )
  }
  return base
}

/** A permission set with none, frozen as discord.js freezes the ones it gives. */
const noPermissions = () => new PermissionsBitField().freeze()

/** A property discord.js computes from the others: its own getter runs, reading the mock's values. */
export const REAL_GETTER: unique symbol = Symbol('real getter')

/** A property's default: discord.js's own getter, or a value for the mock, typed as the class types it. */
type Default<T, K extends keyof T> = typeof REAL_GETTER | ((mock: T) => T[K])

/** The defaults of one class's data properties, each checked against the type discord.js gives the property. */
type Defaults<T> = { readonly [K in keyof T as T[K] extends (...args: never[]) => unknown ? never : K]?: Default<T, K> }

const snowflake = () => SnowflakeUtil.generate().toString()

/** A class and its defaults, typed together so a default that stops fitting its property fails to compile. */
const defaultsOf = <T>(Class: { prototype: T }, defaults: Defaults<T>) => [Class.prototype as object, defaults as Defaults<unknown>] as const

/**
 * What a mock reads for a data property discord.js always sets, where the test gave none: a value in Discord's shape,
 * such as `'en-US'` for a locale, `null` for what may be absent and `false` for a flag, or the property's own getter
 * for one discord.js computes. The classes a mock descends from are read nearest first.
 */
const DEFAULTS = new Map<object, Defaults<unknown>>([
  defaultsOf(Guild, {
    name: () => 'Guild',
    preferredLocale: () => Locale.EnglishUS,
    ownerId: snowflake,
    memberCount: () => 1,
    available: () => true,
    large: () => false,
    features: () => [],
    description: () => null,
    icon: () => null,
    banner: () => null,
    splash: () => null,
    systemChannelId: () => null,
    shardId: () => 0,
    nsfwLevel: () => GuildNSFWLevel.Default,
    verificationLevel: () => GuildVerificationLevel.None,
    presences: guild => ownedManager(PresenceManager.prototype, { guild }),
    premiumTier: () => GuildPremiumTier.None,
    createdTimestamp: REAL_GETTER,
    createdAt: REAL_GETTER,
  }),
  defaultsOf(ClientUser, {
    username: () => 'bot',
  }),
  defaultsOf(User, {
    username: () => 'user',
    bot: () => false,
    globalName: () => null,
    discriminator: () => '0',
    avatar: () => null,
    system: () => false,
    flags: () => new UserFlagsBitField(),
    tag: REAL_GETTER,
    displayName: REAL_GETTER,
    defaultAvatarURL: REAL_GETTER,
    createdTimestamp: REAL_GETTER,
    createdAt: REAL_GETTER,
  }),
  defaultsOf(GuildMember, {
    user: () => createMockUser(),
    id: REAL_GETTER,
    nickname: () => null,
    avatar: () => null,
    // In the server since the mock was made, as a member Discord sends always is
    joinedTimestamp: () => Date.now(),
    joinedAt: REAL_GETTER,
    partial: REAL_GETTER,
    premiumSince: REAL_GETTER,
    communicationDisabledUntil: REAL_GETTER,
    premiumSinceTimestamp: () => null,
    communicationDisabledUntilTimestamp: () => null,
    pending: () => false,
    flags: () => new GuildMemberFlagsBitField().freeze(),
    displayName: REAL_GETTER,
    roles: member => memberRoles(member, []),
    permissions: REAL_GETTER,
  }),
  defaultsOf(Role, {
    id: snowflake,
    name: () => 'role',
    // Above @everyone, which a server's role manager makes at position 0
    position: () => 1,
    // Every role has a server; one made without is in one of its own, unless a guild given it takes it in
    guild: () => createMockGuild(),
    rawPosition: role => role.position,
    permissions: noPermissions,
    hoist: () => false,
    managed: () => false,
    mentionable: () => false,
    icon: () => null,
    unicodeEmoji: () => null,
    tags: () => null,
    colors: () => ({ primaryColor: 0, secondaryColor: null, tertiaryColor: null }),
    hexColor: REAL_GETTER,
    createdTimestamp: REAL_GETTER,
    createdAt: REAL_GETTER,
  }),
  // A message's text says which handler it is for, so it stays the test's to give, as a command's name does
  defaultsOf(Message, {
    pinned: () => false,
    tts: () => false,
    type: () => MessageType.Default,
    system: () => false,
    webhookId: () => null,
    applicationId: () => null,
    nonce: () => null,
    position: () => null,
    activity: () => null,
    reference: () => null,
    poll: () => null,
    interactionMetadata: () => null,
    stickers: () => new Collection(),
    messageSnapshots: () => new Collection(),
    reactions: message => ownedManager(ReactionManager.prototype, { message }),
    url: REAL_GETTER,
  }),
  // A command's name and a component's customId say which handler a call is for, so they stay the test's to give
  defaultsOf(ChatInputCommandInteraction, { options: () => createChatInputOptions() as never }),
  defaultsOf(CommandInteraction, { commandId: snowflake, commandGuildId: () => null }),
  defaultsOf(AutocompleteInteraction, { commandId: snowflake, commandGuildId: () => null, options: () => createChatInputOptions() as never }),
  defaultsOf(MessageReaction, { users: reaction => ownedManager(ReactionUserManager.prototype, { reaction }) }),
  defaultsOf(BaseInteraction, {
    applicationId: snowflake,
    token: () => 'mock-interaction-token',
    version: () => 1,
    context: () => null,
    entitlements: () => new Collection(),
    // What Discord sends with an interaction in a server, the member's permissions there; typed for a cached one
    memberPermissions: interaction => {
      const { guildId } = interaction
      const member: unknown = interaction.member
      if (!guildId) return null as never
      if (member instanceof GuildMember) return inChannel(interaction, member) as never
      // A raw member's permissions are the string Discord sends, read as discord.js reads them
      return (isRawMember(member) && !interaction.guild ? new PermissionsBitField(BigInt(member.permissions)).freeze() : null) as never
    },
    // The bot's permissions where the interaction was made: its member's in the channel, or none outside a server
    appPermissions: interaction => {
      const { guild, channel } = interaction
      const me = guild instanceof Guild ? guild.members.me : null
      return (me && channel instanceof GuildChannel ? channel.permissionsFor(me) : null) ?? noPermissions()
    },
  }),
  defaultsOf(TextChannel, { type: () => ChannelType.GuildText as const, nsfw: () => false, topic: () => null, rateLimitPerUser: () => 0 }),
  defaultsOf(NewsChannel, { type: () => ChannelType.GuildAnnouncement as const, nsfw: () => false, topic: () => null }),
  defaultsOf(VoiceChannel, { type: () => ChannelType.GuildVoice as const, nsfw: () => false }),
  defaultsOf(ForumChannel, { type: () => ChannelType.GuildForum as const, nsfw: () => false, topic: () => null }),
  defaultsOf(MediaChannel, { type: () => ChannelType.GuildMedia as const, nsfw: () => false, topic: () => null }),
  defaultsOf(ThreadChannel, { type: () => ChannelType.PublicThread as const, name: () => 'thread' }),
  defaultsOf(DMChannel, { type: () => ChannelType.DM as const }),
  defaultsOf(GuildChannel, {
    name: () => 'channel',
    guildId: channel => (typeof channel.guild?.id === 'string' ? channel.guild.id : snowflake()),
    position: () => 0,
    rawPosition: () => 0,
    parentId: () => null,
  }),
  defaultsOf(BaseChannel, { createdTimestamp: REAL_GETTER, createdAt: REAL_GETTER }),
  defaultsOf(Client, { readyTimestamp: () => Date.now(), readyAt: REAL_GETTER, uptime: REAL_GETTER, token: () => null }),
  defaultsOf(BaseGuild, { nameAcronym: REAL_GETTER }),
])

/**
 * What strict mocks also read as Discord sends it, for discord.js's getters that read it: a server for a channel or
 * thread made without one, a thread's parent text channel in it, and data that is otherwise a placeholder.
 */
const STRICT_DEFAULTS = new Map<object, Defaults<unknown>>([
  defaultsOf(Message, { content: () => '', editedTimestamp: () => null, editedAt: REAL_GETTER }),
  defaultsOf(MessageMentions, { repliedUser: () => null }),
  defaultsOf(Guild, { rulesChannelId: () => null, publicUpdatesChannelId: () => null, systemChannel: REAL_GETTER }),
  defaultsOf(BaseGuild, { verified: REAL_GETTER }),
  defaultsOf(GuildMember, { presence: REAL_GETTER }),
  defaultsOf(ModalSubmitInteraction, { message: () => null }),
  defaultsOf(ThreadChannel, {
    guild: () => createMockGuild(),
    guildId: thread => thread.guild.id,
    parentId: thread => {
      const parent = createMockChannel(TextChannel, { guild: thread.guild } as never)
      thread.guild.channels.cache.set(parent.id, parent as never)
      return parent.id
    },
    parent: REAL_GETTER,
    ownerId: snowflake,
    archived: () => false,
    locked: () => false,
  }),
  defaultsOf(GuildChannel, { guild: () => createMockGuild(), parent: REAL_GETTER }),
  // Full once its members reach a user limit, which a voice channel has none of unless given one
  defaultsOf(BaseGuildVoiceChannel, { userLimit: () => 0, full: REAL_GETTER }),
  // A reaction's message, as discord.js always has one, is a whole one
  defaultsOf(MessageReaction, { count: () => 1, me: () => false, message: () => createMockMessage() }),
])

/**
 * What a mock reads as a placeholder unless strict mocks read it as discord.js gives it, by the value a test sets for
 * that, which the warning on reading one names.
 */
const PLACEHOLDER_VALUES = new Map<object, Readonly<Record<string, string>>>([
  [MessageReaction.prototype, { me: 'false' }],
  [MessageMentions.prototype, { repliedUser: 'null' }],
  [Message.prototype, { editedAt: 'null' }],
  [GuildMember.prototype, { presence: 'null' }],
  [BaseGuild.prototype, { verified: 'false' }],
  [Guild.prototype, { systemChannel: 'null' }],
  [GuildChannel.prototype, { parent: 'null' }],
  [ModalSubmitInteraction.prototype, { message: 'null' }],
])

/** The value a test sets for `key` on a mock of `target`'s class, when a mock reads it as a placeholder. */
export function placeholderValue(target: object, key: string): string | undefined {
  for (let proto = Object.getPrototypeOf(target) as object | null; proto !== null; proto = Object.getPrototypeOf(proto)) {
    const value = PLACEHOLDER_VALUES.get(proto)?.[key]
    if (value !== undefined) return value
  }
  return undefined
}

/** The default a mock of `target`'s class has for `key`, read from the nearest class that has one, strict ones first. */
export function discordDefault(target: object, key: string): Default<unknown, never> | undefined {
  for (const defaults of strictMocks() ? [STRICT_DEFAULTS, DEFAULTS] : [DEFAULTS]) {
    for (let proto = Object.getPrototypeOf(target) as object | null; proto !== null; proto = Object.getPrototypeOf(proto)) {
      const found = defaults.get(proto)?.[key as never]
      if (found !== undefined) return found as Default<unknown, never>
    }
  }
  return undefined
}
