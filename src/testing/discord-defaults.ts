import {
  AutocompleteInteraction,
  AutoModerationRule,
  BaseGuild,
  BaseGuildVoiceChannel,
  BaseChannel,
  BaseInteraction,
  ButtonStyle,
  CategoryChannel,
  ChatInputCommandInteraction,
  ChannelType,
  Client,
  ClientUser,
  Collection,
  CommandInteraction,
  ComponentType,
  DirectoryChannel,
  DMChannel,
  ForumChannel,
  Guild,
  GuildChannel,
  GuildEmoji,
  GuildScheduledEvent,
  GuildMember,
  GuildMemberFlagsBitField,
  GuildMemberRoleManager,
  GuildNSFWLevel,
  GuildPremiumTier,
  GuildVerificationLevel,
  Invite,
  Locale,
  MediaChannel,
  Message,
  MessageMentions,
  MessageReaction,
  ModalSubmitInteraction,
  MessageComponentInteraction,
  MessageType,
  NewsChannel,
  PartialGroupDMChannel,
  PermissionFlagsBits,
  PermissionsBitField,
  PresenceManager,
  ReactionManager,
  ReactionUserManager,
  Role,
  StageChannel,
  Sticker,
  TextChannel,
  ThreadChannel,
  User,
  UserFlagsBitField,
  VoiceChannel,
} from 'discord.js'
import type {
  botMemberOf,
  createChatInputOptions,
  createMockChannel,
  createMockGuild,
  createMockMessage,
  createMockUser,
  heldChannelOf,
  isRawMember,
  isUnsetEveryone,
  madeAt,
  memberRoles,
  NEW_SERVER_EVERYONE_PERMISSIONS,
  ownedManager,
  readPlaceAs,
  readPlaceQuietly,
} from '@src/testing/mock-interaction.js'
import { createModalFields } from '@src/testing/modal-fields.js'
import { nextSnowflake } from '@src/testing/snowflake.js'
import { strictMocks } from '@src/testing/strict-mocks.js'
import { Logger } from '@src/common/logger.js'
import { warnOnce } from '@src/common/deprecation.js'

const mockLogger = new Logger('Mocks')

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
export type Default<T, K extends keyof T> = typeof REAL_GETTER | ((mock: T) => T[K])

/** The defaults of one class's data properties, each checked against the type discord.js gives the property. */
type Defaults<T> = { readonly [K in keyof T as T[K] extends (...args: never[]) => unknown ? never : K]?: Default<T, K> }

/** A class and its defaults, typed together so a default that stops fitting its property fails to compile. */
const defaultsOf = <T>(Class: { prototype: T }, defaults: Defaults<T>) => [Class.prototype as object, defaults as Defaults<unknown>] as const

/** A channel's or thread's server id, its guild's, as discord.js sets it; one of its own for a guild the mock lacks. */
const guildIdOf = (channel: GuildChannel | ThreadChannel): string => (typeof channel.guild?.id === 'string' ? channel.guild.id : nextSnowflake())

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

/** The mock factories and helpers the defaults make their values with, given by the module whose mocks read them. */
export interface MockMakers {
  botMemberOf: typeof botMemberOf
  createChatInputOptions: typeof createChatInputOptions
  createMockChannel: typeof createMockChannel
  createMockGuild: typeof createMockGuild
  createMockMessage: typeof createMockMessage
  createMockUser: typeof createMockUser
  heldChannelOf: typeof heldChannelOf
  isRawMember: typeof isRawMember
  isUnsetEveryone: typeof isUnsetEveryone
  madeAt: typeof madeAt
  memberRoles: typeof memberRoles
  NEW_SERVER_EVERYONE_PERMISSIONS: typeof NEW_SERVER_EVERYONE_PERMISSIONS
  ownedManager: typeof ownedManager
  readPlaceAs: typeof readPlaceAs
  readPlaceQuietly: typeof readPlaceQuietly
}

/**
 * The defaults a mock reads for a property the test gave none, made with `makers`: for `key` on a mock of `target`'s
 * class, the default of the nearest class that has one, strict ones first.
 */
export function discordDefaults(makers: MockMakers): (target: object, key: string) => Default<unknown, never> | undefined {
  const { botMemberOf, createChatInputOptions, createMockChannel, createMockGuild, createMockMessage, createMockUser, heldChannelOf, isRawMember, isUnsetEveryone, madeAt, memberRoles, NEW_SERVER_EVERYONE_PERMISSIONS, ownedManager, readPlaceAs, readPlaceQuietly } = makers

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

  /**
   * A member's join or a client's ready time: under strict mocks when the mock was made, as Discord sends it, so time a
   * test advances afterwards counts. Default mode stamps it at the first read and warns once.
   */
  function stampedAt(mock: object, name: string): number {
    if (strictMocks()) return madeAt(mock)
    warnOnce(
      mockLogger,
      `${name} here is the time it was first read; under useStrictMocks() it is the time the mock was made, so time a ` +
        'test advances afterwards counts.',
    )
    return Date.now()
  }

  /**
   * The server of a channel or thread made without one: the one its own guildId names, else one of its own. Its own
   * value is read, not its default, which reads the guild in turn.
   */
  function guildFromOwnId(channel: GuildChannel | ThreadChannel): Guild {
    const id: unknown = Object.getOwnPropertyDescriptor(channel, 'guildId')?.value
    return createMockGuild(typeof id === 'string' ? { id } : {}) as unknown as Guild
  }

  /** The bot's message a component interaction was used on, in the interaction's channel, holding that component. */
  function clickedMessage(interaction: MessageComponentInteraction): Message {
    const channel = readPlaceQuietly(() => interaction.channel)
    const bot: unknown = interaction.client?.user
    const { componentType: type } = interaction
    // A placeholder customId, for an interaction made without one, has no place in the component's data
    const customId = typeof interaction.customId === 'string' ? interaction.customId : undefined
    const component =
      type === ComponentType.Button
        ? { type, custom_id: customId, style: ButtonStyle.Primary }
        : type === ComponentType.StringSelect
          ? { type, custom_id: customId, options: [] }
          : typeof type === 'number'
            ? { type, custom_id: customId }
            : undefined
    return createMockMessage({
      ...(channel ? { channel: channel as never } : {}),
      ...(bot instanceof User ? { author: bot } : {}),
      components: (component ? [{ type: ComponentType.ActionRow, components: [component] }] : []) as never,
    }) as unknown as Message
  }

  /**
   * What a mock reads for a data property discord.js always sets, where the test gave none: a value in Discord's shape,
   * such as `'en-US'` for a locale, `null` for what may be absent and `false` for a flag, or the property's own getter
   * for one discord.js computes. The classes a mock descends from are read nearest first.
   */
  const DEFAULTS = new Map<object, Defaults<unknown>>([
    defaultsOf(Guild, {
      name: () => 'Guild',
      preferredLocale: () => Locale.EnglishUS,
      ownerId: nextSnowflake,
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
      joinedTimestamp: member => stampedAt(member, 'GuildMember.joinedTimestamp'),
      joinedAt: REAL_GETTER,
      partial: REAL_GETTER,
      premiumSince: REAL_GETTER,
      communicationDisabledUntil: REAL_GETTER,
      premiumSinceTimestamp: () => null,
      communicationDisabledUntilTimestamp: () => null,
      pending: () => false,
      flags: () => new GuildMemberFlagsBitField().freeze(),
      displayName: REAL_GETTER,
      // The colour of its highest coloured role, as discord.js computes it from the roles in its cache
      displayColor: REAL_GETTER,
      displayHexColor: REAL_GETTER,
      roles: member => memberRoles(member, []),
      permissions: REAL_GETTER,
    }),
    // A server's emoji, sticker, scheduled event and AutoMod rule are named, and what discord.js formats from them
    // computes: an emoji's mention and identifier, an event's and an invite's link
    defaultsOf(GuildEmoji, { name: () => 'emoji', animated: () => false, identifier: REAL_GETTER }),
    defaultsOf(Sticker, { name: () => 'sticker' }),
    defaultsOf(GuildScheduledEvent, { name: () => 'event', url: REAL_GETTER }),
    defaultsOf(AutoModerationRule, { name: () => 'rule' }),
    defaultsOf(Invite, { url: REAL_GETTER }),
    defaultsOf(Role, {
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
    defaultsOf(CommandInteraction, { commandId: nextSnowflake, commandGuildId: () => null }),
    defaultsOf(AutocompleteInteraction, { commandId: nextSnowflake, commandGuildId: () => null, options: () => createChatInputOptions() as never }),
    defaultsOf(MessageReaction, { users: reaction => ownedManager(ReactionUserManager.prototype, { reaction }) }),
    // The bot's message the component was used on, holding it, in the interaction's channel, as Discord always sends it;
    // the component discord.js finds there by its customId
    defaultsOf(MessageComponentInteraction, { message: clickedMessage, component: REAL_GETTER }),
    // A modal submitted with no fields given has none
    defaultsOf(ModalSubmitInteraction, { fields: () => createModalFields({}), components: () => [] }),
    defaultsOf(BaseInteraction, {
      applicationId: nextSnowflake,
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
    defaultsOf(StageChannel, { type: () => ChannelType.GuildStageVoice as const, nsfw: () => false, topic: () => null }),
    defaultsOf(CategoryChannel, { type: () => ChannelType.GuildCategory as const }),
    defaultsOf(DirectoryChannel, { type: () => ChannelType.GuildDirectory as const }),
    // A thread's server is its guild's, as discord.js sets it from the thread's guild
    defaultsOf(ThreadChannel, { type: () => ChannelType.PublicThread as const, name: () => 'thread', guildId: guildIdOf }),
    defaultsOf(DMChannel, { type: () => ChannelType.DM as const }),
    defaultsOf(PartialGroupDMChannel, { type: () => ChannelType.GroupDM as const }),
    defaultsOf(GuildChannel, {
      name: () => 'channel',
      guildId: guildIdOf,
      position: () => 0,
      rawPosition: () => 0,
      parentId: () => null,
    }),
    defaultsOf(BaseChannel, { createdTimestamp: REAL_GETTER, createdAt: REAL_GETTER }),
    defaultsOf(Client, { readyTimestamp: client => stampedAt(client, 'Client.readyTimestamp'), readyAt: REAL_GETTER, uptime: REAL_GETTER, token: () => null }),
    // What a member's roles show, computed from the roles in the cache as discord.js does
    defaultsOf(GuildMemberRoleManager, { color: REAL_GETTER, hoist: REAL_GETTER, icon: REAL_GETTER }),
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
      guild: guildFromOwnId,
      guildId: thread => thread.guild.id,
      parentId: thread => {
        const parent = createMockChannel(TextChannel, { guild: thread.guild } as never)
        thread.guild.channels.cache.set(parent.id, parent as never)
        madeParentIds.set(thread, parent.id)
        return parent.id
      },
      parent: REAL_GETTER,
      ownerId: nextSnowflake,
      archived: () => false,
      locked: () => false,
    }),
    defaultsOf(GuildChannel, { guild: guildFromOwnId, parent: REAL_GETTER }),
    // Full once its members reach a user limit, which a voice channel has none of unless given one
    defaultsOf(BaseGuildVoiceChannel, { userLimit: () => 0, full: REAL_GETTER }),
    // A reaction's message, as discord.js always has one, is a whole one
    defaultsOf(MessageReaction, { count: () => 1, me: () => false, message: () => createMockMessage() }),
  ])

  return (target, key) => {
    for (const defaults of strictMocks() ? [STRICT_DEFAULTS, DEFAULTS] : [DEFAULTS]) {
      for (let proto = Object.getPrototypeOf(target) as object | null; proto !== null; proto = Object.getPrototypeOf(proto)) {
        const found = defaults.get(proto)?.[key as never]
        if (found !== undefined) return found as Default<unknown, never>
      }
    }
    return undefined
  }
}
