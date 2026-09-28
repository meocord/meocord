import {
  AutocompleteInteraction,
  BaseChannel,
  BaseInteraction,
  ChannelType,
  Client,
  ClientUser,
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
  MessageType,
  NewsChannel,
  SnowflakeUtil,
  TextChannel,
  ThreadChannel,
  User,
  VoiceChannel,
} from 'discord.js'
import { createMockUser } from './mock-interaction.js'

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
    globalName: () => null,
    discriminator: () => '0',
    avatar: () => null,
    system: () => false,
    tag: REAL_GETTER,
    displayName: REAL_GETTER,
    createdTimestamp: REAL_GETTER,
    createdAt: REAL_GETTER,
  }),
  defaultsOf(GuildMember, {
    user: () => createMockUser(),
    id: REAL_GETTER,
    nickname: () => null,
    avatar: () => null,
    joinedTimestamp: () => null,
    premiumSinceTimestamp: () => null,
    communicationDisabledUntilTimestamp: () => null,
    pending: () => false,
    displayName: REAL_GETTER,
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
  defaultsOf(Client, { readyTimestamp: () => Date.now(), uptime: REAL_GETTER, token: () => null }),
])

/** The default a mock of `target`'s class has for `key`, read from the nearest class that has one. */
export function discordDefault(target: object, key: string): Default<unknown, never> | undefined {
  for (let proto = Object.getPrototypeOf(target) as object | null; proto !== null; proto = Object.getPrototypeOf(proto)) {
    const found = DEFAULTS.get(proto)?.[key as never]
    if (found !== undefined) return found as Default<unknown, never>
  }
  return undefined
}
