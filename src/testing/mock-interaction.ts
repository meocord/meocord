import 'reflect-metadata'
import { createMockFn, type MockedFunction, type Mock } from './mock-fn.js'
import {
  type APIAuthorizingIntegrationOwnersMap,
  type APIEmbed,
  type APIMessageTopLevelComponent,
  Component,
  Embed,
  type JSONEncodable,
  type MessageFlagsResolvable,
  type GuildBasedChannel,
  ApplicationCommandManager,
  ApplicationCommandOptionType,
  ApplicationCommandType,
  Attachment,
  ApplicationCommand,
  AuthorizingIntegrationOwners,
  Base,
  BaseChannel,
  BaseInteraction,
  BaseManager,
  ChannelManager,
  ChannelSelectMenuInteraction,
  Client,
  ClientUser,
  Collection,
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
  MessageFlagsBitField,
  MessageMentions,
  Role,
  RoleManager,
  RoleSelectMenuInteraction,
  StringSelectMenuInteraction,
  type TextBasedChannel,
  TextChannel,
  ThreadChannel,
  ThreadMember,
  ThreadMemberManager,
  User,
  UserManager,
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
} from 'discord.js'
import { createDiscordError } from './response.js'
import { stampCall } from '@src/common/response/call-order.js'
import { type ResponseCall } from '@src/common/response/response-state.js'
import { discordDefault, REAL_GETTER } from './discord-defaults.js'
import { asDiscordStores, embedsAsDiscordStores } from './discord-shape.js'

// ---------------------------------------------------------------------------
// DeepMocked<T>
// ---------------------------------------------------------------------------

/**
 * A mock of `T`: every method a mock function, and every nested object mocked in turn, five levels deep.
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
      -readonly [K in keyof T]: T[K] extends (...args: infer A) => infer R
        ? MockedFunction<(...args: A) => R>
        : T[K] extends object
          ? DeepMocked<T[K], [...Depth, 0]>
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

type StubValue = Mock | object | string | number | boolean | null

function stubDeep(instance: object, externalStubs?: Map<string, StubValue>): object {
  const stubs = externalStubs ?? new Map<string, StubValue>()

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
      if (stubs.has(key)) return stubs.get(key)

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

      // Walk the prototype chain to check if it's a function
      let proto: object | null = Object.getPrototypeOf(target)
      let protoValue: unknown
      while (proto !== null) {
        const desc = Object.getOwnPropertyDescriptor(proto, key)
        if (desc !== undefined) {
          protoValue = desc.value
          break
        }
        proto = Object.getPrototypeOf(proto)
      }

      const stub: StubValue =
        typeof protoValue === 'function' ? methodStub(target, key, protoValue as (...args: unknown[]) => unknown, () => proxy) : stubDeep({})
      stubs.set(key, stub)
      return stub
    },

    // defineProperty rather than assignment: many discord.js properties are
    // prototype getters with no setter (targetUser, targetMessage, createdAt),
    // and a plain write against one of those throws. Defining an own
    // data property shadows the accessor, which is what test setup means.
    set(target, prop, value) {
      Object.defineProperty(target, prop, { value, writable: true, enumerable: true, configurable: true })
      return true
    },
  })
  return proxy
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
  [ApplicationCommandManager, id => createMockInteraction(ApplicationCommand, id ? { id } : {})],
  [ChannelManager, id => createMockChannel(TextChannel, id ? { id } : {})],
  [GuildChannelManager, (id, manager) => createMockChannel(TextChannel, { ...(id ? { id } : {}), ...(guildOf(manager) ? { guild: guildOf(manager) } : {}) } as never)],
]

const returnsPromise = (key: string, method: (...args: unknown[]) => unknown) =>
  method.constructor.name === 'AsyncFunction' ||
  PROMISE_METHODS.has(key) ||
  (/^set[A-Z]/.test(key) && !SYNC_SETTERS.has(key))

// The id of the one item a fetch asks for: an id, a discord.js object, or options naming one, such as `{ user: id }`;
// undefined for a fetch of a list
function fetchedId(args: unknown[]): string | undefined {
  const idOf = (value: unknown) => (typeof value === 'string' ? value : value instanceof Base ? (value as { id?: string }).id : undefined)
  const [first] = args
  if (typeof first !== 'object' || first === null || first instanceof Base) return idOf(first)
  for (const key of ['user', 'member', 'message', 'guild', 'thread', 'id']) {
    const id = idOf((first as Record<string, unknown>)[key])
    if (id !== undefined) return id
  }
  return undefined
}

/**
 * The mock function for a method found on a discord.js prototype. One that returns a promise in discord.js resolves:
 * `createDM` to the user's DM channel, `send` and its kin to a message, a manager's `fetch`, `create` and `edit` to its
 * item (an empty collection for a list fetch), a structure's own `edit`, `fetch`, `delete`, `ban`, `pin`, `timeout` and
 * setters to the structure, and the rest to `undefined`. Any other method returns `undefined`.
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
    // A fetch of one item finds it in the cache first, as discord.js does, and caches one it makes
    if (item && key === 'fetch') {
      return createMockFn(async (...args: unknown[]) => {
        const id = fetchedId(args)
        if (id === undefined) return new Collection()
        return cached(cacheOf(receiver()), id, () => item(id, receiver()))
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

/** The last id a mock was given; ids count up from a real snowflake, so each mock's is its own. */
let lastSnowflake = 1_400_000_000_000_000_000n

/** A snowflake-shaped id no other mock in this run has. */
const nextSnowflake = (): string => String(++lastSnowflake)

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

/** Where a mock interaction keeps every answer it got, through respond() or discord.js directly, in order. */
export const RESPONSE_LOG: unique symbol = Symbol('response log')

const ANSWER_METHODS = ['reply', 'deferReply', 'editReply', 'followUp', 'deleteReply', 'update', 'deferUpdate', 'showModal'] as const

/**
 * `mock`, recording each call in `log` as it is made, with what it sent and, once it settles, what it rejected with.
 * `withResponse` is how a call asks discord.js for the message back, not part of what it sends, so it is left out.
 */
function recorded(method: ResponseCall['method'], mock: Mock, log: ResponseCall[]): Mock {
  return new Proxy(mock, {
    apply(target, self, args: unknown[]) {
      const [payload] = args
      const sent =
        payload && typeof payload === 'object' && 'withResponse' in payload
          ? Object.fromEntries(Object.entries(payload).filter(([key]) => key !== 'withResponse'))
          : payload
      const call: ResponseCall = { method, payload: sent }
      stampCall(call)
      log.push(call)
      try {
        const result: unknown = Reflect.apply(target, self, args)
        // Recorded and passed on, so a rejection nobody awaits is unhandled in the test, as it is on a bot
        if (result instanceof Promise) {
          return result.then(undefined, (error: unknown) => {
            call.error = error
            throw error
          })
        }
        return result
      } catch (error) {
        call.error = error
        throw error
      }
    },
  })
}

/** The interaction a mock options resolver was given to, for the server a user option's member is in. */
const optionOwners = new WeakMap<object, { guildId?: unknown; guild?: unknown }>()

/** A mock user that is a person, with an id of its own unless given one. */
const mockUser = (id = nextSnowflake()): object => stubDeep(Object.assign(Object.create(User.prototype), { id, bot: false }))

/**
 * The id of the bot every mock client is logged in as, so a test can mention it. Fixed, and below the
 * ids other mocks take, so it is the same on every run and in any test order, and no mock shares it.
 */
const MOCK_BOT_ID = '1300000000000000000'

// ---------------------------------------------------------------------------
// createMockInteraction
// ---------------------------------------------------------------------------

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
 * @see {@link https://meocord.dev/docs/4.1/mocks | Mocks}
 */
export function createMockInteraction<T extends object>(
  Class: InteractionClass<T>,
  props?: MockProps<T>,
): DeepMocked<T> {
  const instance = Object.create(Class.prototype) as Record<string, unknown>
  const stubs = new Map<string, Mock>()

  // Set type fields so all prototype type-guard methods compute the right value
  const fields = CLASS_TYPE_FIELDS[Class.name]
  if (fields !== undefined) {
    for (const [key, value] of Object.entries(fields)) {
      instance[key] = value
    }
  }

  // Wire each type guard as a mock fn calling the real prototype implementation.
  // Correct by default; overridable per test via .mockReturnValue().
  for (const name of TYPE_GUARD_METHODS) {
    const method = findPrototypeMethod(instance, name)
    if (method !== null) {
      stubs.set(
        name,
        createMockFn().mockImplementation(() => method.call(instance)),
      )
    }
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
    if (findPrototypeMethod(instance, name) !== null) stubs.set(name, createMockFn().mockImplementation(check))
  }

  // Set up reply state machine for repliable interactions
  const isRepliableMethod = findPrototypeMethod(instance, 'isRepliable')
  const repliable = isRepliableMethod !== null && (isRepliableMethod.call(instance) as boolean)
  if (repliable) {
    instance.replied = false
    instance.deferred = false
    instance.ephemeral = false

    const alreadyReplied = () => new Error('The reply to this interaction has already been sent or deferred.')
    const notYetReplied = (method: string) => new Error(`Cannot call ${method}() before replying or deferring.`)

    // Only `flags` is read: discord.js deprecates the `ephemeral: true` reply option, and honouring it here would let
    // a test pass against a deprecated call.
    const hasEphemeralFlag = (options?: Record<string, unknown>): boolean => {
      if (!options) return false
      const { flags } = options
      if (typeof flags === 'number') return (flags & 64) !== 0
      if (typeof flags === 'bigint') return (flags & 64n) !== 0n
      return false
    }

    stubs.set(
      'reply',
      createMockFn(async (...args: unknown[]) => {
        if (instance.deferred || instance.replied) throw alreadyReplied()
        instance.replied = true
        if (hasEphemeralFlag(args[0] as Record<string, unknown> | undefined)) instance.ephemeral = true
      }),
    )
    stubs.set(
      'deferReply',
      createMockFn(async (...args: unknown[]) => {
        if (instance.deferred || instance.replied) throw alreadyReplied()
        instance.deferred = true
        if (hasEphemeralFlag(args[0] as Record<string, unknown> | undefined)) instance.ephemeral = true
      }),
    )
    stubs.set(
      'followUp',
      createMockFn(async () => {
        if (!instance.deferred && !instance.replied) throw notYetReplied('followUp')
        instance.replied = true
        return createMockMessage()
      }),
    )
    // The interaction's own message as Discord holds it: the message a component is on, or the original response.
    // An edit replaces it in the shape Discord stores, with ids and resolved media, stamped with when it was edited,
    // and fetchReply() reads that back, so code comparing the two sees what it would against Discord.
    let held: HeldMessage | undefined
    const current = (): HeldMessage => (held ??= heldFrom(instance.message))
    // A command answered with a modal has no original response, and Discord refuses one asked for
    let modalAnswered = false
    const unknownMessage = () => createDiscordError(10008, 'Unknown Message')
    stubs.set(
      'editReply',
      createMockFn(async (options?: unknown) => {
        if (!instance.deferred && !instance.replied) throw notYetReplied('editReply')
        if (modalAnswered) throw unknownMessage()
        instance.replied = true
        held = edited(current(), options)
        // The response has the message as Discord answers the edit, before its uploaded files have loaded again
        return messageFrom({ ...held, components: held.returned ?? held.components })
      }),
    )
    stubs.set(
      'fetchReply',
      createMockFn(async () => {
        if (modalAnswered) throw unknownMessage()
        return messageFrom(current())
      }),
    )
    stubs.set(
      'deleteReply',
      createMockFn(async () => {
        if (!instance.deferred && !instance.replied) throw notYetReplied('deleteReply')
        if (modalAnswered) throw unknownMessage()
      }),
    )

    // showModal — the first response of a command or a component, like reply()
    if (instance.type === InteractionType.ApplicationCommand || instance.type === InteractionType.MessageComponent) {
      stubs.set(
        'showModal',
        createMockFn(async () => {
          if (instance.deferred || instance.replied) throw alreadyReplied()
          instance.replied = true
          modalAnswered = instance.type === InteractionType.ApplicationCommand
        }),
      )
    }

    // deferUpdate / update — components, and modals submitted from a message's component
    if (instance.type === InteractionType.MessageComponent || instance.type === InteractionType.ModalSubmit) {
      stubs.set(
        'update',
        createMockFn(async () => {
          if (instance.deferred || instance.replied) throw alreadyReplied()
          instance.replied = true
        }),
      )
      stubs.set(
        'deferUpdate',
        createMockFn(async () => {
          if (instance.deferred || instance.replied) throw alreadyReplied()
          instance.deferred = true
        }),
      )
    }

    // Every answer the interaction gets, through respond() or discord.js directly, in order, for getResponse
    const log: ResponseCall[] = []
    Object.defineProperty(instance, RESPONSE_LOG, { value: log })
    for (const method of ANSWER_METHODS) {
      const stub = stubs.get(method)
      if (stub) stubs.set(method, recorded(method, stub as Mock, log))
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
        if (instance.responded) throw new Error('The reply to this interaction has already been sent or deferred.')
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
    const { options } = props as { options?: unknown }
    if (typeof options === 'object' && options !== null) optionOwners.set(options, instance)
  }

  // Ids and a user, as Discord always sends; no server unless the test names one, as in a direct message
  if (BaseInteraction.prototype.isPrototypeOf(instance)) {
    const unset = (key: string) => !Object.prototype.hasOwnProperty.call(instance, key)
    const generatedId = unset('id') ? (instance.id = nextSnowflake()) : undefined
    defineCreatedTime(instance, generatedId)
    const userGiven = !unset('user')
    if (!userGiven) instance.user = mockUser()
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

  return stubDeep(instance, stubs) as DeepMocked<T>
}

// ---------------------------------------------------------------------------
// createMock — class-free mock for services and interfaces
// ---------------------------------------------------------------------------

/**
 * A mock function that answers property access with another one, so `cache.store.flush()` works
 * on a double whose shape is an interface with nothing at runtime to read it from.
 */
function stubCallable(): Mock {
  const fn = createMockFn()
  const nested = new Map<string, Mock>()

  return new Proxy(fn, {
    get(target, prop) {
      if (typeof prop === 'symbol') return Reflect.get(target, prop, target)

      const key = prop as string

      // Never thenable — otherwise awaiting a mock hangs on itself
      if (key === 'then') return undefined

      // The mock's own API (`mock`, `mockReturnValue`, `_isMockFunction`, …) and
      // the function intrinsics pass straight through.
      if (key in target) return Reflect.get(target, prop, target)

      if (!nested.has(key)) nested.set(key, stubCallable())
      return nested.get(key) as Mock
    },

    set(target, prop, value) {
      Object.defineProperty(target, prop, { value, writable: true, enumerable: true, configurable: true })
      return true
    },
  }) as Mock
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
export const createMockUser = (props: MockProps<User> = {}): DeepMocked<User> =>
  createMockInteraction(User, { id: nextSnowflake(), bot: false, ...props })

/**
 * Creates a mock {@link Client}, with `users`, `channels`, `guilds` and `application.commands` ready to stub.
 *
 * Use it when code under test reaches the client, such as to DM a user or fetch a channel, or to address messages to
 * the bot. A mock message built without one gets a client of its own; give an interaction its `client` when the code
 * under test reaches it.
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
 * const botId = client.user!.id
 * const message = createMockMessage({ content: `<@${botId}> help`, client })
 * expect(message.mentions.users.has(botId)).toBe(true)
 * ```
 *
 * @group Testing
 * @category Mocks
 * @see {@link createMockMessage}
 */
export function createMockClient(): DeepMocked<Client> {
  const instance = Object.create(Client.prototype) as Record<string, unknown>

  // Manager properties are constructor-assigned — pre-initialize as prototype-based
  // stubs so ALL manager methods (not just fetch) are auto-stubbed as a mock fn.
  const appInstance = Object.create(null) as Record<string, unknown>
  appInstance.commands = stubDeep(Object.create(ApplicationCommandManager.prototype))

  // Real caches, empty until something is put in them, as a client that has just logged in
  instance.users = managerWith(UserManager.prototype, undefined)
  instance.channels = managerWith(ChannelManager.prototype, undefined)
  instance.guilds = stubDeep(Object.create(GuildManager.prototype))
  instance.user = stubDeep(Object.assign(Object.create(ClientUser.prototype), { id: MOCK_BOT_ID, bot: true }))
  instance.application = stubDeep(appInstance)

  return stubDeep(instance) as DeepMocked<Client>
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

/** A manager whose `cache` is a real collection of `items`, by id, empty without them, and whose methods are stubs. */
function managerWith(prototype: object, items: readonly { id: string; user?: { id: string } }[] | undefined): object {
  const manager = Object.create(prototype) as object
  const cache = new Collection((items ?? []).map(item => [String(item.id ?? item.user?.id), item]))
  Object.defineProperty(manager, 'cache', { value: cache, writable: true })
  return stubDeep(manager)
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
 * caches under that id: a member or channel in this guild, a role with that id, or a ban; `create()` and `edit()`
 * resolve to a mock of its item, and a list fetch to an empty collection. Members, roles and channels given are put in
 * their managers' caches, where dispatch looks first when it resolves a message's typed params; a member
 * {@link createMockMember} made without a server is in this one. Its `roles.everyone` is the role given with the
 * guild's id, or else an @everyone role of its own at position 0 with no permissions, in `roles.cache` as Discord has
 * it. The guild is named `'Guild'` and its `preferredLocale` is `'en-US'` unless given, so `t.forGuild(guild)`
 * translates as for a new English server.
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
  instance.id = nextSnowflake()

  if (overrides.id !== undefined) instance.id = overrides.id
  if (overrides.name !== undefined) instance.name = overrides.name
  if (overrides.preferredLocale !== undefined) instance.preferredLocale = overrides.preferredLocale
  instance.members = managerWith(GuildMemberManager.prototype, overrides.members as never)
  instance.channels = managerWith(GuildChannelManager.prototype, overrides.channels as never)
  instance.roles = guildRoleManager(instance.id as string, overrides.roles)
  instance.bans = managerWith(GuildBanManager.prototype, undefined)

  const guild = stubDeep(instance) as DeepMocked<Guild>
  homeManagers(instance, guild)
  // A member made without a server of its own is in this one
  for (const member of overrides.members ?? []) {
    if (!unhomedMembers.delete(member)) continue
    ;(member as unknown as Record<string, unknown>).guild = guild
  }
  return guild
}

/**
 * Creates a mock channel of the given class, such as `TextChannel`, `ThreadChannel` or `DMChannel`.
 *
 * Use it for a channel a handler reads or posts to, such as one it fetches messages from or opens a thread in.
 *
 * @remarks
 * The managers the class has are ready to stub: `messages`, `threads` on text, announcement, forum and media channels,
 * and `members` on threads, each with a real, empty `cache` and the channel as its `channel`, or `thread`. A subclass gets the managers of the class it extends.
 * Type guards such as `isTextBased()`, `isDMBased()` and `isThread()` run discord.js's own logic, so each answers what
 * the channel is.
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
export function createMockChannel<T extends BaseChannel>(Class: InteractionClass<T>, props: MockProps<T> = {}): DeepMocked<T> {
  const instance = Object.create(Class.prototype) as Record<string, unknown>
  instance.id = nextSnowflake()
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
  Object.assign(instance, props)

  const stubs = new Map<string, StubValue>()
  const channel = stubDeep(instance, stubs)
  // Each manager knows its channel, as discord.js's do, and a thread's members their thread
  for (const key of ['messages', 'threads']) if (instance[key]) (instance[key] as Record<string, unknown>).channel = channel
  if (is(ThreadChannel) && instance.members) (instance.members as Record<string, unknown>).thread = channel
  // Type guards run discord.js's own logic, which reads the channel's type and the managers it has
  for (const name of CHANNEL_TYPE_GUARDS) {
    const method = findPrototypeMethod(instance, name)
    if (method !== null) stubs.set(name, createMockFn(() => method.call(channel)))
  }
  return channel as DeepMocked<T>
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

/** A server's @everyone role, which has the server's id and ranks lowest, at position 0. */
const everyoneRole = (guildId: string): Role => createMockInteraction(Role, { id: guildId, name: '@everyone', position: 0 }) as Role

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
function createMockGuildForMessage(id = nextSnowflake()): object {
  const guild = Object.create(Guild.prototype) as Record<string, unknown>
  guild.id = id
  guild.members = managerWith(GuildMemberManager.prototype, undefined)
  guild.channels = managerWith(GuildChannelManager.prototype, undefined)
  guild.roles = guildRoleManager(guild.id as string, undefined)
  guild.bans = managerWith(GuildBanManager.prototype, undefined)
  const proxy = stubDeep(guild)
  homeManagers(guild, proxy)
  return proxy
}

/** Gives a guild's managers the guild, as discord.js's do, so what they fetch or make is in it. */
function homeManagers(instance: Record<string, unknown>, guild: object): void {
  for (const key of ['members', 'channels', 'roles', 'bans']) (instance[key] as Record<string, unknown>).guild = guild
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
  /** Its top-level components: action rows, or Components V2 such as a container. */
  components?: readonly (APIMessageTopLevelComponent | JSONEncodable<APIMessageTopLevelComponent>)[]
  /** Its embeds. */
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
  for (const [key, value] of Object.entries({ ...mentioned, everyone: false })) Object.defineProperty(instance, key, { value, writable: true })
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
 * A component or embed as a message holds it: a discord.js instance as it is; anything else as
 * its API JSON at the time of the call, behind `toJSON()`.
 */
function asHeld<T>(value: T | JSONEncodable<T>): JSONEncodable<T> {
  if (value instanceof Component || value instanceof Embed) return value as JSONEncodable<T>
  const json = structuredClone(
    typeof (value as Partial<JSONEncodable<T>>).toJSON === 'function' ? (value as JSONEncodable<T>).toJSON() : (value as T),
  )
  return { toJSON: () => json }
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
 * mentions, are cached as the gateway delivers them.
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
export function createMockMessage(overrides: MockMessageOverrides = {}): DeepMocked<Message> & { deleted: boolean } {
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
  const author = overrides.author
  const member = guild ? memberFor(guild, instance.author as { id: string }, author !== undefined) : null
  Object.defineProperty(instance, 'member', { value: member, writable: true })
  // In a server's text channel, the ids matching the objects; with no guild, a DM
  instance.channelId = channel.id
  instance.guildId = guild?.id ?? null
  Object.defineProperty(instance, 'thread', {
    value: stubDeep(Object.create(ThreadChannel.prototype)),
    writable: true,
  })

  // Assigned once by discord.js's Base constructor, so an own value, as it is on a real message
  const client = overrides.client ?? createMockClient()
  Object.defineProperty(instance, 'client', { value: client, writable: true })
  cacheChannel(channel, guild, client)
  const userCache = cacheOf(client.users)
  for (const user of [...(overrides.users ?? []), ...(author ? [author] : [])]) userCache?.set(user.id, user)

  // MessageMentions — constructor-assigned; what the content mentions, cached as the gateway delivers it
  instance.mentions = mentionsOf(overrides.content, client, guild)

  // Data a message always has, real rather than stubbed, so code reading it sees an empty message
  instance.flags = new MessageFlagsBitField(overrides.flags)
  instance.components = (overrides.components ?? []).map(asHeld)
  instance.embeds = (overrides.embeds ?? []).map(asHeld)
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

  return stubDeep(instance, stubs) as DeepMocked<Message> & { deleted: boolean }
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
 * Nests the supplied options under the subcommand path they were invoked through,
 * matching the shape Discord sends rather than a flat list.
 */
function buildOptionData(
  subcommandGroup: string | null,
  subcommand: string | null,
  values: Record<string, ChatInputOptions[string]>,
  memberOf: MemberOf,
): CommandInteractionOption[] {
  const leaves = Object.entries(values).map(([name, value]) => toOptionData(name, value, memberOf))

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
 * Every method is a mock function, and methods not listed, such as `getAttachment`, are stubbed automatically. An
 * entity option carries its id in `value` and the object itself, as the gateway sends it: a user option its `user`,
 * and in a server its `member` too. A user option's
 * `getMember()` is the user's member in the server of the interaction the options are given to, and `null` in a DM;
 * a member given resolves `getUser()` to its user. A whole number is an Integer option and a fraction a Number one, so
 * `getInteger()` reads only a whole number, and `getNumber()` reads either.
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
      if (required === true) throw new Error(`Option "${name}" is required but was not provided.`)
      return null
    }
    return value
  }

  function resolveSubEntry(field: string | null, label: string, required?: boolean): string | null {
    if (field === null) {
      if (required === true) throw new Error(`No ${label} found.`)
      return null
    }
    return field
  }

  const isObjectOption = (v: unknown): v is { id: string } => typeof v === 'object' && v !== null && 'id' in v

  // Use a real prototype instance so unlisted methods (e.g. getAttachment)
  // are found on the prototype chain and auto-stubbed as a mock fn
  const base = Object.create(CommandInteractionOptionResolver.prototype)

  base.getSubcommandGroup = createMockFn((required?: boolean) =>
    resolveSubEntry(subcommandGroup, 'subcommand group', required),
  )
  base.getSubcommand = createMockFn<(required?: boolean) => string | null>((required?: boolean) =>
    resolveSubEntry(subcommand, 'subcommand', required),
  )
  base.getString = createMockFn<(name: string, required?: boolean) => string | null>(
    (name: string, required?: boolean) =>
      resolveOrThrow(name, typeof values[name] === 'string' ? (values[name] as string) : null, required),
  )
  base.getNumber = createMockFn<(name: string, required?: boolean) => number | null>(
    (name: string, required?: boolean) =>
      resolveOrThrow(name, typeof values[name] === 'number' ? (values[name] as number) : null, required),
  )
  // A fraction is only ever a Number option's value
  base.getInteger = createMockFn<(name: string, required?: boolean) => number | null>(
    (name: string, required?: boolean) =>
      resolveOrThrow(name, Number.isInteger(values[name]) ? (values[name] as number) : null, required),
  )
  base.getBoolean = createMockFn<(name: string, required?: boolean) => boolean | null>(
    (name: string, required?: boolean) =>
      resolveOrThrow(name, typeof values[name] === 'boolean' ? (values[name] as boolean) : null, required),
  )

  const getObjectOption = (name: string, required?: boolean) =>
    resolveOrThrow(name, isObjectOption(values[name]) ? (values[name] as { id: string }) : null, required)

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
    if (!members.has(name)) members.set(name, owner.guildId ? memberFor(owner.guild, user, true) : null)
    return members.get(name) ?? null
  }

  base.getUser = createMockFn<(name: string, required?: boolean) => { id: string } | null>((name: string, required?: boolean) => {
    const value = getObjectOption(name, required)
    return value instanceof GuildMember ? value.user : value
  })
  base.getRole = createMockFn<(name: string, required?: boolean) => { id: string } | null>(getObjectOption)
  base.getChannel = createMockFn<(name: string, required?: boolean) => { id: string } | null>(getObjectOption)
  base.getMember = createMockFn<(name: string) => object | null>((name: string) => {
    const value = getObjectOption(name)
    return value instanceof User ? memberOf(name, value) : value
  })
  base.getMentionable = createMockFn<(name: string, required?: boolean) => { id: string } | null>(getObjectOption)

  base.getFocused = createMockFn((getFull?: boolean) => {
    if (focused === null) throw new Error('No focused option found.')
    const option = toOptionData(focused, values[focused] ?? null, memberOf)
    return getFull === true ? { ...option, focused: true } : option.value
  })

  // `data` is what the framework reads to build a handler's params, so it is materialised here rather than
  // auto-stubbed, or every params assertion would see an empty record.
  base.data = buildOptionData(subcommandGroup, subcommand, values, memberOf)

  const resolver = stubDeep(base)
  return resolver as unknown as DeepMocked<CommandInteractionOptionResolver<Cached>>
}
