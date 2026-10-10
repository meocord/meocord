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
  botMemberOf,
  createChatInputOptions,
  createMockChannel,
  createMockGuild,
  createMockMessage,
  createMockUser,
  heldChannelOf,
  isRawMember,
  isUnsetEveryone,
  memberRoles,
  NEW_SERVER_EVERYONE_PERMISSIONS,
  ownedManager,
  readPlaceAs,
} from './mock-interaction.js'
import { strictMocks } from './strict-mocks.js'
import { Logger } from '@src/common/logger.js'
import { warnOnce } from '@src/common/deprecation.js'

const mockLogger = new Logger('Mocks')

/**
 * A member's permissions where an interaction was made, as Discord computes them: under strict mocks, every permission
 * for an Administrator or the owner, else the channel's overwrites on top of `member.permissions`, so a test that sets
 * those keeps the base; otherwise `member.permissions`, with a warning once where strict mocks would read otherwise.
 */
function inChannel(interaction: BaseInteraction, member: GuildMember): Readonly<PermissionsBitField> {
  const base = member.permissions
  // Only a server the mock caches has the overwrites to apply
  const { guild } = interaction
  if (!(guild instanceof Guild)) return base
  const computed =
    base.has(PermissionFlagsBits.Administrator) || member.id === guild.ownerId
      ? new PermissionsBitField(PermissionsBitField.All).freeze()
      : withOverwrites(base, overwritingChannel(interaction, guild), member)
  if (strictMocks()) return computed
  if (!computed.equals(base)) {
    const lost = new PermissionsBitField(base).remove(computed).toArray()
    const gained = new PermissionsBitField(computed).remove(base).toArray()
    const change = lost.length > 0 ? [`without ${lost.join(', ')}`] : []
    if (gained.length > 0) change.push(`with ${gained.join(', ')}`)
    warnOnce(
      mockLogger,
      `${interaction.constructor.name}.memberPermissions reads the member's own permissions here, without the ` +
        "channel's overwrites or every permission an Administrator or the owner has; in the next major version (5.0) " +
        `it reads them as Discord computes them in the channel, ${change.join(' and ')}. Set memberPermissions on the ` +
        'mock, or call useStrictMocks() to compute them now.',
    )
  }
  // Unless the test set them, a member's permissions come from its roles, @everyone's included
  if (!Object.prototype.hasOwnProperty.call(member, 'permissions')) warnOnUnsetEveryone(interaction, guild, 'memberPermissions', base)
  return base
}

/**
 * Warns once, as `key`, where `permissions` read a server's @everyone role default mode made with none, and lack what
 * strict mocks give @everyone in a new server.
 */
function warnOnUnsetEveryone(interaction: BaseInteraction, guild: Guild, key: string, permissions: Readonly<PermissionsBitField>): void {
  const everyone = guild.roles.everyone as Role | undefined
  if (!everyone || !isUnsetEveryone(everyone) || permissions.has(NEW_SERVER_EVERYONE_PERMISSIONS)) return
  warnOnce(
    mockLogger,
    `${interaction.constructor.name}.${key} reads the server's @everyone role here with no permissions; in the next major ` +
      'version (5.0) it has the permissions Discord gives @everyone in a new server, as strict mocks read it. Set ' +
      'guild.roles.everyone.permissions, or call useStrictMocks() to read it so now.',
  )
}

/**
 * The channel whose overwrites apply where an interaction was made, read without making or caching one: a thread's
 * parent, or undefined where the channel, or a thread's parent, is one the mock would make, which has none.
 */
function overwritingChannel(interaction: BaseInteraction, guild: Guild): GuildChannel | undefined {
  const channel = heldChannelOf(interaction, guild)
  // A thread's parent by the id the test gave it or one already read, so strict mocks' parent isn't made for this read
  const parentId = (thread: ThreadChannel) => (Object.prototype.hasOwnProperty.call(thread, 'parentId') ? thread.parentId : madeParentIds.get(thread))
  const at = channel instanceof ThreadChannel ? guild.channels.cache.get(parentId(channel) ?? '') : channel
  return at instanceof GuildChannel ? at : undefined
}

// The parent id strict mocks made for each thread made without one, once read
const madeParentIds = new WeakMap<object, string>()

interface Overwrite { allow: PermissionsBitField; deny: PermissionsBitField }

// Private in discord.js's typings, though they are what its own permissionsFor computes with; called on the prototype
// so a test's stub on the channel stays for its caller
const channelPermissions = GuildChannel.prototype as unknown as {
  overwritesFor(member: GuildMember, verified: boolean, roles: unknown): { everyone?: Overwrite; roles: Overwrite[]; member?: Overwrite }
  memberPermissions(member: GuildMember, checkAdmin: boolean): Readonly<PermissionsBitField>
}

/** `base` with `channel`'s overwrites for `member` applied, in discord.js's order: @everyone's, the roles', the member's. */
function withOverwrites(base: Readonly<PermissionsBitField>, channel: GuildChannel | undefined, member: GuildMember): Readonly<PermissionsBitField> {
  if (!channel) return base
  // Given the member and its roles as verified, as discord.js's memberPermissions does, so it resolves nothing again
  const overwrites = channelPermissions.overwritesFor.call(channel, member, true, member.roles.cache)
  return new PermissionsBitField(base)
    .remove(overwrites.everyone?.deny ?? 0n)
    .add(overwrites.everyone?.allow ?? 0n)
    .remove(overwrites.roles.length > 0 ? overwrites.roles.map(role => role.deny) : 0n)
    .add(overwrites.roles.length > 0 ? overwrites.roles.map(role => role.allow) : 0n)
    .remove(overwrites.member?.deny ?? 0n)
    .add(overwrites.member?.allow ?? 0n)
    .freeze()
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
    // Each reads where the interaction is as its own, and warns by its own name where strict mocks place it otherwise
    memberPermissions: interaction =>
      readPlaceAs(interaction, 'memberPermissions', () => {
        const { guildId } = interaction
        const member: unknown = interaction.member
        if (!guildId) return null as never
        if (member instanceof GuildMember) return inChannel(interaction, member) as never
        // A raw member's permissions are the string Discord sends, read as discord.js reads them
        return (isRawMember(member) && !interaction.guild ? new PermissionsBitField(BigInt(member.permissions)).freeze() : null) as never
      }),
    // The bot's permissions where the interaction was made: its member's in the channel, or in a thread its parent, as
    // discord.js computes them; none outside a server
    appPermissions: interaction =>
      readPlaceAs(
        interaction,
        'appPermissions',
        () => {
          const { guild } = interaction
          const me = guild instanceof Guild ? botMemberOf(guild) : null
          if (!(me instanceof GuildMember) || heldChannelOf(interaction, guild!) === null) return noPermissions()
          // discord.js's own computation, given its own overwritesFor over a test's stub on the channel; a channel the
          // mock would make has no overwrites
          const at = overwritingChannel(interaction, guild!) ?? { guild, permissionOverwrites: { cache: new Collection() } }
          const channel = Object.create(at, { overwritesFor: { value: channelPermissions.overwritesFor } }) as GuildChannel
          const permissions = channelPermissions.memberPermissions.call(channel, me, true)
          // The bot's member has @everyone's too
          warnOnUnsetEveryone(interaction, guild!, 'appPermissions', permissions)
          return permissions
        },
        // A server the bot isn't in has no guild in either mode, so no permissions in both
        place => !place.raw,
      ),
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
      madeParentIds.set(thread, parent.id)
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
  [MessageReaction.prototype, { me: 'false', message: 'createMockMessage()' }],
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
