import {
  AutocompleteInteraction,
  BaseGuild,
  BaseGuildVoiceChannel,
  BaseChannel,
  BaseInteraction,
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
  GuildNSFWLevel,
  GuildPremiumTier,
  GuildVerificationLevel,
  Locale,
  MediaChannel,
  Message,
  MessageReaction,
  MessageType,
  NewsChannel,
  PermissionsBitField,
  Role,
  SnowflakeUtil,
  TextChannel,
  ThreadChannel,
  User,
  VoiceChannel,
} from 'discord.js'
import { createMockChannel, createMockGuild, createMockUser, isRawMember, memberRoles } from './mock-interaction.js'
import { strictMocks } from './strict-mocks.js'

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
    url: REAL_GETTER,
  }),
  // A command's name and a component's customId say which handler a call is for, so they stay the test's to give
  defaultsOf(CommandInteraction, { commandId: snowflake, commandGuildId: () => null }),
  defaultsOf(AutocompleteInteraction, { commandId: snowflake, commandGuildId: () => null }),
  defaultsOf(BaseInteraction, {
    applicationId: snowflake,
    token: () => 'mock-interaction-token',
    version: () => 1,
    context: () => null,
    // What Discord sends with an interaction in a server, the member's permissions there; typed for a cached one
    memberPermissions: interaction => {
      const { guildId } = interaction
      const member: unknown = interaction.member
      if (!guildId) return null as never
      if (member instanceof GuildMember) return member.permissions as never
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
  defaultsOf(Message, { content: () => '' }),
  defaultsOf(Guild, { rulesChannelId: () => null, publicUpdatesChannelId: () => null }),
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
  defaultsOf(GuildChannel, { guild: () => createMockGuild() }),
  // Full once its members reach a user limit, which a voice channel has none of unless given one
  defaultsOf(BaseGuildVoiceChannel, { userLimit: () => 0, full: REAL_GETTER }),
  defaultsOf(MessageReaction, { count: () => 1 }),
])

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
