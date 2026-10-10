import 'reflect-metadata'
import { createMockFn, type MockedFunction, type Mock, usesRunnerMockFn } from './mock-fn.js'
import {
  type APIAuthorizingIntegrationOwnersMap,
  type APIInteractionDataResolvedGuildMember,
  type APIInteractionGuildMember,
  type APIUser,
  type GuildMemberFlags,
  type PermissionResolvable,
  PermissionsBitField,
  type APIEmbed,
  type APIMessageTopLevelComponent,
  Component,
  ActionRow,
  Embed,
  type JSONEncodable,
  type MessageFlagsResolvable,
  type GuildBasedChannel,
  ApplicationCommandManager,
  VoiceChannel,
  ApplicationCommandOptionType,
  ApplicationCommandType,
  Attachment,
  ApplicationCommand,
  AuthorizingIntegrationOwners,
  Base,
  BaseChannel,
  BaseInteraction,
  BaseManager,
  BaseGuild,
  ChannelManager,
  DataManager,
  CDN,
  GuildChannel,
  PermissionOverwriteManager,
  PermissionOverwrites,
  ChannelSelectMenuInteraction,
  Client,
  ClientUser,
  type ChannelType,
  Collection,
  DiscordjsErrorCodes,
  DiscordjsError,
  DiscordjsTypeError,
  CommandInteractionOptionResolver,
  ComponentType,
  DMMessageManager,
  Guild,
  GuildBan,
  GuildBanManager,
  GuildChannelManager,
  GuildMember,
  GuildMemberManager,
  GuildMemberRoleManager,
  GuildMessageManager,
  GuildManager,
  InteractionType,
  Locale,
  MentionableSelectMenuInteraction,
  Message,
  MessageFlags,
  MessageFlagsBitField,
  MessageMentions,
  MessageReaction,
  Presence,
  PresenceManager,
  ReactionManager,
  ReactionUserManager,
  Role,
  RoleManager,
  RoleSelectMenuInteraction,
  StringSelectMenuInteraction,
  type TextBasedChannel,
  type AnyThreadChannel,
  TextChannel,
  ThreadChannel,
  ThreadMember,
  ThreadMemberManager,
  User,
  UserManager,
  UserContextMenuCommandInteraction,
  UserSelectMenuInteraction,
  type CacheType,
  type CommandInteractionOption,
  DMChannel,
  BaseGuildVoiceChannel,
  ForumChannel,
  GuildForumThreadManager,
  GuildTextThreadManager,
  MediaChannel,
  NewsChannel,
  SnowflakeUtil,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type CommandInteraction,
  type ContextMenuCommandInteraction,
  type MessageComponentInteraction,
  type MessageContextMenuCommandInteraction,
  type ModalSubmitInteraction,
  type OmitPartialGroupDMChannel,
  type PartialGroupDMChannel,
  type PrimaryEntryPointCommandInteraction,
} from 'discord.js'
import { createDiscordError } from './response.js'
import { stampCall } from '@src/common/response/call-order.js'
import { type ResponseCall } from '@src/common/response/response-state.js'
import { discordDefault, placeholderValue, REAL_GETTER } from './discord-defaults.js'
import { Logger } from '@src/common/logger.js'
import { warnOnce, warnPlaceholder } from '@src/common/deprecation.js'
import { asDiscordStores, embedsAsDiscordStores } from './discord-shape.js'
import { MOCK_BOT_ID, nextSnowflake } from './snowflake.js'
import { noteMockMade, strictMocks } from './strict-mocks.js'

// ---------------------------------------------------------------------------
// DeepMocked<T>
// ---------------------------------------------------------------------------

/**
 * A mock of `T`: every method a mock function, and every nested object mocked in turn, five levels deep, including a
 * discord.js structure that may be absent, such as a message's `member`, when it is present.
 *
 * It is what the mock factories return. It is assignable wherever `T` is expected, and each method takes
 * `mockResolvedValue` and the rest of {@link MockInstance}.
 *
 * @remarks
 * Properties `T` declares `readonly` cannot be assigned on the mock. Pass them to the factory as {@link MockProps}.
 *
 * @group Testing
 * @category Mocks
 * @see {@link createMockInteraction}
 * @see {@link createMock}
 */
export type DeepMocked<T, Depth extends number[] = []> = Depth['length'] extends 5
  ? T
  : {
      -readonly [K in keyof T]: T[K] extends (...args: any[]) => any
        ? MockedFunction<T[K]>
        : T[K] extends object
          ? DeepMocked<T[K], [...Depth, 0]>
          : // A structure of the mock itself that may be absent, such as a message's member, is mocked when present;
            // deeper ones keep their discord.js type, which costs a consumer's typecheck far less
            Depth extends []
            ? NonNullable<T[K]> extends Base
              ? DeepMocked<NonNullable<T[K]>, [...Depth, 0]> | Extract<T[K], null | undefined>
              : T[K]
            : T[K]
    } & T

/**
 * Property values a mock factory sets as it builds the mock.
 *
 * Use it for anything the discord.js class declares `readonly`, such as `ModalSubmitInteraction#customId`, which the
 * returned mock does not let you assign.
 *
 * @remarks
 * `authorizingIntegrationOwners` also takes the plain map Discord sends, such as
 * `{ [ApplicationIntegrationType.UserInstall]: userId }`, and becomes the object discord.js builds from it.
 *
 * @example
 * ```ts
 * const modal = createMockInteraction(ModalSubmitInteraction, { customId: 'feedback' })
 * ```
 *
 * @group Testing
 * @category Mocks
 * @see {@link createMockInteraction}
 */
export type MockProps<T> = {
  // Methods stay loosely typed: every literal carries `Object.prototype.valueOf`, which clashes with
  // discord.js `Base#valueOf(): string`. Objects take `T[K]` alone, since `DeepMocked<X> | X` is X.
  -readonly [K in keyof T]?: K extends 'authorizingIntegrationOwners'
    ? T[K] | APIAuthorizingIntegrationOwnersMap
    : T[K] extends (...args: any[]) => any
      ? (...args: any[]) => any
      : T[K]
}

// ---------------------------------------------------------------------------
// stubDeep — Proxy that answers each property it lacks: a mock fn for a method, a default, or a nested stub
// ---------------------------------------------------------------------------

const SKIP = new Set(['constructor', 'toString', 'valueOf', 'toJSON', 'then'])

// Each mock's own instance, which the proxy's traps receive as their target
const mockTargets = new WeakMap<object, object>()

type StubValue = Mock | object | string | number | boolean | null

function stubDeep(instance: object, externalStubs?: Map<string, StubValue>, onSet?: (prop: string | symbol, value: unknown) => void): object {
  noteMockMade()
  const stubs = externalStubs ?? new Map<string, StubValue>()
  // Placeholders read so far, by the value strict mocks give: a read of a kept one still warns, once
  const placeholders = new Map<string, string>()

  const proxy: object = new Proxy(instance, {
    get(target, prop) {
      // Always pass through symbols
      if (typeof prop === 'symbol') {
        return Reflect.get(target, prop, target)
      }

      const key = prop as string

      // 'then' must be undefined — prevents frameworks treating the mock as a Promise
      if (key === 'then') return undefined

      // Own property writes take precedence (e.g. interaction.guildId = 'abc')
      if (Object.prototype.hasOwnProperty.call(target, key)) {
        return Reflect.get(target, prop, target)
      }

      // Skip passthrough props — return prototype value as-is
      if (SKIP.has(key)) {
        return Reflect.get(target, prop, target)
      }

      // Return cached stub
      if (stubs.has(key)) {
        const kept = placeholders.get(key)
        if (kept !== undefined) warnPlaceholderRead(target, key, kept)
        return stubs.get(key)
      }

      // A value discord.js always gives, in its shape, rather than a stub: kept once read, or its getter run live
      const known = discordDefault(target, key)
      if (known === REAL_GETTER) {
        try {
          return Reflect.get(target, prop, proxy)
        } catch {
          // A getter that reads what the mock lacks falls back to a stub
        }
      } else if (known !== undefined) {
        const value = known(proxy as never) as StubValue
        stubs.set(key, value)
        return value
      }

      // A value strict mocks read as discord.js gives it, which is a placeholder otherwise
      const strictValue = strictMocks() ? undefined : placeholderValue(target, key)
      if (strictValue !== undefined) {
        placeholders.set(key, strictValue)
        warnPlaceholderRead(target, key, strictValue)
      }

      // Walk the prototype chain to check if it's a function
      let proto: object | null = Object.getPrototypeOf(target)
      let protoValue: unknown
      while (proto !== null) {
        const desc = Object.getOwnPropertyDescriptor(proto, key)
        if (desc !== undefined) {
          protoValue = desc.value
          if (desc.get && isPlaceholder(proto, key)) {
            // Strict mocks run discord.js's getter, read live; otherwise the placeholder, with a warning once
            if (strictMocks()) return Reflect.get(target, prop, proxy) as StubValue
            warnPlaceholderRead(target, key, 'false')
          }
          break
        }
        proto = Object.getPrototypeOf(proto)
      }

      // A client the mock's structures share: its guild's, or one of its own
      if (key === 'client' && target instanceof Base) return clientOf(target) as StubValue

      const stub: StubValue =
        typeof protoValue === 'function'
          ? isRealMethod(target, key)
            ? createMockFn((...args: unknown[]) => quietly(target, key, () => (protoValue as (...args: unknown[]) => unknown).apply(proxy, args)))
            : methodStub(target, key, protoValue as (...args: unknown[]) => unknown, () => proxy)
          : stubDeep({})
      stubs.set(key, stub)
      return stub
    },

    // defineProperty rather than assignment: many discord.js properties are
    // prototype getters with no setter (targetUser, targetMessage, createdAt),
    // and a plain write against one of those throws. Defining an own
    // data property shadows the accessor, which is what test setup means.
    set(target, prop, value) {
      Object.defineProperty(target, prop, { value, writable: true, enumerable: true, configurable: true })
      onSet?.(prop, value)
      return true
    },
  })
  mockTargets.set(proxy, instance)
  return proxy
}

// discord.js methods that read only what the mock holds, so they run for real: looking items up in a manager's cache,
// ranking roles, a member's or role's permissions in a channel, and whom a message mentions
const REAL_METHODS = new Map<object, ReadonlySet<string>>([
  [DataManager.prototype, new Set(['resolve', 'resolveId'])],
  [RoleManager.prototype, new Set(['comparePositions'])],
  [Role.prototype, new Set(['comparePositionTo', 'permissionsIn'])],
  [GuildChannel.prototype, new Set(['permissionsFor', 'overwritesFor', 'memberPermissions', 'rolePermissions'])],
  [GuildMember.prototype, new Set(['permissionsIn', 'isCommunicationDisabled'])],
  [User.prototype, new Set(['avatarURL', 'displayAvatarURL', 'bannerURL'])],
  [BaseGuild.prototype, new Set(['iconURL', 'bannerURL', 'splashURL'])],
  [MessageMentions.prototype, new Set(['has'])],
])

// What strict mocks also run for real: a thread's permissions are its parent channel's, as discord.js reads them
const STRICT_REAL_METHODS = new Map<object, ReadonlySet<string>>([[ThreadChannel.prototype, new Set(['permissionsFor'])]])

function isRealMethod(target: object, key: string): boolean {
  for (let proto = Object.getPrototypeOf(target) as object | null; proto !== null; proto = Object.getPrototypeOf(proto)) {
    if (REAL_METHODS.get(proto)?.has(key) || (strictMocks() && STRICT_REAL_METHODS.get(proto)?.has(key))) return true
  }
  return false
}

// discord.js's computed booleans a mock reads as a placeholder, which is truthy: 5.0 computes them, and until then a
// test that reads one is told so once
const PLACEHOLDER_BOOLEANS = new Map<object, ReadonlySet<string>>([
  [Message.prototype, new Set(['editable', 'deletable', 'pinnable', 'crosspostable', 'bulkDeletable', 'hasThread', 'partial'])],
  [GuildMember.prototype, new Set(['manageable', 'kickable', 'bannable', 'moderatable'])],
  [Role.prototype, new Set(['editable'])],
  [GuildChannel.prototype, new Set(['viewable', 'manageable', 'deletable'])],
  [ThreadChannel.prototype, new Set(['joinable', 'joined', 'sendable', 'unarchivable', 'editable', 'manageable', 'viewable'])],
  [BaseGuildVoiceChannel.prototype, new Set(['joinable', 'full'])],
  [VoiceChannel.prototype, new Set(['speakable'])],
  [User.prototype, new Set(['partial'])],
  [BaseChannel.prototype, new Set(['partial'])],
  [MessageReaction.prototype, new Set(['partial'])],
])

/** Whether `proto`'s getter for `key` is one of those, or a subclass's override of one, such as a voice channel's `joinable`. */
function isPlaceholder(proto: object | null, key: string): boolean {
  for (; proto !== null; proto = Object.getPrototypeOf(proto) as object | null) {
    if (PLACEHOLDER_BOOLEANS.get(proto)?.has(key)) return true
  }
  return false
}

const mockLogger = new Logger('Mocks')

// Mock reactions, and their messages, that MeoCord's dispatcher reads `partial` on
const dispatchedReactions = new WeakSet<object>()
let quiet = 0

/**
 * Runs a real method, keeping quiet about the placeholders `mentions.has()` reads: a placeholder `repliedUser` matches
 * no user, so its answer is discord.js's either way.
 */
function quietly<T>(target: object, key: string, run: () => T): T {
  if (!(target instanceof MessageMentions && key === 'has')) return run()
  quiet++
  try {
    return run()
  } finally {
    quiet--
  }
}

/**
 * Marks a mock reaction and its message as read by MeoCord's dispatcher, so a placeholder `partial` it reads warns
 * that MeoCord read it, and fetched for it.
 */
export function noteReactionDispatch(reaction: object): void {
  const target = mockTargets.get(reaction)
  if (!target) return
  dispatchedReactions.add(target)
  const message = mockTargets.get((reaction as { message?: object }).message ?? {})
  if (message) dispatchedReactions.add(message)
}

function warnPlaceholderRead(target: object, key: string, strictValue: string): void {
  if (quiet > 0) return
  const name = (Object.getPrototypeOf(target) as { constructor: { name: string } }).constructor.name
  if (key === 'partial' && dispatchedReactions.has(target)) {
    const fetched = target instanceof MessageReaction ? 'the reaction' : "the reaction's message"
    warnPlaceholder(
      mockLogger,
      `${name}.${key}`,
      'the mock computes it as discord.js does',
      `MeoCord's dispatcher read it while dispatching the reaction, and fetched ${fetched} since the placeholder is truthy. ` +
        'Set reaction.partial = false and reaction.message.partial = false on the mock, or call useStrictMocks() to have the mock compute them now.',
    )
    return
  }
  // The class name in camel case, a leading acronym included: dmChannel, guildMember
  const variable = name.replace(/^[A-Z]+(?=[A-Z][a-z])|^[A-Z]/, start => start.toLowerCase())
  warnPlaceholder(
    mockLogger,
    `${name}.${key}`,
    'the mock computes it as discord.js does',
    `Set it on the mock, such as ${variable}.${key} = ${strictValue}, to test either way, or call useStrictMocks() to have the mock compute it now.`,
  )
}

// The client of a structure made without one: the one its guild has, else one of its own, made once
const ownClients = new WeakMap<object, unknown>()
function clientOf(target: object): unknown {
  const guild = Object.getOwnPropertyDescriptor(target, 'guild')?.value as unknown
  if (guild instanceof Guild) return guild.client
  let client = ownClients.get(target)
  if (client === undefined) ownClients.set(target, (client = createMockClient()))
  return client
}

// ---------------------------------------------------------------------------
// methodStub — what an auto-stubbed discord.js method returns
// ---------------------------------------------------------------------------

// discord.js methods not declared `async` that still return a promise; `set*` setters are matched by name
const PROMISE_METHODS = new Set([
  'ban',
  'clone',
  'createDM',
  'createInvite',
  'disableCommunicationUntil',
  'edit',
  'fetch',
  'fetchFlags',
  'fetchInvites',
  'fetchMe',
  'fetchReply',
  'fetchWebhooks',
  'fetchWidget',
  'forward',
  'pin',
  'removeAttachments',
  'suppressEmbeds',
  'timeout',
  'unpin',
])

// The client user's presence setters, which apply at once and return the presence
const SYNC_SETTERS = new Set(['setActivity', 'setAFK', 'setPresence', 'setStatus'])

// Methods that resolve to a message, wherever they are declared
const MESSAGE_METHODS = new Set([
  'crosspost',
  'fetchReference',
  'fetchReply',
  'fetchStarterMessage',
  'forward',
  'reply',
  'send',
])

// Methods of a structure that resolve to the structure itself, as discord.js patches and returns it
const SELF_METHODS = new Set(['ban', 'delete', 'disableCommunicationUntil', 'edit', 'fetch', 'pin', 'timeout', 'unpin'])

// The DM channel of each user, made once, as Discord keeps one per user
const dmChannels = new WeakMap<object, object>()
function dmChannelOf(user: object): object {
  let channel = dmChannels.get(user)
  if (!channel) {
    channel = createMockChannel(DMChannel)
    // A getter in discord.js, so set through the mock, which defines it
    ;(channel as Record<string, unknown>).recipientId = (user as User).id
    dmChannels.set(user, channel)
  }
  return channel
}

/** The guild a manager belongs to, when it is a mock guild's. */
const guildOf = (manager: object): Guild | undefined => {
  const guild: unknown = (manager as { guild?: unknown }).guild
  return guild instanceof Guild ? guild : undefined
}

// The item each manager fetches, creates and edits: with the id asked for, but for a ban or a thread member, and a
// member or channel in the manager's guild
const MANAGER_ITEMS: [{ prototype: object }, (id: string | undefined, manager: object) => object][] = [
  [UserManager, id => createMockUser(id ? { id } : {})],
  [GuildManager, id => createMockGuild(id ? { id } : {})],
  [
    GuildMemberManager,
    (id, manager) => {
      const guild = guildOf(manager)
      return guild ? createMockMember({ user: createMockUser(id ? { id } : {}), guild }) : createMockInteraction(GuildMember)
    },
  ],
  [RoleManager, id => createMockInteraction(Role, id ? { id } : {})],
  [GuildBanManager, () => createMockInteraction(GuildBan)],
  [GuildMessageManager, id => createMockMessage(id ? { id } : {})],
  [DMMessageManager, id => createMockMessage(id ? { id } : {})],
  [GuildTextThreadManager, id => createMockChannel(ThreadChannel, id ? { id } : {})],
  [GuildForumThreadManager, id => createMockChannel(ThreadChannel, id ? { id } : {})],
  [ThreadMemberManager, () => createMockInteraction(ThreadMember)],
  [ReactionUserManager, id => createMockUser(id ? { id } : {})],
  [ApplicationCommandManager, id => createMockInteraction(ApplicationCommand, id ? { id } : {})],
  [ChannelManager, id => createMockChannel(TextChannel, id ? { id } : {})],
  [GuildChannelManager, (id, manager) => createMockChannel(TextChannel, { ...(id ? { id } : {}), ...(guildOf(manager) ? { guild: guildOf(manager) } : {}) } as never)],
]

const returnsPromise = (key: string, method: (...args: unknown[]) => unknown) =>
  method.constructor.name === 'AsyncFunction' ||
  PROMISE_METHODS.has(key) ||
  (/^set[A-Z]/.test(key) && !SYNC_SETTERS.has(key))

// The ids a fetch asks for: an id, a discord.js object, or options naming one or several, such as `{ user: id }` or
// `{ user: [ids] }`; undefined for a fetch of a list
function fetchedIds(args: unknown[]): string | string[] | undefined {
  const idOf = (value: unknown) => (typeof value === 'string' ? value : value instanceof Base ? (value as { id?: string }).id : undefined)
  const [first] = args
  if (typeof first !== 'object' || first === null || first instanceof Base) return idOf(first)
  for (const key of ['user', 'member', 'message', 'guild', 'thread', 'id']) {
    const value = (first as Record<string, unknown>)[key]
    if (Array.isArray(value)) return value.map(idOf).filter(id => id !== undefined)
    const id = idOf(value)
    if (id !== undefined) return id
  }
  return undefined
}

/**
 * The mock function for a method found on a discord.js prototype. One that returns a promise in discord.js resolves:
 * `createDM` to the user's DM channel, `send` and its kin to a message, a manager's `fetch`, `create` and `edit` to its
 * item (a collection of each for a fetch of several, an empty one for a list fetch), a structure's own `edit`, `fetch`,
 * `delete`, `ban`, `pin`, `unpin`, `timeout`, `disableCommunicationUntil` and setters to the structure, and the rest to
 * `undefined`. Any other method returns `undefined`.
 */
function methodStub(target: object, key: string, method: (...args: unknown[]) => unknown, receiver: () => object): Mock {
  if (!returnsPromise(key, method)) return createMockFn()
  // A member's DMs go through its user, and a user's through its one DM channel, as discord.js sends them
  if (target instanceof GuildMember && (key === 'createDM' || key === 'send')) {
    return createMockFn(async (...args: unknown[]) => ((receiver() as GuildMember).user[key] as (...args: unknown[]) => unknown)(...args))
  }
  if (key === 'createDM') return createMockFn(async () => dmChannelOf(receiver()))
  if (key === 'send' && target instanceof User) {
    return createMockFn(async (...args: unknown[]) => ((await (receiver() as User).createDM()).send as (...args: unknown[]) => unknown)(...args))
  }
  if (MESSAGE_METHODS.has(key)) return createMockFn(async () => createMockMessage())
  if (target instanceof BaseManager) {
    const item = MANAGER_ITEMS.find(([Manager]) => Manager.prototype.isPrototypeOf(target))?.[1]
    // A fetch of one item finds it in the cache first, as discord.js does, and caches one it makes; a fetch of
    // several does so for each
    if (item && key === 'fetch') {
      return createMockFn(async (...args: unknown[]) => {
        const ids = fetchedIds(args)
        const one = (id: string) => cached(cacheOf(receiver()), id, () => item(id, receiver()))
        if (Array.isArray(ids)) return new Collection(ids.map(id => [id, one(id)]))
        return ids === undefined ? new Collection() : one(ids)
      })
    }
    if (item && (key === 'create' || key === 'edit')) return createMockFn(async () => item(undefined, receiver()))
  } else if (target instanceof Base && (SELF_METHODS.has(key) || /^set[A-Z]/.test(key))) {
    return createMockFn(async () => receiver())
  }
  return createMockFn(async () => undefined)
}

// ---------------------------------------------------------------------------
// Class type fields — sets this.type / commandType / componentType on the
// instance so all prototype type-guard methods run with real logic
// ---------------------------------------------------------------------------

const CLASS_TYPE_FIELDS: Record<string, { type?: number; commandType?: number; componentType?: number }> = {
  ChatInputCommandInteraction: {
    type: InteractionType.ApplicationCommand,
    commandType: ApplicationCommandType.ChatInput,
  },
  ContextMenuCommandInteraction: { type: InteractionType.ApplicationCommand, commandType: ApplicationCommandType.User },
  UserContextMenuCommandInteraction: {
    type: InteractionType.ApplicationCommand,
    commandType: ApplicationCommandType.User,
  },
  MessageContextMenuCommandInteraction: {
    type: InteractionType.ApplicationCommand,
    commandType: ApplicationCommandType.Message,
  },
  PrimaryEntryPointCommandInteraction: {
    type: InteractionType.ApplicationCommand,
    commandType: ApplicationCommandType.PrimaryEntryPoint,
  },
  MessageComponentInteraction: { type: InteractionType.MessageComponent },
  ButtonInteraction: { type: InteractionType.MessageComponent, componentType: ComponentType.Button },
  StringSelectMenuInteraction: { type: InteractionType.MessageComponent, componentType: ComponentType.StringSelect },
  UserSelectMenuInteraction: { type: InteractionType.MessageComponent, componentType: ComponentType.UserSelect },
  RoleSelectMenuInteraction: { type: InteractionType.MessageComponent, componentType: ComponentType.RoleSelect },
  MentionableSelectMenuInteraction: {
    type: InteractionType.MessageComponent,
    componentType: ComponentType.MentionableSelect,
  },
  ChannelSelectMenuInteraction: { type: InteractionType.MessageComponent, componentType: ComponentType.ChannelSelect },
  ModalSubmitInteraction: { type: InteractionType.ModalSubmit },
  AutocompleteInteraction: { type: InteractionType.ApplicationCommandAutocomplete },
}

/** The collections each select menu's constructor builds beside its `values`, one per kind of choice it resolves. */
const SELECT_MENU_CHOICES: [abstract new (...args: any[]) => unknown, readonly string[]][] = [
  [StringSelectMenuInteraction, []],
  [UserSelectMenuInteraction, ['users', 'members']],
  [RoleSelectMenuInteraction, ['roles']],
  [ChannelSelectMenuInteraction, ['channels']],
  [MentionableSelectMenuInteraction, ['users', 'members', 'roles']],
]

// All known pure type-guard methods on BaseInteraction and its subclasses.
// These are wired as a mock fn wrapping the real prototype logic so they return
// correct values by default and can still be overridden per test.
const TYPE_GUARD_METHODS = [
  'isCommand',
  'isChatInputCommand',
  'isContextMenuCommand',
  'isUserContextMenuCommand',
  'isMessageContextMenuCommand',
  'isPrimaryEntryPointCommand',
  'isMessageComponent',
  'isButton',
  'isStringSelectMenu',
  'isUserSelectMenu',
  'isRoleSelectMenu',
  'isMentionableSelectMenu',
  'isChannelSelectMenu',
  'isAnySelectMenu',
  // `isSelectMenu` is left out: discord.js deprecates it in favour of `isStringSelectMenu`, and warns when it is called
  'isModalSubmit',
  'isAutocomplete',
  'isRepliable',
  'isFromMessage',
] as const

interface InteractionClass<T> {
  prototype: T
  name: string
}

function findPrototypeMethod(instance: object, name: string): ((...args: unknown[]) => unknown) | null {
  let proto: object | null = Object.getPrototypeOf(instance)
  while (proto !== null) {
    const desc = Object.getOwnPropertyDescriptor(proto, name)
    if (desc?.value && typeof desc.value === 'function') return desc.value as (...args: unknown[]) => unknown
    proto = Object.getPrototypeOf(proto)
  }
  return null
}

// ---------------------------------------------------------------------------
// Snowflake ids
// ---------------------------------------------------------------------------

/** The most choices Discord accepts in one autocomplete response. */
const MAX_AUTOCOMPLETE_CHOICES = 25

const isSnowflake = (id: unknown): id is string => typeof id === 'string' && /^\d{1,20}$/.test(id)

/**
 * Gives a mock the `createdTimestamp` and `createdAt` discord.js reads from its id: the time an id the test gave
 * encodes, or the time the mock was made while it has the counted id it was generated with, which encodes none.
 * A value the test sets replaces them.
 */
function defineCreatedTime(instance: object, generatedId: string | undefined): void {
  const madeAt = Date.now()
  const own = (key: string) => Object.prototype.hasOwnProperty.call(instance, key)
  if (!own('createdTimestamp')) {
    Object.defineProperty(instance, 'createdTimestamp', {
      get(this: { id?: unknown }) {
        return this.id !== generatedId && isSnowflake(this.id) ? SnowflakeUtil.timestampFrom(this.id) : madeAt
      },
      configurable: true,
    })
  }
  if (!own('createdAt')) {
    Object.defineProperty(instance, 'createdAt', {
      get(this: { createdTimestamp: number }) {
        return new Date(this.createdTimestamp)
      },
      configurable: true,
    })
  }
}

/**
 * Gives a user, server or channel mock its creation time. Under strict mocks, a generated id gives the time the mock
 * was made, as a message's. Otherwise it gives that id's own time, a fixed day in 2025, with a warning once when read.
 * An id the test gives decides it in both modes, and a value the test sets replaces it.
 */
function defineMadeTime(mock: object, generatedId: string | undefined): void {
  if (strictMocks()) return defineCreatedTime(mock, generatedId)
  const own = (key: string) => Object.prototype.hasOwnProperty.call(mock, key)
  const name = (Object.getPrototypeOf(mock) as { constructor: { name: string } }).constructor.name
  if (!own('createdTimestamp')) {
    Object.defineProperty(mock, 'createdTimestamp', {
      get(this: { id?: unknown }) {
        if (this.id === generatedId) {
          warnOnce(
            mockLogger,
            `${name}.createdTimestamp reads the time of its generated id here, a fixed day in 2025; in the next major version (5.0) ` +
              'it is the time the mock was made. Give the mock an id or a createdTimestamp, or call useStrictMocks() to have it read the time the mock was made now.',
          )
        }
        return isSnowflake(this.id) ? SnowflakeUtil.timestampFrom(this.id) : null
      },
      configurable: true,
    })
  }
  if (!own('createdAt')) {
    Object.defineProperty(mock, 'createdAt', {
      get(this: { createdTimestamp: number | null }) {
        return this.createdTimestamp === null ? null : new Date(this.createdTimestamp)
      },
      configurable: true,
    })
  }
}

/** Where a mock interaction keeps every answer it got, through respond() or discord.js directly, in order. */
export const RESPONSE_LOG: unique symbol = Symbol('response log')

type Behaviour = (...args: any[]) => any

/**
 * What an answer does to the interaction's reply state, before its behaviour runs: it throws to refuse the answer, or
 * makes the change, and returns how to undo it should the behaviour fail. `byTest` says a test set the behaviour.
 */
type AnswerGate = (args: unknown[], byTest: boolean) => () => void

/**
 * A mock of an answer method, `impl` its behaviour, that records each call in `log` as it is made, with what it sent
 * and, once it settles, what it rejected with. The record wraps every behaviour the mock is given, its own and any a
 * test sets, so the mock stays the plain mock function a runner's matchers read, bun's included, and `gate` keeps the
 * reply state whichever behaviour runs. `withResponse` is how a call asks discord.js for the message back, not part of
 * what it sends, so it is left out.
 */
function recordedMock(method: ResponseCall['method'], impl: Behaviour, log: ResponseCall[], gate?: AnswerGate): Mock {
  const record = (behaviour: Behaviour, byTest = true): Behaviour =>
    function (this: unknown, ...args: unknown[]) {
      const [payload] = args
      const sent =
        payload && typeof payload === 'object' && 'withResponse' in payload
          ? Object.fromEntries(Object.entries(payload).filter(([key]) => key !== 'withResponse'))
          : payload
      const call: ResponseCall = { method, payload: sent }
      stampCall(call)
      log.push(call)
      let undo: (() => void) | undefined
      try {
        // Before the behaviour, as discord.js changes the state at once: a second answer made without awaiting is refused
        if (gate) undo = gate(args, byTest)
      } catch (error) {
        call.error = error
        return Promise.reject(error)
      }
      const failed = (error: unknown) => {
        undo?.()
        call.error = error
        throw error
      }
      try {
        const result: unknown = Reflect.apply(behaviour, this, args)
        // Recorded and passed on, so a rejection nobody awaits is unhandled in the test, as it is on a bot
        if (result instanceof Promise) return result.then(undefined, failed)
        return result
      } catch (error) {
        return failed(error)
      }
    }
  const mock = createMockFn(record(impl, false)) as Mock & Record<string, unknown>
  const always = mock.mockImplementation.bind(mock) as (fn: Behaviour) => unknown
  const once = mock.mockImplementationOnce.bind(mock) as (fn: Behaviour) => unknown
  // Each way a test sets a behaviour goes through the record, a runner's own extras included where it has them
  const setters: Record<string, (value?: any) => Behaviour> = {
    mockImplementation: (fn: Behaviour) => fn,
    mockReturnValue: (value: unknown) => () => value,
    mockResolvedValue: (value: unknown) => () => Promise.resolve(value),
    mockRejectedValue: (value: unknown) => () => Promise.reject(value),
  }
  // In place of the mock's own, keeping whether each is among its keys
  const define = (name: string, value: unknown) =>
    Object.defineProperty(mock, name, {
      value,
      writable: true,
      enumerable: Object.getOwnPropertyDescriptor(mock, name)?.enumerable ?? false,
      configurable: true,
    })
  for (const [name, behaviourOf] of Object.entries(setters)) {
    define(name, (value?: unknown) => (always(record(behaviourOf(value))), mock))
    define(`${name}Once`, (value?: unknown) => (once(record(behaviourOf(value))), mock))
  }
  if (typeof mock.mockReturnThis === 'function') {
    define('mockReturnThis', () => (always(record(function (this: unknown) { return this })), mock))
  }
  const withImplementation = mock.withImplementation
  if (typeof withImplementation === 'function') {
    define('withImplementation', (fn: Behaviour, callback: () => unknown) => withImplementation.call(mock, record(fn), callback))
  }
  return mock
}

/** The interaction a mock options resolver was given to, for the server a user option's member is in. */
const optionOwners = new WeakMap<object, { guildId?: unknown; guild?: unknown }>()

/** An error as discord.js throws it, with its code, and with `message` in place of discord.js's own text when given. */
function discordjsError(code: DiscordjsErrorCodes, message?: string): DiscordjsError {
  const error = new (DiscordjsError as unknown as new (code: DiscordjsErrorCodes) => DiscordjsError)(code)
  if (message !== undefined) error.message = message
  return error
}

/** An error as discord.js's options resolver throws it: a `TypeError` with discord.js's code and message. */
const optionError = (code: DiscordjsErrorCodes, ...args: unknown[]): DiscordjsTypeError =>
  new (DiscordjsTypeError as unknown as new (code: DiscordjsErrorCodes, ...args: unknown[]) => DiscordjsTypeError)(code, ...args)

// In discord.js's error codes, though missing from its typings
const INVALID_CHANNEL_TYPE = 'CommandInteractionOptionInvalidChannelType' as DiscordjsErrorCodes

/** Records the interaction a mock options resolver belongs to. */
const ownOptions = (interaction: object, options: unknown): void => {
  if (typeof options === 'object' && options !== null) optionOwners.set(options, interaction)
}

/** A mock user that is a person, with an id of its own unless given one. */
const mockUser = (id?: string): object => {
  const generatedId = id === undefined ? nextSnowflake() : undefined
  const user = Object.assign(Object.create(User.prototype) as object, { id: id ?? generatedId, bot: false })
  defineMadeTime(user, generatedId)
  return stubDeep(user)
}

// ---------------------------------------------------------------------------
// createMockInteraction
// ---------------------------------------------------------------------------

// An interaction class's instance with the cache type `C`: discord.js declares each generic over it, and
// `Class.prototype` reads it as `any`, which passes for a cached server's and a raw one's alike
type WithCache<T, C extends CacheType> =
  T extends ChatInputCommandInteraction<any> ? ChatInputCommandInteraction<C>
  : T extends AutocompleteInteraction<any> ? AutocompleteInteraction<C>
  : T extends MessageContextMenuCommandInteraction<any> ? MessageContextMenuCommandInteraction<C>
  : T extends UserContextMenuCommandInteraction<any> ? UserContextMenuCommandInteraction<C>
  : T extends PrimaryEntryPointCommandInteraction<any> ? PrimaryEntryPointCommandInteraction<C>
  : T extends ContextMenuCommandInteraction<any> ? ContextMenuCommandInteraction<C>
  : T extends CommandInteraction<any> ? CommandInteraction<C>
  : T extends ButtonInteraction<any> ? ButtonInteraction<C>
  : T extends StringSelectMenuInteraction<any> ? StringSelectMenuInteraction<C>
  : T extends UserSelectMenuInteraction<any> ? UserSelectMenuInteraction<C>
  : T extends RoleSelectMenuInteraction<any> ? RoleSelectMenuInteraction<C>
  : T extends MentionableSelectMenuInteraction<any> ? MentionableSelectMenuInteraction<C>
  : T extends ChannelSelectMenuInteraction<any> ? ChannelSelectMenuInteraction<C>
  : T extends MessageComponentInteraction<any> ? MessageComponentInteraction<C>
  : T extends ModalSubmitInteraction<any> ? ModalSubmitInteraction<C>
  : T extends BaseInteraction<any> ? BaseInteraction<C>
  : T

// What makes an interaction one outside a server: no guild, no member, or a DM channel
type OutsideServer = { guild: null } | { member: null } | { channel: DMChannel | PartialGroupDMChannel }

/**
 * Creates a mock instance of a discord.js class, such as an interaction, keeping its prototype so `instanceof` holds.
 *
 * Use it for the interaction a test hands to `invoke` or `dispatch`. For a user, a message, a guild, a channel or a
 * client, the dedicated factories fill in what discord.js would; for a type with no class, use {@link createMock}.
 *
 * @remarks
 * Type guards such as `isButton()` run the real discord.js logic. An interaction gets an `id`, a `channelId` and a
 * `user` of its own unless given, and its `locale` is `'en-US'`; without a `guildId` it is a DM, and with one its
 * `member` is its user: for a `user` given, when the test gives the `guild`, the guild's cached member for that user,
 * so a message and an interaction from one user in that server share it, and `memberPermissions` are that member's
 * permissions (`null` in a DM). A user is a person, `bot: false`, and a member has the server's @everyone role and the
 * roles {@link createMockMember} gave it; with a `guildId` but no `guild`, a server the bot isn't in, that @everyone role
 * has the `guildId`. A DM sent to a member goes through its user's `send()` and the user's one DM channel. Its
 * `channel` is a text channel of its server, the one its guild caches under `channelId`, or the user's DM channel. A
 * `channel` given sets what the test leaves out of `channelId`, `guildId` and `guild`, as discord.js reads them from
 * it: a DM channel is no server, and a server's channel its server; one in another server than the `guildId` given is
 * refused, naming both. A select menu has picked nothing unless given: its
 * `values` are the ids of the `users` and `members`, `roles` or `channels` given, the collections of what it picks,
 * each empty unless given. Other data Discord always sends reads as
 * Discord sends it, such as `false` for a flag and `null` for what may be absent; what picks the handler, `commandName`
 * or `customId`, is the test's to give. Replies follow Discord's order, so a second `reply()` rejects, and
 * {@link getResponse} reports every answer the interaction got. Every method is a mock function, and one that returns a
 * promise in discord.js resolves.
 *
 * An answer keeps that order whatever it is set to do: one a test gives a value with `mockResolvedValue` replies or
 * defers as a real one would, and one that rejects changes nothing. `fetchReply()` reads back what `reply()` or
 * `update()` sent; after `deleteReply()`, or before any answer, fetching, editing or deleting the original response
 * rejects with 10008 (Unknown Message), while follow-ups stay reachable by their id. Flags are read as discord.js
 * reads them, and its errors carry its codes, such as `InteractionAlreadyReplied`.
 *
 * Given `guild: null`, `member: null` or a DM channel, it is typed as an interaction that may come from anywhere, so
 * its `guild` and `member` read as possibly `null`; otherwise as one from a server the bot is in.
 *
 * @param Class - The discord.js class to mock.
 * @param props - Values for properties the class declares `readonly`; see {@link MockProps}.
 *
 * @example
 * ```ts
 * import { expect } from 'vitest'
 *
 * const interaction = createMockInteraction(ButtonInteraction, { customId: 'ticket/42/close' })
 * expect(interaction.isButton()).toBe(true)
 * await interaction.reply({ content: 'Closed.' })
 * expect(interaction.replied).toBe(true)
 * await expect(interaction.reply({ content: 'Again.' })).rejects.toThrow()
 * ```
 *
 * @group Testing
 * @category Mocks
 * @see {@link MockProps}
 * @see {@link createChatInputOptions}
 * @see {@link https://meocord.dev/docs/4.2/mocks | Mocks}
 */
export function createMockInteraction<T extends object>(
  Class: InteractionClass<T>,
  props?: MockProps<T>,
): DeepMocked<T>
/**
 * Creates a mock interaction from a server the bot isn't in: one given a {@link createMockRawMember | raw member} and
 * that server's `guildId`, as a user-installed command run there arrives.
 *
 * It is typed as discord.js types an interaction from such a server, `'raw'`: its `guild` is `null` and its `member`
 * the raw member. Everything else is as {@link createMockInteraction} builds it.
 *
 * @param Class - The discord.js interaction class to mock.
 * @param props - The interaction's properties, with the raw `member` and the server's `guildId`; see {@link MockProps}.
 *
 * @example
 * ```ts
 * import { expect } from 'vitest'
 *
 * const command = createMockInteraction(ChatInputCommandInteraction, { guildId: '100000000000000001', member: createMockRawMember() })
 * expect(command.inRawGuild()).toBe(true)
 * ```
 *
 * @group Testing
 * @category Mocks
 */
export function createMockInteraction<T extends object>(
  Class: InteractionClass<T>,
  // Options from createChatInputOptions are typed for any server, so a raw interaction takes them as they are
  props: Omit<MockProps<WithCache<T, 'raw'>>, 'options'> & { options?: object; guildId: string; member: APIInteractionGuildMember },
): DeepMocked<WithCache<T, 'raw'>>
/**
 * Creates a mock interaction from outside a server: one given `guild: null`, `member: null` or a DM channel, as from a
 * direct message or a server the bot isn't in.
 *
 * It is typed as discord.js types an interaction that may come from anywhere, so its `guild` and `member` may be
 * `null`. Everything else is as {@link createMockInteraction} builds it from a server.
 *
 * @param Class - The discord.js interaction class to mock.
 * @param props - The interaction's properties, with `guild: null`, `member: null` or a DM `channel`; see {@link MockProps}.
 *
 * @example
 * ```ts
 * import { expect } from 'vitest'
 *
 * const command = createMockInteraction(ChatInputCommandInteraction, { channel: createMockChannel(DMChannel), guild: null })
 * expect(command.inGuild()).toBe(false)
 * ```
 *
 * @group Testing
 * @category Mocks
 */
export function createMockInteraction<T extends object>(
  Class: InteractionClass<T>,
  props: MockProps<WithCache<T, CacheType>> & OutsideServer,
): DeepMocked<WithCache<T, CacheType>>
export function createMockInteraction<T extends object>(Class: InteractionClass<T>, props?: MockProps<T>): DeepMocked<T> {
  const instance = Object.create(Class.prototype) as Record<string, unknown>
  const stubs = new Map<string, Mock>()

  // Set type fields so all prototype type-guard methods compute the right value
  const fields = CLASS_TYPE_FIELDS[Class.name]
  if (fields !== undefined) {
    for (const [key, value] of Object.entries(fields)) {
      instance[key] = value
    }
  }

  // Each type guard runs the real prototype implementation, as the mock's own, so a reset keeps it; a test may override it
  for (const name of TYPE_GUARD_METHODS) {
    const method = findPrototypeMethod(instance, name)
    if (method !== null) stubs.set(name, createMockFn(() => method.call(instance)))
  }

  // Guild checks read the mock's own data, since discord.js resolves `guild` through a client the
  // mock lacks: a guildId is a guild, a guild object with it a cached one, neither a DM. A member
  // not given is the user's on an interaction, and the auto-stub elsewhere, so only one set to null or undefined fails.
  const own = (key: string) => (Object.prototype.hasOwnProperty.call(instance, key) ? instance[key] : undefined)
  const hasMember = () => !Object.prototype.hasOwnProperty.call(instance, 'member') || Boolean(instance.member)
  const guildChecks = {
    inGuild: () => Boolean(own('guildId') && hasMember()),
    inCachedGuild: () => Boolean(own('guildId') && own('guild') && hasMember()),
    inRawGuild: () => Boolean(own('guildId') && !own('guild') && hasMember()),
  }
  for (const [name, check] of Object.entries(guildChecks)) {
    if (findPrototypeMethod(instance, name) !== null) stubs.set(name, createMockFn(check))
  }

  // Set up reply state machine for repliable interactions
  const isRepliableMethod = findPrototypeMethod(instance, 'isRepliable')
  const repliable = isRepliableMethod !== null && (isRepliableMethod.call(instance) as boolean)
  if (repliable) {
    instance.replied = false
    instance.deferred = false
    instance.ephemeral = false

    // discord.js's errors, with their codes; a call before any answer keeps the message the mock has always given
    const alreadyReplied = () => discordjsError(DiscordjsErrorCodes.InteractionAlreadyReplied)
    const notYetReplied = (method: string) =>
      discordjsError(DiscordjsErrorCodes.InteractionNotReplied, `Cannot call ${method}() before replying or deferring.`)

    // Only `flags` is read: discord.js deprecates the `ephemeral: true` reply option, and honouring it here would let
    // a test pass against a deprecated call. Read as discord.js reads them, so a flag it refuses throws here too.
    const hasEphemeralFlag = (options: unknown): boolean => {
      const flags = (options as { flags?: MessageFlagsResolvable | null } | undefined)?.flags
      if (typeof options !== 'object' || flags === null || flags === undefined) return false
      return new MessageFlagsBitField(flags).has(MessageFlags.Ephemeral)
    }

    // A message the interaction holds: its original response, or a follow-up, by id. One an answer sent is built from
    // its payload when first read, so sending builds nothing into JSON that discord.js would build itself
    type Held = HeldMessage | (() => HeldMessage)
    const built = (held: Held): HeldMessage => (typeof held === 'function' ? held() : held)
    let original: Held | undefined
    let originalGone = false
    const followUps = new Map<string, Held>()
    // Whether the last answer ran a behaviour a test set, after which a second answer runs with a warning by default
    let answeredByTest = false
    // A command answered with a modal has no original response, and Discord refuses one asked for
    let modalAnswered = false

    const isComponent = instance.type === InteractionType.MessageComponent
    // The original response of a component, or of a modal submitted from one, is the message it's on
    const componentMessage = () => heldFrom(instance.message)

    const snapshot = () => {
      const saved = {
        replied: instance.replied,
        deferred: instance.deferred,
        ephemeral: instance.ephemeral,
        original,
        originalGone,
        followUps: new Map(followUps),
        answeredByTest,
        modalAnswered,
      }
      return () => {
        Object.assign(instance, { replied: saved.replied, deferred: saved.deferred, ephemeral: saved.ephemeral })
        ;({ original, originalGone, answeredByTest, modalAnswered } = saved)
        followUps.clear()
        for (const [id, held] of saved.followUps) followUps.set(id, held)
      }
    }

    /**
     * Refuses an answer as discord.js does. Where the refusal turns on a behaviour a test set, this answer's or the
     * one before it, which ran without one, default mode warns and lets it run; strict mocks refuse it.
     */
    const refuse = (method: string, error: Error, byTest: boolean): void => {
      if (!(byTest || answeredByTest) || strictMocks()) throw error
      warnOnce(
        mockLogger,
        `${method}() here is refused by discord.js with "${error.message}", but the mock runs it, as a test set this ` +
          'answer or the one before it. In the next major version (5.0) the mock refuses it; call useStrictMocks() to ' +
          'have it refused now.',
      )
    }
    const answered = () => instance.deferred || instance.replied

    /** A first answer: refused once the interaction has one, else it replies or defers. */
    const first = (method: string, kind: 'replied' | 'deferred', then: (args: unknown[]) => void): AnswerGate =>
      (args, byTest) => {
        if (answered()) refuse(method, alreadyReplied(), byTest)
        // Read first: flags discord.js refuses throw before anything changes
        const ephemeral = method === 'reply' || method === 'deferReply' ? hasEphemeralFlag(args[0]) : undefined
        const undo = snapshot()
        instance[kind] = true
        if (ephemeral) instance.ephemeral = true
        answeredByTest = byTest
        then(args)
        return undo
      }

    /** A later answer: refused before the interaction has one. */
    const later = (method: string, then: (args: unknown[]) => void): AnswerGate =>
      (args, byTest) => {
        if (!answered()) refuse(method, notYetReplied(method), byTest)
        const undo = snapshot()
        then(args)
        return undo
      }

    /** The id an edit, fetch or delete names, `undefined` for the original response. */
    const targetId = (message: unknown): string | undefined => {
      if (message === undefined || message === '@original') return undefined
      return typeof message === 'string' ? message : ((message as { id?: string }).id ?? undefined)
    }
    /** The message an edit, fetch or delete reaches, or why Discord refuses it: it is gone or never was. */
    const target = (id: string | undefined): HeldMessage | undefined => {
      if (id !== undefined) {
        const held = followUps.get(id)
        if (held) followUps.set(id, built(held))
        return held && built(held)
      }
      if (originalGone || modalAnswered) return undefined
      // Answered without one of the mock's calls, as after a 40060 or a test setting `replied`: the original is there
      if (!original && answered()) original = componentMessage()
      if (original) original = built(original)
      return original
    }
    const unknownMessage = () => createDiscordError(10008, 'Unknown Message')
    // Each call's message, read by its behaviour right after the gate made it
    let made: HeldMessage | undefined
    let followUpMade: string | undefined

    // Every answer the interaction gets, through respond() or discord.js directly, in order, for getResponse
    const log: ResponseCall[] = []
    Object.defineProperty(instance, RESPONSE_LOG, { value: log })
    const answer = (method: ResponseCall['method'], impl: Behaviour, gate: AnswerGate) =>
      stubs.set(method, recordedMock(method, impl, log, gate))

    answer('reply', async () => undefined, first('reply', 'replied', ([options]) => (original = () => sent(options))))
    answer('deferReply', async () => undefined, first('deferReply', 'deferred', () => (original = sent(undefined))))
    answer(
      'followUp',
      // Its id, which an edit, fetch or delete reaches it by
      async () => createMockMessage({ id: followUpMade }),
      later('followUp', ([options]) => {
        instance.replied = true
        // Its id now, for the message followUp() resolves to; the rest when first read
        const id = nextSnowflake()
        made = undefined
        const held = () => ({ ...sent(options), id })
        followUps.set(id, held)
        followUpMade = id
      }),
    )
    // An edit replaces the message in the shape Discord stores, with ids and resolved media, stamped with when it was
    // edited, and fetchReply() reads that back, so code comparing the two sees what it would against Discord
    answer(
      'editReply',
      async () => {
        if (!made) throw unknownMessage()
        // The response has the message as Discord answers the edit, before its uploaded files have loaded again
        return messageFrom({ ...made, components: made.returned ?? made.components })
      },
      later('editReply', ([options]) => {
        const id = targetId((options as { message?: unknown } | undefined)?.message)
        const held = target(id)
        made = held && edited(held, options)
        if (!made) return
        if (id === undefined) {
          original = made
          instance.replied = true
        } else followUps.set(id, made)
      }),
    )
    stubs.set(
      'fetchReply',
      createMockFn(async (message?: unknown) => {
        const held = target(targetId(message))
        if (!held) throw unknownMessage()
        return messageFrom(held)
      }),
    )
    answer(
      'deleteReply',
      async () => {
        if (!made) throw unknownMessage()
      },
      later('deleteReply', ([message]) => {
        const id = targetId(message)
        made = target(id)
        if (!made) return
        if (id === undefined) originalGone = true
        else followUps.delete(id)
      }),
    )

    // showModal — the first response of a command or a component, like reply()
    if (instance.type === InteractionType.ApplicationCommand || isComponent) {
      answer(
        'showModal',
        async () => undefined,
        first('showModal', 'replied', () => {
          modalAnswered = instance.type === InteractionType.ApplicationCommand
          if (isComponent) original = componentMessage()
        }),
      )
    }

    // deferUpdate / update — components, and modals submitted from a message's component
    if (isComponent || instance.type === InteractionType.ModalSubmit) {
      answer('update', async () => undefined, first('update', 'replied', ([options]) => (original = () => edited(componentMessage(), options))))
      answer('deferUpdate', async () => undefined, first('deferUpdate', 'deferred', () => (original = componentMessage())))
    }
  }

  // Autocomplete is not repliable, but it has a response of its own: Discord accepts
  // one `respond()` per interaction and rejects the second. Without `responded` set
  // here it would read as an auto-stubbed object -- truthy -- and any code that checks
  // it before answering would decide the window was already closed.
  if (instance.type === InteractionType.ApplicationCommandAutocomplete) {
    instance.responded = false
    stubs.set(
      'respond',
      createMockFn(async (choices?: unknown) => {
        if (instance.responded) throw discordjsError(DiscordjsErrorCodes.InteractionAlreadyReplied)
        // Discord refuses a list longer than its limit, and the menu shows nothing
        if (Array.isArray(choices) && choices.length > MAX_AUTOCOMPLETE_CHOICES) {
          throw createDiscordError(50035, `Invalid Form Body\ndata.choices[BASE_TYPE_MAX_LENGTH]: Must be ${MAX_AUTOCOMPLETE_CHOICES} or fewer in length.`)
        }
        instance.responded = true
      }),
    )
  }

  // Applied last so an explicit prop wins over the type fields and the reply
  // state machine. defineProperty rather than assignment for the same reason the
  // Proxy uses it: several of these shadow a getter-only prototype accessor.
  if (props !== undefined) {
    for (const [key, given] of Object.entries(props)) {
      // A plain `{ [ApplicationIntegrationType.UserInstall]: userId }` becomes the object discord.js builds from it
      const value =
        key === 'authorizingIntegrationOwners' && given && !(given instanceof AuthorizingIntegrationOwners)
          ? new (AuthorizingIntegrationOwners as unknown as new (client: unknown, data: unknown) => AuthorizingIntegrationOwners)(
              instance.client,
              given,
            )
          : given
      Object.defineProperty(instance, key, { value, writable: true, enumerable: true, configurable: true })
    }
    ownOptions(instance, (props as { options?: unknown }).options)
  }

  // Ids and a user, as Discord always sends; no server unless the test names one, as in a direct message
  if (BaseInteraction.prototype.isPrototypeOf(instance)) {
    const unset = (key: string) => !Object.prototype.hasOwnProperty.call(instance, key)
    const generatedId = unset('id') ? (instance.id = nextSnowflake()) : undefined
    defineCreatedTime(instance, generatedId)
    // A raw member is from a server the bot isn't in: no cached guild, and its user the interaction's, as discord.js reads it
    const raw = own('member')
    // Given with a guild, a raw-shaped member is kept as the cached server's member it was before raw members
    if (isRawMember(raw) && own('guild')) {
      warnOnce(
        mockLogger,
        "The member given is a raw member, from a server the bot isn't in, but the mock was given a guild, so it reads as a " +
          'cached server: leave the guild out for a raw member, or give a GuildMember.',
      )
    } else if (isRawMember(raw)) {
      const rawOnly = "The member given is a raw member, from a server the bot isn't in"
      if (!own('guildId')) throw new Error(`${rawOnly}, so the mock needs that server's guildId.`)
      if (own('channel') !== undefined) throw new Error(`${rawOnly}, where discord.js caches no channel, but the mock was given a channel: leave the channel out.`)
      const givenUser = own('user') as { id: string } | undefined
      if (givenUser && givenUser.id !== raw.user.id) {
        throw new Error(`The member given is user ${raw.user.id}'s, but the mock's user is ${givenUser.id}: give the same user, or leave one of them out.`)
      }
      if (!givenUser) {
        const { id, username, global_name: globalName, discriminator, avatar } = raw.user
        instance.user = createMockUser({ id, username, globalName: globalName ?? null, discriminator, avatar: avatar ?? null })
      }
      Object.defineProperty(instance, 'guild', { value: null, writable: true, enumerable: true, configurable: true })
      // Only its channelId: discord.js caches no channel from a server the bot isn't in
      Object.defineProperty(instance, 'channel', { value: null, writable: true, enumerable: true, configurable: true })
    }
    const userGiven = !unset('user')
    if (!userGiven) instance.user = mockUser()
    // Assigned once by discord.js's Base constructor, as on a message, and the gateway caches the user on it
    if (unset('client')) Object.defineProperty(instance, 'client', { value: createMockClient(), writable: true, configurable: true })
    // The client caches the guild the interaction came from
    const guildGiven = own('guild')
    if (guildGiven instanceof Guild) cached(cacheOf((instance.client as Client).guilds), guildGiven.id, () => guildGiven)
    cacheOf((instance.client as Client | undefined)?.users)?.set((instance.user as User).id, instance.user)
    // A channel given says where the interaction was made, for what the test leaves unset, as discord.js reads it
    const given = own('channel')
    if (typeof given === 'object' && given !== null) {
      const givenGuild = own('guild') as Guild | null | undefined
      const givenGuildId = unset('guildId') ? (givenGuild === undefined ? undefined : (givenGuild?.id ?? null)) : (own('guildId') as string | null)
      const place = placeOf(given, givenGuildId, () => ({ guildId: givenGuildId ?? nextSnowflake(), guild: givenGuild ?? null }))
      if (unset('channelId')) instance.channelId = place.channelId
      if (place.guildId !== undefined) {
        if (unset('guildId')) instance.guildId = place.guildId
        if (unset('guild') && (place.guild || place.guildId === null)) {
          Object.defineProperty(instance, 'guild', { value: place.guild, writable: true, enumerable: true, configurable: true })
        }
      }
      cacheChannel(given, own('guild'), own('client'))
    }
    // In a direct message, the user's DM channel, the one their send() goes through
    if (unset('channelId')) instance.channelId = unset('guildId') ? (dmChannelOf(instance.user as object) as { id: string }).id : nextSnowflake()
    if (unset('guildId')) {
      instance.guildId = null
      if (unset('guild')) Object.defineProperty(instance, 'guild', { value: null, writable: true, configurable: true })
    }
    // The channel it came from, as the gateway caches it for an interaction: one of its server's, or the user's DM
    let channel: unknown
    if (unset('channel')) {
      Object.defineProperty(instance, 'channel', {
        get: () => {
          if (channel === undefined) {
            channel = channelFor(own('guild'), own('guildId') as string | null, own('channelId') as string, own('user') as object)
            cacheChannel(channel as object, own('guild'), own('client'))
          }
          return channel
        },
        set: (value: unknown) => Object.defineProperty(instance, 'channel', { value, writable: true, enumerable: true, configurable: true }),
        enumerable: true,
        configurable: true,
      })
    }
    // The user as a member while the mock has a guildId, as discord.js has one for an interaction in a server
    let member: unknown
    if (unset('member')) {
      Object.defineProperty(instance, 'member', {
        get: () => (own('guildId') ? (member ??= memberFor(own('guild'), own('user') as { id: string }, userGiven, own('guildId') as string)) : null),
        set: (value: unknown) => Object.defineProperty(instance, 'member', { value, writable: true, enumerable: true, configurable: true }),
        enumerable: true,
        configurable: true,
      })
    }
    // A user context menu's target: the user with its targetId, the client's cached one or one made and cached there,
    // and in a server that user's member; each read live, so a targetId set later picks its user, and assignable
    if (UserContextMenuCommandInteraction.prototype.isPrototypeOf(instance)) {
      if (unset('targetId')) instance.targetId = (own('targetUser') as User | undefined)?.id ?? nextSnowflake()
      const targetUser = (): User => {
        const id = own('targetId') as string
        return cached(cacheOf((instance.client as Client).users), id, () => mockUser(id)) as User
      }
      const live = (key: string, read: () => unknown) =>
        Object.defineProperty(instance, key, {
          get: read,
          set: (value: unknown) => Object.defineProperty(instance, key, { value, writable: true, enumerable: true, configurable: true }),
          enumerable: true,
          configurable: true,
        })
      if (unset('targetUser')) live('targetUser', targetUser)
      if (unset('targetMember')) {
        live('targetMember', () => (own('guildId') ? memberFor(own('guild'), targetUser(), true, own('guildId') as string) : null))
      }
    }
  }

  // Discord sends the user's locale with every interaction, and the server's preferred one with one made in a server
  if (BaseInteraction.prototype.isPrototypeOf(instance)) {
    if (own('locale') === undefined) instance.locale = Locale.EnglishUS
    if (!Object.prototype.hasOwnProperty.call(instance, 'guildLocale')) {
      const preferred = (own('guild') as { preferredLocale?: unknown } | null | undefined)?.preferredLocale
      instance.guildLocale = own('guildId') ? (typeof preferred === 'string' ? preferred : Locale.EnglishUS) : null
    }
  }

  // A select menu's choices, as discord.js builds them from what Discord sends: none picked unless the test gives some,
  // and `values` the ids of those it gives, as Discord sends them
  const choices = SELECT_MENU_CHOICES.find(([Menu]) => Menu.prototype.isPrototypeOf(instance))?.[1]
  if (choices) {
    if (!Object.prototype.hasOwnProperty.call(instance, 'values')) {
      // A member is keyed by its user's id, so a user given with its member counts once
      const ids = choices.flatMap(kind => (own(kind) instanceof Collection ? [...(own(kind) as Collection<string, unknown>).keys()] : []))
      instance.values = [...new Set(ids)]
    }
    for (const kind of choices) if (!Object.prototype.hasOwnProperty.call(instance, kind)) instance[kind] = new Collection()
  }

  // Options assigned after creation, directly or through Object.assign, belong to it as those given do
  return stubDeep(instance, stubs, (prop, value) => {
    if (prop === 'options') ownOptions(instance, value)
  }) as DeepMocked<T>
}

// ---------------------------------------------------------------------------
// createMock — class-free mock for services and interfaces
// ---------------------------------------------------------------------------

/**
 * A mock function that answers property access with another one, so `cache.store.flush()` works
 * on a double whose shape is an interface with nothing at runtime to read it from.
 */
function stubCallable(member?: string): Mock {
  const fn = createMockFn()
  // jest's mock reads `_protoImpl` from itself whenever it's called, so the prototype below must not answer it
  if (usesRunnerMockFn()) Object.defineProperty(fn, '_protoImpl', { value: undefined, writable: true, enumerable: false, configurable: true })
  // Any property beyond the mock's own API is a nested mock, made on first read and kept on the function, out of its
  // keys. Its prototype makes them rather than a Proxy around it, so it stays the plain mock function matchers read
  const inherited = Object.getPrototypeOf(fn) as object
  Object.setPrototypeOf(
    fn,
    new Proxy(inherited, {
      get(proto, prop, receiver: object) {
        if (typeof prop === 'symbol' || prop in proto) return Reflect.get(proto, prop, receiver)
        // Never thenable — otherwise awaiting a mock hangs on itself
        if (prop === 'then') return undefined
        // jest's matchers take a function whose `calls` has `all` and `count` for a jasmine spy, read before `mock.calls`
        if (member === 'calls' && (prop === 'all' || prop === 'count')) return undefined
        const nested = stubCallable(prop)
        Object.defineProperty(receiver, prop, { value: nested, writable: true, enumerable: false, configurable: true })
        return nested
      },
    }),
  )
  return fn
}

/**
 * Creates a mock of any type, with no class needed, for service doubles and interfaces.
 *
 * Use it for a provider a testing module injects in place of the real one, or for a discord.js type the other
 * factories do not build. For a discord.js class, {@link createMockInteraction} keeps its prototype.
 *
 * @param props - Values the mock returns as given, such as the data the code reads; see {@link MockProps}.
 *
 * @remarks
 * Every property is a mock function created on first access, and the result is assignable to `T`. Values passed as
 * `props` are used as given rather than wrapped in mock functions.
 *
 * A type has no runtime shape, so a property `T` declares as data is a mock function too, and truthy:
 * `if (settings.enabled)` always passes and `settings.limit > 0` never does. Pass each value the code reads, such as
 * `createMock<Settings>({ enabled: false, limit: 3 })`.
 *
 * @example
 * ```ts
 * import { expect } from 'vitest'
 *
 * interface Mailer {
 *   send(to: string, text: string): Promise<boolean>
 * }
 * const mailer = createMock<Mailer>()
 * mailer.send.mockResolvedValue(true)
 *
 * await mailer.send('ada', 'Welcome!')
 * expect(mailer.send).toHaveBeenCalledWith('ada', 'Welcome!')
 * ```
 *
 * @group Testing
 * @category Mocks
 * @see {@link TestingModuleBuilder}
 */
export function createMock<T extends object>(props?: MockProps<T>): DeepMocked<T> {
  const target: Record<string, unknown> = {}

  if (props !== undefined) {
    for (const [key, value] of Object.entries(props)) {
      Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true })
    }
  }

  const stubs = new Map<string, Mock>()

  return new Proxy(target, {
    get(instance, prop) {
      if (typeof prop === 'symbol') return Reflect.get(instance, prop, instance)

      const key = prop as string

      if (key === 'then') return undefined

      // An explicitly supplied prop wins over the auto-stub.
      if (Object.prototype.hasOwnProperty.call(instance, key)) return Reflect.get(instance, prop, instance)

      // The double itself is no function a matcher reads, so a `calls` member here keeps its `all` and `count`
      if (!stubs.has(key)) stubs.set(key, stubCallable())
      return stubs.get(key) as Mock
    },

    set(instance, prop, value) {
      Object.defineProperty(instance, prop, { value, writable: true, enumerable: true, configurable: true })
      return true
    },
  }) as unknown as DeepMocked<T>
}

// ---------------------------------------------------------------------------
// Convenience wrappers for common discord.js classes
// ---------------------------------------------------------------------------

/**
 * Creates a mock {@link User}: a person, not a bot, with an id of its own.
 *
 * Use it for the user a command acts on, such as a user option's value, or a message's author.
 *
 * @param props - Values for the user's properties, such as `{ bot: true }` for a bot; see {@link MockProps}.
 *
 * @example
 * ```ts
 * import { expect } from 'vitest'
 *
 * const target = createMockUser()
 * const interaction = createMockInteraction(ChatInputCommandInteraction, {
 *   commandName: 'profile',
 *   options: createChatInputOptions({ target }),
 * })
 * expect(interaction.options.getUser('target')).toBe(target)
 * ```
 *
 * @group Testing
 * @category Mocks
 * @see {@link createMockInteraction}
 */
export function createMockUser(props: MockProps<User> = {}): DeepMocked<User> {
  const generatedId = props.id === undefined ? nextSnowflake() : undefined
  const user = createMockInteraction(User, { id: generatedId, bot: false, ...props })
  defineMadeTime(user, generatedId)
  return user
}

/**
 * Creates a mock {@link Client}, with `users`, `channels`, `guilds` and `application.commands` ready to stub.
 *
 * Use it when code under test reaches the client, such as to DM a user or fetch a channel, or to address messages to
 * the bot. A mock message or interaction built without one gets a client of its own.
 *
 * @remarks
 * Its managers' methods resolve as discord.js's do: `users.send()` to a mock message, `users.fetch(id)` and
 * `channels.fetch(id)` to the cached user or channel with that id, or a new one with it that they cache, and a list
 * fetch to an empty collection. `users.cache` and
 * `channels.cache` are real, empty collections. Every mock client is logged in as the same bot, so `user.id` is the id
 * a message mentions to address it.
 *
 * @example
 * ```ts
 * import { expect } from 'vitest'
 *
 * const client = createMockClient()
 * const botId = client.user.id
 * const message = createMockMessage({ content: `<@${botId}> help`, client })
 * expect(message.mentions.users.has(botId)).toBe(true)
 * ```
 *
 * @group Testing
 * @category Mocks
 * @see {@link createMockMessage}
 */
export function createMockClient(): DeepMocked<Client<true>> {
  const instance = Object.create(Client.prototype) as Record<string, unknown>

  // Manager properties are constructor-assigned — pre-initialize as prototype-based
  // stubs so ALL manager methods (not just fetch) are auto-stubbed as a mock fn.
  const appInstance = Object.create(null) as Record<string, unknown>
  appInstance.commands = stubDeep(Object.create(ApplicationCommandManager.prototype))

  // Real caches, empty until something is put in them, as a client that has just logged in
  instance.users = managerWith(UserManager.prototype, undefined)
  instance.channels = managerWith(ChannelManager.prototype, undefined)
  instance.guilds = managerWith(GuildManager.prototype, undefined)
  instance.user = stubDeep(Object.assign(Object.create(ClientUser.prototype), { id: MOCK_BOT_ID, bot: true }))
  instance.application = stubDeep(appInstance)

  // Discord's CDN routes, which avatar and icon URLs are built from; nothing is requested
  instance.rest = stubDeep(Object.assign(Object.create(null) as object, { cdn: new CDN() }))
  // A client a test is given is a logged-in one
  instance.isReady = createMockFn(() => true)

  const client = stubDeep(instance) as DeepMocked<Client<true>>
  for (const key of ['users', 'channels', 'guilds']) (instance[key] as Record<string, unknown>).client = client
  Object.defineProperty(instance.user, 'client', { value: client, writable: true, configurable: true })
  return client
}

/**
 * What {@link createMockGuild} puts in the guild's caches, as the gateway would have filled them.
 *
 * @group Testing
 * @category Mocks
 */
export interface MockGuildOverrides {
  /** The guild's id. */
  id?: string
  /** The guild's name, `'Guild'` unless given. */
  name?: string
  /** The language the guild's community set, `'en-US'` unless given; `t.forGuild()` reads it. */
  preferredLocale?: Locale
  /** Members in `members.cache`, by their id. */
  members?: readonly GuildMember[]
  /** Roles in `roles.cache`, by their id. */
  roles?: readonly Role[]
  /** Channels in `channels.cache`, by their id. */
  channels?: readonly GuildBasedChannel[]
}

// What each manager holds, which discord.js's resolve() checks an item against
const HOLDS: readonly (readonly [object, object])[] = [
  [GuildMemberManager.prototype, GuildMember],
  [RoleManager.prototype, Role],
  [GuildChannelManager.prototype, GuildChannel],
  [UserManager.prototype, User],
  [ChannelManager.prototype, BaseChannel],
  [GuildManager.prototype, Guild],
  [GuildBanManager.prototype, GuildBan],
  [ThreadMemberManager.prototype, ThreadMember],
  [GuildMessageManager.prototype, Message],
  [DMMessageManager.prototype, Message],
  [GuildTextThreadManager.prototype, ThreadChannel],
  [GuildForumThreadManager.prototype, ThreadChannel],
  [PermissionOverwriteManager.prototype, PermissionOverwrites],
  [ReactionManager.prototype, MessageReaction],
  [ReactionUserManager.prototype, User],
  [PresenceManager.prototype, Presence],
]

/**
 * A manager whose `cache` is a real collection of `items`, by id, empty without them, and whose methods are stubs but
 * for `resolve` and `resolveId`, which read the cache. Its `client` is the one its guild or channel has.
 */
function managerWith(prototype: object, items: readonly { id: string; user?: { id: string } }[] | undefined): object {
  const manager = Object.create(prototype) as Record<string, unknown>
  const cache = new Collection((items ?? []).map(item => [String(item.id ?? item.user?.id), item]))
  Object.defineProperty(manager, 'cache', { value: cache, writable: true })
  // The same collection where discord.js's own methods read it past a subclass's `cache`, as `super.cache` does
  Object.defineProperty(manager, '_cache', { value: cache, writable: true })
  const holds = HOLDS.find(([Manager]) => Manager === prototype || Object.prototype.isPrototypeOf.call(Manager, prototype))?.[1]
  if (holds) Object.defineProperty(manager, 'holds', { value: holds })
  let own: unknown
  Object.defineProperty(manager, 'client', {
    get: () => {
      const owner = manager.guild ?? manager.channel ?? manager.thread ?? manager.message
      return owner instanceof Base ? owner.client : (own ??= createMockClient())
    },
    set: (value: unknown) => (own = value),
    configurable: true,
  })
  return stubDeep(manager)
}

/** An empty manager of `prototype` that `owner` names its own, such as `{ message }` for a message's reactions. */
export function ownedManager(prototype: object, owner: Record<string, object>): never {
  const manager = managerWith(prototype, undefined)
  Object.assign(manager, owner)
  return manager as never
}

/**
 * Creates a mock {@link Guild}, with the `members`, `channels`, `roles` and `bans` managers ready to stub.
 *
 * Use it for the server a message or an interaction came from, with the members, roles and channels a handler looks
 * up in it.
 *
 * @param overrides - The guild's id, name and preferred locale, and the members, roles and channels in its caches; see
 *   {@link MockGuildOverrides}.
 *
 * @remarks
 * A manager's `fetch(id)` resolves to its cached item with that id, as discord.js looks there first, or to a new one it
 * caches under that id: a member or channel in this guild, a role with that id, or a ban. `members.fetch({ user: ids })`
 * resolves to a collection of each of those members, found or made the same way; `create()` and `edit()` resolve to a
 * mock of its item, and a list fetch to an empty collection. Members, roles and channels given are put in
 * their managers' caches, where dispatch looks first when it resolves a message's typed params; a member
 * {@link createMockMember} made without a server is in this one. Its `roles.everyone` is the role given with the
 * guild's id, or else an @everyone role of its own at position 0 with no permissions, in `roles.cache` as Discord has
 * it. The guild is named `'Guild'` and its `preferredLocale` is `'en-US'` unless given, so `t.forGuild(guild)`
 * translates as for a new English server.
 *
 * The mock makes a member for any id it's asked for, so a test of an id that isn't a member rejects the fetch, as
 * `guild.members.fetch.mockRejectedValue(createDiscordError(10007))`, or resolves a collection without that member.
 *
 * @example
 * ```ts
 * const target = createMock<GuildMember>({ id: '111111111111111111' })
 * const guild = createMockGuild({ members: [target] })
 * const message = createMockMessage({ content: '!ban 111111111111111111 spam', guild })
 * ```
 *
 * @group Testing
 * @category Mocks
 * @see {@link MockGuildOverrides}
 * @see {@link createMockMessage}
 */
export function createMockGuild(overrides: MockGuildOverrides = {}): DeepMocked<Guild> {
  const instance = Object.create(Guild.prototype) as Record<string, unknown>
  const generatedId = overrides.id === undefined ? nextSnowflake() : undefined
  instance.id = overrides.id ?? generatedId
  defineMadeTime(instance, generatedId)

  if (overrides.name !== undefined) instance.name = overrides.name
  if (overrides.preferredLocale !== undefined) instance.preferredLocale = overrides.preferredLocale
  instance.members = managerWith(GuildMemberManager.prototype, overrides.members as never)
  instance.channels = managerWith(GuildChannelManager.prototype, overrides.channels as never)
  instance.roles = guildRoleManager(instance.id as string, overrides.roles)
  instance.bans = managerWith(GuildBanManager.prototype, undefined)

  const guild = stubDeep(instance) as DeepMocked<Guild>
  settleGuild(instance, guild)
  // A member made without a server of its own is in this one
  for (const member of overrides.members ?? []) {
    if (!unhomedMembers.delete(member)) continue
    ;(member as unknown as Record<string, unknown>).guild = guild
  }
  return guild
}

// The type discord.js gives a channel of this class: a thread is a public or a private one, never the base class
type ChannelOf<T> = T extends ThreadChannel ? AnyThreadChannel : T

/**
 * Creates a mock channel of the given class, such as `TextChannel`, `ThreadChannel` or `DMChannel`.
 *
 * Use it for a channel a handler reads or posts to, such as one it fetches messages from or opens a thread in.
 *
 * @remarks
 * The managers the class has are ready to stub: `messages`, `threads` on text, announcement, forum and media channels,
 * and `members` on threads, each with a real, empty `cache` and the channel as its `channel`, or `thread`. A subclass gets the managers of the class it extends.
 * Type guards such as `isTextBased()`, `isDMBased()` and `isThread()` run discord.js's own logic, so each answers what
 * the channel is. A thread is typed as discord.js types every thread it gives, a public or a private one, so it fits
 * an interaction's `channel`, a guild's channels and the `threadCreate` event.
 *
 * @param Class - The discord.js channel class to mock.
 * @param props - Values for the channel's properties, such as its `id`, `name` or `topic`; see {@link MockProps}.
 *
 * @example
 * ```ts
 * import { expect } from 'vitest'
 *
 * const thread = createMockChannel(ThreadChannel)
 * await thread.members.add('111111111111111111')
 * expect(thread.members.add).toHaveBeenCalledWith('111111111111111111')
 * ```
 *
 * @group Testing
 * @category Mocks
 * @see {@link createMockGuild}
 */
export function createMockChannel<T extends BaseChannel>(
  Class: InteractionClass<T>,
  props: MockProps<T> = {},
): DeepMocked<ChannelOf<T>> {
  const instance = Object.create(Class.prototype) as Record<string, unknown>
  const generatedId = props.id === undefined ? nextSnowflake() : undefined
  instance.id = generatedId
  const is = (Base: { prototype: object }) => Base.prototype.isPrototypeOf(Class.prototype) || Class === Base

  // Text and announcement channels: messages, and threads made in the channel
  if (is(TextChannel) || is(NewsChannel)) {
    instance.messages = managerWith(GuildMessageManager.prototype, undefined)
    instance.threads = managerWith(GuildTextThreadManager.prototype, undefined)
  }
  // Forum and media channels hold posts, each a thread started with its first message
  if (is(ForumChannel) || is(MediaChannel)) {
    instance.threads = managerWith(GuildForumThreadManager.prototype, undefined)
    instance.availableTags = []
  }
  // Voice and stage channels carry a text chat of their own, and a bitrate, which discord.js tells them apart by
  if (is(BaseGuildVoiceChannel)) {
    instance.messages = managerWith(GuildMessageManager.prototype, undefined)
    instance.bitrate = 64_000
    instance.userLimit = 0
  }
  if (is(DMChannel)) {
    instance.messages = managerWith(DMMessageManager.prototype, undefined)
  }
  if (is(ThreadChannel)) {
    instance.messages = managerWith(GuildMessageManager.prototype, undefined)
    instance.members = managerWith(ThreadMemberManager.prototype, undefined)
  }
  // A server's channel has its overwrites, none until a test puts some in the cache, which its permissions read
  if (is(GuildChannel) && !is(ThreadChannel)) instance.permissionOverwrites = managerWith(PermissionOverwriteManager.prototype, undefined)
  Object.assign(instance, props)
  defineMadeTime(instance, generatedId)

  const stubs = new Map<string, StubValue>()
  const channel = stubDeep(instance, stubs)
  // Each manager knows its channel, as discord.js's do, and a thread's members their thread
  for (const key of ['messages', 'threads', 'permissionOverwrites']) if (instance[key]) (instance[key] as Record<string, unknown>).channel = channel
  if (is(ThreadChannel) && instance.members) (instance.members as Record<string, unknown>).thread = channel
  // Type guards run discord.js's own logic, which reads the channel's type and the managers it has
  for (const name of CHANNEL_TYPE_GUARDS) {
    const method = findPrototypeMethod(instance, name)
    if (method !== null) stubs.set(name, createMockFn(() => method.call(channel)))
  }
  return channel as DeepMocked<ChannelOf<T>>
}

const CHANNEL_TYPE_GUARDS = ['isThread', 'isTextBased', 'isDMBased', 'isVoiceBased', 'isThreadOnly', 'isSendable'] as const

/** A member of `guild` as the user with `id`: its id, user and guild own values, as the gateway delivers a member. */
function memberIn(guild: unknown, id: string, user: unknown, guildId?: string): object {
  // The guild stays writable, for the guild createMockGuild puts the member in
  const own = { id: { value: id }, user: { value: user }, ...(guild ? { guild: { value: guild, writable: true, configurable: true } } : {}) }
  const member = Object.defineProperties(Object.create(GuildMember.prototype), own) as object
  // A server the mock has only the id of, as one the bot isn't in
  if (!guild && guildId) Object.defineProperty(member, RAW_GUILD_ID, { value: guildId })
  return stubDeep(member)
}

/** The id of the server a member without a mock guild is in, read for its @everyone role. */
const RAW_GUILD_ID = Symbol('raw guild id')

/**
 * The member a server has for `user`. A user the test gave is looked up in the guild's member cache, and cached
 * there when missing, as the gateway resolves a member, so every mock from that user in that server shares it.
 */
function memberFor(guild: unknown, user: { id: string }, given: boolean, guildId?: string): object {
  const make = () => memberIn(guild, user.id, user, guildId)
  return given ? cached(cacheOf((guild as Guild | null | undefined)?.members), user.id, make) : make()
}

/** Whether `a` ranks above `b`: the higher position, or at one position the lower id, as discord.js compares roles. */
const ranksAbove = (a: Role, b: Role): boolean =>
  a.position !== b.position ? a.position > b.position : isSnowflake(a.id) && isSnowflake(b.id) ? BigInt(a.id) < BigInt(b.id) : a.id < b.id

/**
 * A member's role manager. Its `cache` is read live, as discord.js reads it: the server's @everyone role, then `roles`;
 * `add`, `remove` and `set` change `roles` and resolve to the member, and `highest` is the role that ranks highest.
 */
export function memberRoles(member: object, roles: readonly Role[]): GuildMemberRoleManager {
  const own = new Collection<string, Role>(roles.map(role => [role.id, role]))
  const guildRoles = () => (member as GuildMember).guild?.roles
  // A server the mock has only the id of still has its @everyone role, made once
  let rawEveryone: Role | undefined
  const everyone = (): Role | undefined => {
    const fromGuild: unknown = guildRoles()?.everyone
    if (fromGuild instanceof Role) return fromGuild
    const rawGuildId = (member as Record<symbol, string | undefined>)[RAW_GUILD_ID]
    return rawGuildId ? (rawEveryone ??= everyoneRole(rawGuildId)) : undefined
  }
  const cache = (): Collection<string, Role> => {
    const first = everyone()
    return first ? new Collection([[first.id, first], ...own]) : own.clone()
  }
  const highest = (): Role | undefined => {
    let top: Role | undefined
    for (const role of cache().values()) if (!top || ranksAbove(role, top)) top = role
    return top
  }
  // A role given by id is the guild's role with that id, when its cache has one
  const resolve = (value: unknown): Role[] =>
    (Array.isArray(value) || value instanceof Collection ? [...value.values()] : [value]).map(entry =>
      typeof entry === 'string'
        ? ((cacheOf(guildRoles())?.get(entry) as Role | undefined) ?? (createMockInteraction(Role, { id: entry }) as Role))
        : (entry as Role),
    )
  const manager = Object.create(GuildMemberRoleManager.prototype) as Record<string, unknown>
  Object.defineProperties(manager, {
    cache: { get: cache },
    member: { value: member },
    highest: { get: highest },
  })
  manager.add = createMockFn(async (value: unknown) => {
    for (const role of resolve(value)) own.set(role.id, role)
    return member
  })
  manager.remove = createMockFn(async (value: unknown) => {
    for (const role of resolve(value)) own.delete(role.id)
    return member
  })
  manager.set = createMockFn(async (value: unknown) => {
    own.clear()
    for (const role of resolve(value)) own.set(role.id, role)
    return member
  })
  return stubDeep(manager) as GuildMemberRoleManager
}

/** The permissions Discord gives a server's @everyone role in a server made today. */
const NEW_SERVER_EVERYONE_PERMISSIONS = 2248473465835073n

// A server's @everyone role, which has the server's id and ranks lowest, at position 0; with strict mocks, the
// permissions Discord gives it in a new server
const everyoneRole = (guildId: string): Role =>
  createMockInteraction(Role, {
    id: guildId,
    name: '@everyone',
    position: 0,
    ...(strictMocks() ? { permissions: new PermissionsBitField(NEW_SERVER_EVERYONE_PERMISSIONS).freeze() } : {}),
  }) as Role

/**
 * A guild's role manager with `roles` in its cache, and the guild's @everyone role: the one given with the guild's id,
 * or a role of its own at position 0, as every server has one.
 */
function guildRoleManager(guildId: string, roles: readonly Role[] | undefined): object {
  const given = roles ?? []
  const own = given.find(role => role.id === guildId)
  // @everyone ranks lowest, below the roles a mock gets at position 1
  if (own && !Object.prototype.hasOwnProperty.call(own, 'position')) Object.defineProperty(own, 'position', { value: 0, writable: true, enumerable: true, configurable: true })
  const everyone = own ? [] : [everyoneRole(guildId)]
  const manager = managerWith(RoleManager.prototype, [...everyone, ...given] as never)
  Object.defineProperty(manager, 'everyone', { get: () => cacheOf(manager)?.get(guildId), configurable: true })
  return manager
}

/**
 * What {@link createMockRawMember} builds a member with: any field Discord sends, with `permissions` as a permission
 * set and `user` as the fields of the user given.
 *
 * @group Testing
 * @category Mocks
 */
export type MockRawMemberOverrides = Partial<Omit<APIInteractionGuildMember, 'permissions' | 'user'>> & {
  /** The member's permissions in the channel; unless given, what @everyone has in a server Discord makes today. */
  permissions?: PermissionResolvable
  /** The member's user; a new person, `username` `'user'`, unless given. */
  user?: Partial<APIUser>
}

/**
 * Creates the member Discord sends with an interaction from a server the bot isn't in, as discord.js keeps it.
 *
 * Give it as an interaction's `member`, with the server's `guildId` and no `guild`, to test a user-installed command
 * run there: the interaction reads `inRawGuild()` true, `guild` and `channel` null, `user` the member's user and
 * `memberPermissions` the member's, and a user option's member is the plain member Discord resolves too.
 *
 * @remarks
 * It is plain data, not a `GuildMember`: `roles` are role ids, `permissions` is the permission bitfield as a string,
 * and the rest are as Discord sends them, `null` for what may be absent and `false` for a flag. Code that reads
 * `member.roles.cache` throws on it, as it does in Discord.
 *
 * @param overrides - Fields for the member; see {@link MockRawMemberOverrides}.
 * @returns The member, as an `APIInteractionGuildMember`.
 *
 * @example
 * ```ts
 * import { expect } from 'vitest'
 *
 * const member = createMockRawMember({ roles: ['300000000000000001'], permissions: [PermissionFlagsBits.SendMessages] })
 * const command = createMockInteraction(ChatInputCommandInteraction, { guildId: '100000000000000001', member })
 * expect(command.inRawGuild()).toBe(true)
 * ```
 *
 * @group Testing
 * @category Mocks
 * @see {@link createMockMember}
 */
export function createMockRawMember(overrides: MockRawMemberOverrides = {}): APIInteractionGuildMember {
  const { permissions, user, ...given } = overrides
  return {
    user: { id: nextSnowflake(), username: 'user', discriminator: '0', global_name: null, avatar: null, ...user },
    roles: [],
    nick: null,
    avatar: null,
    banner: null,
    premium_since: null,
    communication_disabled_until: null,
    joined_at: new Date().toISOString(),
    deaf: false,
    mute: false,
    pending: false,
    flags: 0 as GuildMemberFlags,
    ...given,
    permissions: String(new PermissionsBitField(permissions ?? NEW_SERVER_EVERYONE_PERMISSIONS).bitfield),
  }
}

/** Whether `value` is a member Discord sends from a server the bot isn't in: plain data, not a `GuildMember`. */
export function isRawMember(value: unknown): value is APIInteractionGuildMember {
  if (typeof value !== 'object' || value === null || value instanceof GuildMember) return false
  const { roles, permissions, user } = value as Partial<APIInteractionGuildMember>
  return Array.isArray(roles) && typeof permissions === 'string' && typeof user === 'object' && user !== null
}

/** A user option's member as Discord resolves it with an interaction from a server the bot isn't in. */
function rawResolvedMember(): APIInteractionDataResolvedGuildMember {
  const { user: _user, deaf: _deaf, mute: _mute, ...resolved } = createMockRawMember()
  return resolved
}

/**
 * What {@link createMockMember} builds a member with.
 *
 * @group Testing
 * @category Mocks
 */
export interface MockMemberOverrides {
  /** The member's user, a new person unless given. */
  user?: User
  /**
   * The server the member is in. Unless given, the guild whose `createMockGuild({ members })` it is given to, or a new
   * mock guild.
   */
  guild?: Guild
  /** The member's roles, in `roles.cache` after @everyone; its `permissions` are theirs and @everyone's combined. */
  roles?: readonly Role[]
  /** The member's nickname in the server, `null` unless given. */
  nickname?: string | null
}

/**
 * Creates a mock {@link GuildMember}: a user in a server, with the roles given.
 *
 * Use it for a member whose roles or permissions a guard or a handler checks, or one a command acts on.
 *
 * @remarks
 * `roles.cache` holds the server's @everyone role, then the roles given, as discord.js reads it; `roles.add()`,
 * `remove()` and `set()` change the roles given and resolve to the member, and `roles.highest` is the role that ranks
 * highest, by position, then the lower id. `permissions` are computed as discord.js computes them: every permission for
 * the server's owner, and otherwise its roles' permissions combined, @everyone's included, so a member with no roles has
 * @everyone's alone. The member is put in its guild's member cache, so an interaction or a message from its user in that
 * server has it as its `member`, and `memberPermissions` are its permissions. A DM sent to the member goes through its
 * user's `send()` and the user's one DM channel.
 *
 * @param overrides - The member's user, server, roles and nickname; see {@link MockMemberOverrides}.
 * @returns The mock member.
 *
 * @example
 * ```ts
 * import { expect } from 'vitest'
 *
 * const moderator = createMockInteraction(Role, { permissions: new PermissionsBitField([PermissionFlagsBits.KickMembers]) })
 * const user = createMockUser()
 * const guild = createMockGuild({ members: [createMockMember({ user, roles: [moderator] })] })
 * const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName: 'kick', user, guildId: guild.id, guild })
 *
 * expect(interaction.memberPermissions?.has(PermissionFlagsBits.KickMembers)).toBe(true)
 * ```
 *
 * @group Testing
 * @category Mocks
 * @see {@link MockMemberOverrides}
 * @see {@link createMockGuild}
 */
export function createMockMember(overrides: MockMemberOverrides = {}): DeepMocked<GuildMember> {
  const { user = createMockUser(), guild = createMockGuild(), roles = [], nickname } = overrides
  const member = memberIn(guild, user.id, user) as Record<string, unknown>
  member.roles = memberRoles(member, roles)
  if (nickname !== undefined) member.nickname = nickname
  cacheOf(guild.members)?.set(user.id, member)
  if (!overrides.guild) unhomedMembers.add(member)
  return member as unknown as DeepMocked<GuildMember>
}

/** Members createMockMember made without a server given, until createMockGuild puts them in one. */
const unhomedMembers = new WeakSet<object>()

/**
 * The channel an interaction or a message in `guild` came from: the guild's channel with that id, or a text channel
 * made and cached there, as the gateway caches it. With only a guild id, a server the bot isn't in, a text channel of
 * that id; with neither, the user's DM channel.
 */
function channelFor(guild: unknown, guildId: string | null, channelId: string, user: object): object {
  if (!guildId) return dmChannelOf(user)
  const make = () => createMockChannel(TextChannel, (guild ? { id: channelId, guild } : { id: channelId, guildId }) as MockProps<TextChannel>)
  return guild ? cached(cacheOf((guild as Guild).channels), channelId, make) : make()
}

/** Where a mock made in a given channel is: the channel's id, and its server, or `null` for a DM; unknown if left out. */
interface ChannelPlace {
  channelId: string
  guildId?: string | null
  guild?: Guild | null
}

/** A server's id as a refusal names it, or a DM. */
const placeName = (guildId: string | null) => (guildId === null ? 'a DM' : `server ${guildId}`)

/**
 * Where a channel a test gives puts the mock made in it, read from the channel as discord.js reads it: no server for a
 * DM channel, else the server the channel names. A server channel that names none is put in `fallback`'s, and named
 * it, so the two agree from then on. Any other object, such as one from `createMock`, gives only its id.
 *
 * @throws When the channel is in another server than the one `given`, or a DM, as a test that says both means one.
 */
function placeOf(channel: object, given: string | null | undefined, fallback: () => { guildId: string; guild: Guild | null }): ChannelPlace {
  const channelId = (channel as { id: string }).id
  if (!(channel instanceof BaseChannel)) return { channelId }
  const own = (key: string) => (Object.prototype.hasOwnProperty.call(channel, key) ? (channel as unknown as Record<string, unknown>)[key] : undefined)
  const guild = channel.isDMBased() ? null : own('guild') instanceof Guild ? (own('guild') as Guild) : null
  const guildId = channel.isDMBased() ? null : typeof own('guildId') === 'string' ? (own('guildId') as string) : guild?.id
  if (guildId !== undefined && given !== undefined && guildId !== given) {
    throw new Error(`The channel given is in ${placeName(guildId)}, but the mock's guild is ${placeName(given)}: give a channel of that server, or leave one of them out.`)
  }
  if (guildId !== undefined) return { channelId, guildId, guild }
  if (given === null) throw new Error("The channel given is a server's channel, but the mock is a DM: give a DM channel, or leave one of them out.")
  const place = fallback()
  Object.assign(channel, { guildId: place.guildId, ...(place.guild ? { guild: place.guild } : {}) })
  return { channelId, ...place }
}

/** Puts a mock's channel where the gateway caches a channel: in its server's cache, and the client's. */
function cacheChannel(channel: object, guild: unknown, client: unknown): void {
  const { id } = channel as { id: string }
  for (const manager of [(guild as { channels?: unknown } | null | undefined)?.channels, (client as { channels?: unknown } | null | undefined)?.channels]) {
    cached(cacheOf(manager), id, () => channel)
  }
}

/** The guild a mock message carries: a guild with the same stubbed managers as createMockGuild. */
function createMockGuildForMessage(id?: string): object {
  const guild = Object.create(Guild.prototype) as Record<string, unknown>
  const generatedId = id === undefined ? nextSnowflake() : undefined
  guild.id = id ?? generatedId
  defineMadeTime(guild, generatedId)
  guild.members = managerWith(GuildMemberManager.prototype, undefined)
  guild.channels = managerWith(GuildChannelManager.prototype, undefined)
  guild.roles = guildRoleManager(guild.id as string, undefined)
  guild.bans = managerWith(GuildBanManager.prototype, undefined)
  const proxy = stubDeep(guild)
  settleGuild(guild, proxy)
  return proxy
}

/** Gives a guild's managers the guild, as discord.js's do, so what they fetch or make is in it. */
function homeManagers(instance: Record<string, unknown>, guild: object): void {
  for (const key of ['members', 'channels', 'roles', 'bans']) (instance[key] as Record<string, unknown>).guild = guild
}

/**
 * Makes `guild` whole, as discord.js's guilds are: its managers and the roles and channels in its caches belong to it,
 * it has a client of its own until one is given, and `members.me` is the bot's member, the cached one or one with
 * @everyone, made and cached once on first read.
 */
function settleGuild(instance: Record<string, unknown>, guild: object): void {
  homeManagers(instance, guild)
  let client: unknown
  Object.defineProperty(instance, 'client', { get: () => (client ??= createMockClient()), set: value => (client = value), configurable: true })
  const members = instance.members as object
  Object.defineProperty(members, 'me', {
    get: () => {
      const { user } = (guild as Guild).client
      return cached(cacheOf(members), user.id, () => memberIn(guild, user.id, user))
    },
    configurable: true,
  })
  for (const key of ['roles', 'channels']) {
    for (const item of cacheOf(instance[key])?.values() ?? []) {
      if (!Object.prototype.hasOwnProperty.call(item, 'guild')) (item as Record<string, unknown>).guild = guild
    }
  }
  // Strict mocks cache the bot's member from the start, as the gateway does when the bot joins, so lookups find it
  if (strictMocks()) void (members as { me: unknown }).me
}

/**
 * What {@link createMockMessage} builds a message with.
 *
 * Components and embeds may be API JSON, builders or discord.js instances.
 *
 * @group Testing
 * @category Mocks
 */
export interface MockMessageOverrides {
  /** The message's id. */
  id?: string
  /** The message's text. */
  content?: string
  /**
   * Who sent it, such as a user from `createMockUser`, or the client's own user for a message the bot sent; a new
   * person otherwise. Two messages from one author count as one user's, such as for a per-user cooldown. It is cached
   * on the message's client, and in a server its `member` is the guild's cached member for that user, or a new one.
   */
  author?: User
  /**
   * Its top-level components: action rows, or Components V2 such as a container. Builders or API JSON, held as
   * discord.js's classes, such as `ActionRow` and `ButtonComponent`, built from their JSON at the time of the call.
   */
  components?: readonly (APIMessageTopLevelComponent | JSONEncodable<APIMessageTopLevelComponent>)[]
  /** Its embeds, builders or API JSON, held as discord.js's `Embed` built from their JSON at the time of the call. */
  embeds?: readonly (APIEmbed | JSONEncodable<APIEmbed>)[]
  /** Its flags: a number, flag names or a `MessageFlagsBitField`. */
  flags?: MessageFlagsResolvable
  /** The guild it was sent in, such as one from `createMockGuild` with members in its cache; `null` for a DM. */
  guild?: Guild | null
  /**
   * The channel it was sent in, such as one from `createMockChannel`. Unless given, a text channel of its guild, cached
   * there, or the author's DM channel for a DM. A channel given sets the message's guild, unless `guild` is given too:
   * none for a DM channel, so `inGuild()` is `false`, and the channel's own server for a server's channel. One in another
   * server than the `guild` given is refused, naming both. The channel is cached on the message's client, as the
   * gateway caches it.
   */
  channel?: TextBasedChannel | DeepMocked<BaseChannel>
  /** The client it arrived on, such as one from `createMockClient`; a new mock client otherwise. */
  client?: Client
  /** Users in the client's `users.cache`, by their id, beside those the content mentions. */
  users?: readonly User[]
  /** When it was last edited, in milliseconds since the epoch; `null`, the default, for a message never edited. */
  editedTimestamp?: number | null
}

/** The ids each kind of mention in `content` names, in order and once each. */
function mentionedIds(content: string | undefined): { users: string[]; roles: string[]; channels: string[] } {
  const ids = (pattern: RegExp) => [...new Set([...(content ?? '').matchAll(new RegExp(pattern.source, 'g'))].map(match => match.groups!.id))]
  return { users: ids(MessageMentions.UsersPattern), roles: ids(MessageMentions.RolesPattern), channels: ids(MessageMentions.ChannelsPattern) }
}

/** A cache's collection, or undefined for a stub a test put in place of the manager. */
const cacheOf = (manager: unknown): Collection<string, unknown> | undefined => {
  const cache = (manager as { cache?: unknown } | undefined)?.cache
  return cache instanceof Collection ? (cache as Collection<string, unknown>) : undefined
}

/** The cached item under `id`, put there by `make` when the cache lacks it. */
function cached<T>(cache: Collection<string, unknown> | undefined, id: string, make: () => T): T {
  const existing = cache?.get(id)
  if (existing !== undefined) return existing as T
  const item = make()
  cache?.set(id, item)
  return item
}

/**
 * The message's mentions, with the users, members, roles and channels its content mentions put in the
 * client's and the guild's caches, as the gateway delivers a message's mentions with it.
 */
function mentionsOf(content: string | undefined, client: unknown, guild: unknown): object {
  const { users, roles, channels } = mentionedIds(content)
  const guildCaches = guild
    ? { members: cacheOf((guild as Guild).members), roles: cacheOf((guild as Guild).roles), channels: cacheOf((guild as Guild).channels) }
    : undefined
  const userCache = cacheOf((client as Client).users)

  const mentioned = {
    users: new Collection(users.map(id => [id, cached(userCache, id, () => mockUser(id))])),
    members: guildCaches
      ? new Collection(
          users.map(id => [
            id,
            cached(guildCaches.members, id, () => memberIn(guild, id, cached(userCache, id, () => mockUser(id)))),
          ]),
        )
      : null,
    roles: new Collection(
      guildCaches ? roles.map(id => [id, cached(guildCaches.roles, id, () => stubDeep(Object.assign(Object.create(Role.prototype), { id, guild })))]) : [],
    ),
    channels: new Collection(
      channels.map(id => [
        id,
        cached(guildCaches ? guildCaches.channels : cacheOf((client as Client).channels), id, () =>
          stubDeep(Object.assign(Object.create(TextChannel.prototype), { id, guild })),
        ),
      ]),
    ),
  }
  // Own values, so the prototype's getters, which read the raw mention data, are not reached
  const instance = Object.create(MessageMentions.prototype) as object
  const parsedUsers = new Collection(mentioned.users)
  for (const [key, value] of Object.entries({ ...mentioned, parsedUsers, crosspostedChannels: new Collection(), everyone: false, client, guild: guild ?? null })) {
    Object.defineProperty(instance, key, { value, writable: true })
  }
  return stubDeep(instance)
}

/** A message as a mock interaction's reply methods hold it, in the shape Discord stores it. */
interface HeldMessage {
  id: string
  /** The components as the last edit's response had them; read back, they are `components`. */
  returned?: unknown[]
  /** Whether an edit has had Discord process the files uploaded with the message again, which only the first does. */
  reprocessed?: boolean
  content?: string
  components: unknown[]
  embeds: unknown[]
  flags?: MessageFlagsResolvable
  editedTimestamp: number | null
}

/** A value as its API JSON: a builder or discord.js structure through `toJSON()`, anything else as it is. */
const jsonOf = (value: unknown): unknown =>
  value && typeof (value as { toJSON?: unknown }).toJSON === 'function' ? (value as { toJSON: () => unknown }).toJSON() : value

/** The message a reply method starts from: the one a component is on, as it was, or an empty original response. */
function heldFrom(message: unknown): HeldMessage {
  // Read only what the message really has: a mock's unset fields are stubs
  const from = (message ?? {}) as Partial<Record<keyof Message, unknown>>
  return {
    id: typeof from.id === 'string' ? from.id : nextSnowflake(),
    content: typeof from.content === 'string' ? from.content : undefined,
    components: Array.isArray(from.components) ? from.components.map(jsonOf) : [],
    embeds: Array.isArray(from.embeds) ? from.embeds.map(jsonOf) : [],
    flags: from.flags instanceof MessageFlagsBitField ? from.flags : undefined,
    editedTimestamp: typeof from.editedTimestamp === 'number' ? from.editedTimestamp : null,
  }
}

/** A message as an answer sends it: a new one, with what the answer gave, never edited. */
const sent = (options: unknown): HeldMessage => ({ ...edited(heldFrom(undefined), options), editedTimestamp: null })

/** A held message after an edit: what the edit sets replaced in Discord's shape, and a later edit stamp. */
function edited(held: HeldMessage, options: unknown): HeldMessage {
  const edit = (typeof options === 'string' ? { content: options } : (options ?? {})) as {
    content?: string
    components?: unknown[]
    embeds?: unknown[]
    flags?: MessageFlagsResolvable
  }
  return {
    ...held,
    ...(edit.content !== undefined && { content: edit.content }),
    // The first edit that keeps a file uploaded with the message has Discord process it again: the response has it
    // loading, and it has loaded by the time the message is read back. Later edits find it processed.
    ...(edit.components !== undefined && {
      components: asDiscordStores(edit.components.map(jsonOf)),
      returned: asDiscordStores(edit.components.map(jsonOf), { loading: !held.reprocessed }),
      reprocessed: true,
    }),
    ...(edit.embeds !== undefined && { embeds: embedsAsDiscordStores(edit.embeds.map(jsonOf)) }),
    ...(edit.flags !== undefined && { flags: edit.flags }),
    // Later than the last edit, even within one millisecond or under fake timers
    editedTimestamp: Math.max(Date.now(), (held.editedTimestamp ?? 0) + 1),
  }
}

/** A mock message showing a held message. */
function messageFrom(held: HeldMessage): DeepMocked<Message> & { deleted: boolean } {
  return createMockMessage({
    id: held.id,
    ...(held.content !== undefined && { content: held.content }),
    components: held.components as APIMessageTopLevelComponent[],
    embeds: held.embeds as APIEmbed[],
    ...(held.flags !== undefined && { flags: held.flags }),
    editedTimestamp: held.editedTimestamp,
  })
}

/**
 * A component or embed as a message holds it: a discord.js instance as it is, anything else as the discord.js class
 * built from its API JSON at the time of the call, as discord.js builds it, an unknown type as a plain `Component`.
 */
function asHeld<T>(value: T | JSONEncodable<T>, kind: 'component' | 'embed'): JSONEncodable<T> {
  if (value instanceof Component || value instanceof Embed) return value as JSONEncodable<T>
  // A copy, since discord.js's classes keep what they are given, one level deep
  const json = structuredClone(jsonOf(value)) as { type?: number }
  if (kind === 'embed') return new (Embed as unknown as new (data: unknown) => Embed)(json) as unknown as JSONEncodable<T>
  // An action row builds each child with discord.js's own createComponent, which it doesn't export
  const row = new (ActionRow as unknown as new (data: unknown) => { components: Component[] })({ type: ComponentType.ActionRow, components: [json] })
  return row.components[0] as unknown as JSONEncodable<T>
}

/**
 * Creates a mock {@link Message} that tracks whether it has been deleted.
 *
 * Use it for the message a message command reads, or the message a button sits on. Its author is a person, so
 * `@MessageHandler` does not skip it.
 *
 * @remarks
 * `delete()`, `edit()`, `reply()`, `react()`, `pin()` and `unpin()` throw once the message is deleted, and `edit()`
 * and `reply()` resolve to a new mock message. Without overrides the message is empty, in a server, from a new
 * person who is its `member`; with `guild: null` it is a direct message. Give `author` to send several messages as
 * one user, such as to reach a per-user cooldown. An author given, and the users, roles and channels the content
 * mentions, are cached as the gateway delivers them. It is typed as discord.js emits a message, never in a group DM,
 * so it fits `messageCreate` and the other message events.
 *
 * @param overrides - The message's content, components and the rest; see {@link MockMessageOverrides}.
 *
 * @example
 * ```ts
 * import { expect } from 'vitest'
 *
 * const close = new ButtonBuilder().setCustomId('ticket/42/close').setLabel('Close').setStyle(ButtonStyle.Danger)
 * const message = createMockMessage({
 *   content: 'Ticket #42',
 *   components: [new ActionRowBuilder<ButtonBuilder>().addComponents(close)],
 * })
 * const click = createMockInteraction(ButtonInteraction, { customId: 'ticket/42/close', message })
 * await click.message.delete()
 * expect(message.deleted).toBe(true)
 * ```
 *
 * @group Testing
 * @category Mocks
 * @see {@link MockMessageOverrides}
 * @see {@link createMockGuild}
 */
export function createMockMessage(
  overrides: MockMessageOverrides = {},
): DeepMocked<Message> & OmitPartialGroupDMChannel<Message> & { deleted: boolean } {
  const instance = Object.create(Message.prototype) as Record<string, unknown>
  const stubs = new Map<string, Mock>()

  instance.deleted = false

  // Constructor-assigned — set as prototype-based stubs; a user rather than a bot, as dispatch handles only those
  instance.author = overrides.author ?? mockUser()

  // Getters on the prototype, which the proxy would answer with a stub object: own properties shadow them
  // A channel given says where the message was sent, unless its guild is given too
  const place = overrides.channel
    ? placeOf(overrides.channel, overrides.guild === undefined ? undefined : (overrides.guild?.id ?? null), () => {
        const guild = (overrides.guild ?? createMockGuildForMessage()) as Guild
        return { guildId: guild.id, guild }
      })
    : undefined
  const guild = (
    overrides.guild !== undefined
      ? overrides.guild
      : place?.guildId !== undefined
        ? place.guildId === null
          ? null
          : (place.guild ?? createMockGuildForMessage(place.guildId))
        : createMockGuildForMessage()
  ) as { id: string } | null
  const channel = (overrides.channel ?? channelFor(guild, guild?.id ?? null, nextSnowflake(), instance.author as object)) as { id: string }
  Object.defineProperty(instance, 'channel', { value: channel, writable: true })
  Object.defineProperty(instance, 'guild', { value: guild, writable: true })
  // The author as a member of the message's server; a direct message has none. A given author's member is the one
  // the server caches, as the gateway resolves it, so every message from that author has the same member
  // The author's member, cached as the gateway caches it with the message; `member` reads the cache, as discord.js does
  if (guild) memberFor(guild, instance.author as { id: string }, true)
  Object.defineProperty(instance, 'member', {
    get: () => (guild ? (guild as Guild).members.resolve(instance.author as User) : null),
    set: (value: unknown) => Object.defineProperty(instance, 'member', { value, writable: true, enumerable: true, configurable: true }),
    enumerable: true,
    configurable: true,
  })
  // In a server's text channel, the ids matching the objects; with no guild, a DM
  instance.channelId = channel.id
  instance.guildId = guild?.id ?? null
  // The thread its channel caches under its id, as discord.js reads it; until 5.0, a placeholder thread otherwise
  let placeholderThread: object | undefined
  Object.defineProperty(instance, 'thread', {
    get: () => {
      const found = cacheOf((instance.channel as { threads?: unknown }).threads)?.get(instance.id as string)
      if (found) return found
      if (strictMocks()) return null
      warnPlaceholder(
        mockLogger,
        'Message.thread',
        'it is null unless the channel caches a thread under the message id, as discord.js reads it',
        'Cache one with message.channel.threads.cache.set(message.id, thread), or call useStrictMocks() to have it read null now.',
      )
      return (placeholderThread ??= stubDeep(Object.create(ThreadChannel.prototype)))
    },
    set: (value: unknown) => Object.defineProperty(instance, 'thread', { value, writable: true, enumerable: true, configurable: true }),
    enumerable: true,
    configurable: true,
  })

  // Assigned once by discord.js's Base constructor, so an own value, as it is on a real message; a guild the message
  // made for itself has the same client, which caches the guild
  const client = overrides.client ?? createMockClient()
  if (guild && overrides.guild === undefined) (guild as Record<string, unknown>).client = client
  Object.defineProperty(instance, 'client', { value: client, writable: true, configurable: true })
  if (guild instanceof Guild) cached(cacheOf(client.guilds), guild.id, () => guild)
  cacheChannel(channel, guild, client)
  const userCache = cacheOf(client.users)
  for (const user of [...(overrides.users ?? []), instance.author as User]) userCache?.set(user.id, user)

  // MessageMentions — constructor-assigned; what the content mentions, cached as the gateway delivers it
  instance.mentions = mentionsOf(overrides.content, client, guild)

  // Data a message always has, real rather than stubbed, so code reading it sees an empty message
  instance.flags = new MessageFlagsBitField(overrides.flags)
  instance.components = (overrides.components ?? []).map(component => asHeld(component, 'component'))
  instance.embeds = (overrides.embeds ?? []).map(embed => asHeld(embed, 'embed'))
  instance.attachments = new Collection()
  instance.editedTimestamp = overrides.editedTimestamp ?? null
  const generatedId = overrides.id === undefined ? nextSnowflake() : undefined
  instance.id = overrides.id ?? generatedId
  defineCreatedTime(instance, generatedId)
  if (overrides.content !== undefined) instance.content = overrides.content

  const alreadyDeleted = () => new Error('This message has already been deleted.')

  stubs.set(
    'inGuild',
    createMockFn(() => Boolean(instance.guildId)),
  )
  stubs.set(
    'delete',
    createMockFn(async () => {
      if (instance.deleted) throw alreadyDeleted()
      instance.deleted = true
    }),
  )
  stubs.set(
    'edit',
    createMockFn(async () => {
      if (instance.deleted) throw alreadyDeleted()
      return createMockMessage()
    }),
  )
  stubs.set(
    'reply',
    createMockFn(async () => {
      if (instance.deleted) throw alreadyDeleted()
      return createMockMessage()
    }),
  )
  stubs.set(
    'react',
    createMockFn(async () => {
      if (instance.deleted) throw alreadyDeleted()
    }),
  )
  stubs.set(
    'pin',
    createMockFn(async () => {
      if (instance.deleted) throw alreadyDeleted()
    }),
  )
  stubs.set(
    'unpin',
    createMockFn(async () => {
      if (instance.deleted) throw alreadyDeleted()
    }),
  )

  return stubDeep(instance, stubs) as DeepMocked<Message> & OmitPartialGroupDMChannel<Message> & { deleted: boolean }
}

// ---------------------------------------------------------------------------
// createChatInputOptions — typed options resolver for ChatInputCommandInteraction
// ---------------------------------------------------------------------------

/**
 * The options of a mock slash command, as {@link createChatInputOptions} takes them: each value by its option's name.
 *
 * A value is a string, a number or a boolean, or a user, member, role, channel or attachment for an entity option.
 *
 * @group Testing
 * @category Mocks
 */
export interface ChatInputOptions {
  /** The subcommand group the command was used through. */
  subcommandGroup?: string | null
  /** The subcommand the command was used through. */
  subcommand?: string | null
  /** The option the user is currently typing, for autocomplete interactions. */
  focused?: string | null
  [name: string]: string | number | boolean | { id: string } | null | undefined
}

/** The option type Discord would have sent for a given JavaScript value. */
function optionTypeOf(value: unknown): ApplicationCommandOptionType {
  if (typeof value === 'boolean') return ApplicationCommandOptionType.Boolean
  if (typeof value === 'number') return Number.isInteger(value) ? ApplicationCommandOptionType.Integer : ApplicationCommandOptionType.Number
  if (value instanceof User) return ApplicationCommandOptionType.User
  if (value instanceof GuildMember) return ApplicationCommandOptionType.User
  if (value instanceof Role) return ApplicationCommandOptionType.Role
  if (value instanceof BaseChannel) return ApplicationCommandOptionType.Channel
  if (value instanceof Attachment) return ApplicationCommandOptionType.Attachment
  if (typeof value === 'object' && value !== null) return ApplicationCommandOptionType.Mentionable
  return ApplicationCommandOptionType.String
}

/** The discord.js classes an entity option's value is an instance of, each read by its own getters. */
const ENTITY_CLASSES = [User, GuildMember, Role, BaseChannel, Attachment] as const
type EntityClass = (typeof ENTITY_CLASSES)[number]

/**
 * Every option type a value may be sent as: a whole number as an Integer or a Number, and a user or a role as a
 * mentionable too. A plain `{ id }` may be any entity.
 */
function possibleTypesOf(value: unknown): readonly ApplicationCommandOptionType[] {
  const T = ApplicationCommandOptionType
  if (typeof value === 'string') return [T.String]
  if (typeof value === 'boolean') return [T.Boolean]
  if (typeof value === 'number') return Number.isInteger(value) ? [T.Integer, T.Number] : [T.Number]
  if (value instanceof User || value instanceof GuildMember) return [T.User, T.Mentionable]
  if (value instanceof Role) return [T.Role, T.Mentionable]
  if (value instanceof BaseChannel) return [T.Channel]
  if (value instanceof Attachment) return [T.Attachment]
  return [T.User, T.Role, T.Channel, T.Mentionable, T.Attachment]
}

/** A user option's member: the user's in the server of the interaction the options are given to, or none in a DM. */
type MemberOf = (name: string, user: User) => object | null

/**
 * Shapes one supplied option the way the gateway sends it.
 *
 * An entity option arrives as a snowflake in `value` *and* as the resolved object on
 * its own field, and code that reads only one of the two is exactly what this lets a
 * test catch — so both are set. A user option has its user, and in a server its member too.
 */
function toOptionData(name: string, value: ChatInputOptions[string], memberOf?: MemberOf): CommandInteractionOption {
  const type = optionTypeOf(value)
  const isEntity = typeof value === 'object' && value !== null

  const option: Record<string, unknown> = { name, type, value: isEntity ? value.id : value }

  if (value instanceof User) {
    option.user = value
    // Read once the options are given to an interaction, which says whether it was made in a server
    if (memberOf) Object.defineProperty(option, 'member', { get: () => memberOf(name, value) ?? undefined, enumerable: true })
  } else if (value instanceof GuildMember) {
    option.user = value.user
    option.member = value
  } else if (value instanceof Role) option.role = value
  else if (value instanceof BaseChannel) option.channel = value
  else if (value instanceof Attachment) option.attachment = value
  else if (isEntity) option.user = value

  return option as unknown as CommandInteractionOption
}

/**
 * The option an autocomplete's user is typing, as Discord sends it: its value a string, `''` before anything is typed.
 * A number given for it is its digits under strict mocks; otherwise it stays a number, with a warning when read.
 */
function focusedOptionData(name: string, value: ChatInputOptions[string]): CommandInteractionOption {
  const option = toOptionData(name, value ?? '') as unknown as Record<string, unknown>
  option.focused = true
  if (typeof value === 'number') {
    if (strictMocks()) option.value = String(value)
    else {
      Object.defineProperty(option, 'value', {
        get: () => {
          warnOnce(
            mockLogger,
            `The focused option "${name}" reads the number ${value} here, where Discord sends a string; in the next major version (5.0) ` +
              `the mock gives it as one. Give it as a string, such as '${value}', or call useStrictMocks() to have the mock give it now.`,
          )
          return value
        },
        enumerable: true,
      })
    }
  }
  return option as unknown as CommandInteractionOption
}

/**
 * Nests the supplied options under the subcommand path they were invoked through,
 * matching the shape Discord sends rather than a flat list.
 */
function buildOptionData(
  subcommandGroup: string | null,
  subcommand: string | null,
  values: Record<string, ChatInputOptions[string]>,
  memberOf: MemberOf,
  focused: string | null,
): CommandInteractionOption[] {
  const leaves = Object.entries(values).map(([name, value]) =>
    name === focused ? focusedOptionData(name, value) : toOptionData(name, value, memberOf),
  )
  if (focused !== null && !Object.hasOwn(values, focused)) leaves.push(focusedOptionData(focused, null))

  if (subcommand === null) return leaves

  const sub = { name: subcommand, type: ApplicationCommandOptionType.Subcommand, options: leaves }
  if (subcommandGroup === null) return [sub as unknown as CommandInteractionOption]

  return [
    {
      name: subcommandGroup,
      type: ApplicationCommandOptionType.SubcommandGroup,
      options: [sub],
    } as unknown as CommandInteractionOption,
  ]
}

/**
 * Builds a slash command's options from a plain record, found by name as the real options resolver finds them.
 *
 * Use it for the `options` of a mock `ChatInputCommandInteraction`, including an autocomplete's `focused` option. The
 * options are nested under the subcommand and group as Discord sends them, so the handler's params build as in the bot.
 *
 * @param opts - Each option's value by its name, with the `subcommandGroup`, `subcommand` and `focused` option; see
 *   {@link ChatInputOptions}.
 *
 * @remarks
 * Every method is a mock function, and its errors are discord.js's own, each a `DiscordjsTypeError` with its code. An
 * entity option carries its id in `value` and the object itself, as the gateway sends it: a user option its `user`,
 * and in a server its `member` too. A user option's
 * `getMember()` is the user's member in the server of the interaction the options are given to, and `null` in a DM;
 * a member given resolves `getUser()` to its user. A getter throws discord.js's type error for an option of another
 * type, as discord.js does, required or not. Only a user or member read as a role, or a role read as a user or member,
 * is `null`, or that error when required, as the option may be a mentionable one; a plain `{ id }` reads as any entity.
 * A whole number is an Integer option and a fraction a Number one, so
 * `getInteger()` reads only a whole number, and `getNumber()` reads either.
 *
 * The `focused` option reads as Discord sends it, through `getFocused()`, `getFocused(true)` and `data` alike: a
 * string, `''` when no value is given, and marked `focused` in `data`. A number given for it is its digits under
 * `useStrictMocks()`; otherwise it stays the number, with a warning when read.
 *
 * @typeParam Cached - `any` by default, to match `createMockInteraction(ChatInputCommandInteraction)`; pass it when the
 *   interaction under test is cache-pinned.
 *
 * @example
 * ```ts
 * import { expect } from 'vitest'
 *
 * const interaction = createMockInteraction(ChatInputCommandInteraction, {
 *   commandName: 'settings',
 *   options: createChatInputOptions({ subcommandGroup: 'notify', subcommand: 'email', address: 'ada@example.com' }),
 * })
 * expect(interaction.options.getSubcommand()).toBe('email')
 * expect(interaction.options.getString('address')).toBe('ada@example.com')
 * ```
 *
 * @group Testing
 * @category Mocks
 * @see {@link ChatInputOptions}
 */
export function createChatInputOptions<Cached extends CacheType = any>(
  opts: ChatInputOptions = {},
): DeepMocked<CommandInteractionOptionResolver<Cached>> {
  const { subcommandGroup = null, subcommand = null, focused = null, ...values } = opts

  function resolveOrThrow<U>(name: string, value: U | null, required?: boolean): U | null {
    if (value === null) {
      if (required === true) throw optionError(DiscordjsErrorCodes.CommandInteractionOptionNotFound, name)
      return null
    }
    return value
  }

  function resolveSubEntry(field: string | null, code: DiscordjsErrorCodes, required: boolean): string | null {
    if (field === null && required) throw optionError(code)
    return field
  }

  // Use a real prototype instance so unlisted methods
  // are found on the prototype chain and auto-stubbed as a mock fn
  const base = Object.create(CommandInteractionOptionResolver.prototype)

  // As in discord.js, a subcommand is required unless told otherwise, and a group is not
  base.getSubcommandGroup = createMockFn((required = false) =>
    resolveSubEntry(subcommandGroup, DiscordjsErrorCodes.CommandInteractionOptionNoSubcommandGroup, required),
  )
  base.getSubcommand = createMockFn<(required?: boolean) => string | null>((required = true) =>
    resolveSubEntry(subcommand, DiscordjsErrorCodes.CommandInteractionOptionNoSubcommand, required),
  )
  // As discord.js reads an option by its type: another type throws its type error, required or not. A value whose
  // option may be of the getter's type, as a user may be a mentionable option's, reads as null if the getter doesn't
  // take it, and throws when required
  const readOption = <V>(name: string, expected: readonly (ApplicationCommandOptionType | '_MESSAGE')[], takes: (value: object | string | number | boolean) => boolean, required?: boolean): V | null => {
    const value = values[name]
    if (value === undefined || value === null) return resolveOrThrow<V>(name, null, required)
    const typeError = () => optionError(DiscordjsErrorCodes.CommandInteractionOptionType, name, optionTypeOf(value), expected.join(', '))
    if (!possibleTypesOf(value).some(type => expected.includes(type))) throw typeError()
    if (takes(value)) return value as V
    if (required === true) throw typeError()
    return null
  }
  const { String: STRING, Integer: INTEGER, Number: NUMBER, Boolean: BOOLEAN, User: USER, Role: ROLE, Channel: CHANNEL, Mentionable: MENTIONABLE, Attachment: ATTACHMENT } =
    ApplicationCommandOptionType
  // A plain `{ id }` may be any entity
  const plainOr = (...kinds: EntityClass[]) => (value: unknown) => kinds.some(Kind => value instanceof Kind) || !ENTITY_CLASSES.some(Kind => value instanceof Kind)

  base.getString = createMockFn<(name: string, required?: boolean) => string | null>((name: string, required?: boolean) =>
    readOption(name, [STRING], () => true, required),
  )
  base.getNumber = createMockFn<(name: string, required?: boolean) => number | null>((name: string, required?: boolean) =>
    readOption(name, [NUMBER], () => true, required),
  )
  base.getInteger = createMockFn<(name: string, required?: boolean) => number | null>((name: string, required?: boolean) =>
    readOption(name, [INTEGER], () => true, required),
  )
  base.getBoolean = createMockFn<(name: string, required?: boolean) => boolean | null>((name: string, required?: boolean) =>
    readOption(name, [BOOLEAN], () => true, required),
  )

  // A user option carries both the user and, in a server, its member, whichever of the two the test gave
  // Kept apart, so a member read before the options belong to an interaction is not what one in a DM reads later
  const members = new Map<string, object | null>()
  const unowned = new Map<string, object>()
  const memberOf = (name: string, user: User): object | null => {
    const owner = optionOwners.get(resolver)
    if (!owner) {
      if (!unowned.has(name)) unowned.set(name, memberIn(undefined, user.id, user))
      return unowned.get(name)!
    }
    const rawOwner = !owner.guild && isRawMember(Object.getOwnPropertyDescriptor(owner, 'member')?.value)
    if (!members.has(name)) members.set(name, owner.guildId ? (rawOwner ? rawResolvedMember() : memberFor(owner.guild, user, true)) : null)
    return members.get(name) ?? null
  }

  base.getUser = createMockFn<(name: string, required?: boolean) => { id: string } | null>((name: string, required?: boolean) => {
    const value = readOption<{ id: string }>(name, [USER, MENTIONABLE], plainOr(User, GuildMember), required)
    return value instanceof GuildMember ? value.user : value
  })
  base.getRole = createMockFn<(name: string, required?: boolean) => { id: string } | null>((name: string, required?: boolean) =>
    readOption(name, [ROLE, MENTIONABLE], plainOr(Role), required),
  )
  base.getChannel = createMockFn<(name: string, required?: boolean, channelTypes?: readonly ChannelType[]) => { id: string } | null>(
    (name: string, required?: boolean, channelTypes: readonly ChannelType[] = []) => {
      const channel = readOption<{ id: string; type?: ChannelType }>(name, [CHANNEL], plainOr(BaseChannel), required)
      if (channel?.type !== undefined && channelTypes.length > 0 && !channelTypes.includes(channel.type)) {
        throw optionError(INVALID_CHANNEL_TYPE, name, channel.type, channelTypes.join(', '))
      }
      return channel
    },
  )
  base.getMember = createMockFn<(name: string) => object | null>((name: string) => {
    const value = readOption<object>(name, [USER, MENTIONABLE], plainOr(User, GuildMember))
    return value instanceof User ? memberOf(name, value) : value
  })
  base.getMentionable = createMockFn<(name: string, required?: boolean) => { id: string } | null>((name: string, required?: boolean) =>
    readOption(name, [MENTIONABLE], plainOr(User, GuildMember, Role), required),
  )
  base.getAttachment = createMockFn<(name: string, required?: boolean) => Attachment | null>((name: string, required?: boolean) =>
    readOption(name, [ATTACHMENT], plainOr(Attachment), required),
  )
  base.get = createMockFn<(name: string, required?: boolean) => CommandInteractionOption | null>((name: string, required?: boolean) => {
    const value = values[name]
    return value === undefined || value === null ? resolveOrThrow(name, null, required) : toOptionData(name, value, memberOf)
  })
  // A message option is a message context menu's own, never a slash command's
  base.getMessage = createMockFn<(name: string, required?: boolean) => null>((name: string, required?: boolean) =>
    readOption(name, ['_MESSAGE'], () => false, required),
  )

  base.getFocused = createMockFn((getFull?: boolean) => {
    if (focused === null) throw optionError(DiscordjsErrorCodes.AutocompleteInteractionOptionNoFocusedOption)
    // The one options.data holds, so the two agree
    const option = (base._hoistedOptions as CommandInteractionOption[]).find(each => each.focused)!
    return getFull === true ? { ...option } : option.value
  })

  // `data` is what the framework reads to build a handler's params, so it is materialised here rather than
  // auto-stubbed, or every params assertion would see an empty record.
  base.data = buildOptionData(subcommandGroup, subcommand, values, memberOf, focused)
  // The fields discord.js's constructor sets from it, which its toString() reads
  base._group = subcommandGroup
  base._subcommand = subcommand
  base._hoistedOptions = (subcommand === null ? base.data : (subcommandGroup === null ? base.data[0] : base.data[0].options[0]).options) as CommandInteractionOption[]

  const resolver = stubDeep(base)
  return resolver as unknown as DeepMocked<CommandInteractionOptionResolver<Cached>>
}
