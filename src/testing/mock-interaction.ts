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
  GuildMessageManager,
  GuildManager,
  InteractionType,
  Locale,
  Message,
  MessageFlagsBitField,
  MessageMentions,
  Role,
  RoleManager,
  TextChannel,
  ThreadChannel,
  ThreadMember,
  ThreadMemberManager,
  User,
  UserManager,
  type CacheType,
  type CommandInteractionOption,
  DMChannel,
  ForumChannel,
  GuildForumThreadManager,
  GuildTextThreadManager,
  MediaChannel,
  NewsChannel,
  SnowflakeUtil,
} from 'discord.js'
import { createDiscordError } from './response.js'
import { discordDefault, REAL_GETTER } from './discord-defaults.js'
import { asDiscordStores, embedsAsDiscordStores } from './discord-shape.js'

// ---------------------------------------------------------------------------
// DeepMocked<T>
// ---------------------------------------------------------------------------

/**
 * A mock of `T`: every method a mock function, and every nested object mocked in turn, five levels deep.
 *
 * It is what the mock factories return. It is assignable wherever `T` is expected, since the mock is built on `T`'s
 * real prototype, and each method takes `mockResolvedValue` and the rest of {@link MockInstance}.
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
 * Use it for anything the discord.js class declares `readonly`, such as `ModalSubmitInteraction#customId` or
 * `MessageComponentInteraction#message`, which the returned mock does not let you assign.
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
// stubDeep — Proxy that auto-creates a mock fn on any property access
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
    // and a plain write against one of those is a silent no-op. Defining an own
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

// The item each manager fetches, creates and edits
const MANAGER_ITEMS: [{ prototype: object }, () => object][] = [
  [UserManager, () => createMockUser()],
  [GuildManager, () => createMockGuild()],
  [GuildMemberManager, () => createMockInteraction(GuildMember)],
  [RoleManager, () => createMockInteraction(Role)],
  [GuildBanManager, () => createMockInteraction(GuildBan)],
  [GuildMessageManager, () => createMockMessage()],
  [DMMessageManager, () => createMockMessage()],
  [GuildTextThreadManager, () => createMockChannel(ThreadChannel)],
  [GuildForumThreadManager, () => createMockChannel(ThreadChannel)],
  [ThreadMemberManager, () => createMockInteraction(ThreadMember)],
  [ApplicationCommandManager, () => createMockInteraction(ApplicationCommand)],
  [ChannelManager, () => createMockChannel(TextChannel)],
  [GuildChannelManager, () => createMockChannel(TextChannel)],
]

const returnsPromise = (key: string, method: (...args: unknown[]) => unknown) =>
  method.constructor.name === 'AsyncFunction' ||
  PROMISE_METHODS.has(key) ||
  (/^set[A-Z]/.test(key) && !SYNC_SETTERS.has(key))

// A fetch for one item: an id, a discord.js object, or options naming one, such as `{ user: id }`
function fetchesOne(args: unknown[]): boolean {
  const [first] = args
  if (typeof first === 'string' || first instanceof Base) return true
  if (typeof first !== 'object' || first === null) return false
  return ['user', 'member', 'message', 'guild', 'thread', 'id'].some(key => {
    const value = (first as Record<string, unknown>)[key]
    return typeof value === 'string' || value instanceof Base
  })
}

/**
 * The mock function for a method found on a discord.js prototype. A method that returns a promise in
 * discord.js resolves: to a message for `send` and its kin, to the item for a manager's `fetch`,
 * `create` and `edit` (an empty collection for a list fetch), to the structure itself for its own
 * `edit`, `fetch` and setters, and to `undefined` otherwise. Any other method returns `undefined`.
 */
function methodStub(target: object, key: string, method: (...args: unknown[]) => unknown, receiver: () => object): Mock {
  if (!returnsPromise(key, method)) return createMockFn()
  if (key === 'createDM') return createMockFn(async () => createMockChannel(DMChannel))
  if (MESSAGE_METHODS.has(key)) return createMockFn(async () => createMockMessage())
  if (target instanceof BaseManager) {
    const item = MANAGER_ITEMS.find(([Manager]) => Manager.prototype.isPrototypeOf(target))?.[1]
    if (item && key === 'fetch') return createMockFn(async (...args: unknown[]) => (fetchesOne(args) ? item() : new Collection()))
    if (item && (key === 'create' || key === 'edit')) return createMockFn(async () => item())
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
  // `isSelectMenu` is intentionally absent: discord.js deprecated it in favour of
  // `isStringSelectMenu`, and wiring it here would emit a deprecation warning on every
  // mock that has it on its prototype.
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
 * `member` is its user. Other data Discord always sends reads as Discord sends it, such as `false` for a flag and
 * `null` for what may be absent; what picks the handler, `commandName` or `customId`, is the test's to give. Replies
 * follow Discord's order, so a second `reply()` rejects, and {@link getResponse} reports what `respond()` sent. Every
 * method is a mock function, and one that returns a promise in discord.js resolves.
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
  // not given is the auto-stub, so only one set to null or undefined fails the check.
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

    // Only `flags` is read: the `ephemeral: true` reply option is deprecated in
    // discord.js, and honouring it here would let a test pass against a call the
    // library has stopped supporting.
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
    stubs.set(
      'editReply',
      createMockFn(async (options?: unknown) => {
        if (!instance.deferred && !instance.replied) throw notYetReplied('editReply')
        instance.replied = true
        held = edited(current(), options)
        // The response has the message as Discord answers the edit, before its uploaded files have loaded again
        return messageFrom({ ...held, components: held.returned ?? held.components })
      }),
    )
    stubs.set(
      'fetchReply',
      createMockFn(async () => messageFrom(current())),
    )
    stubs.set(
      'deleteReply',
      createMockFn(async () => {
        if (!instance.deferred && !instance.replied) throw notYetReplied('deleteReply')
      }),
    )

    // showModal — the first response of a command or a component, like reply()
    if (instance.type === InteractionType.ApplicationCommand || instance.type === InteractionType.MessageComponent) {
      stubs.set(
        'showModal',
        createMockFn(async () => {
          if (instance.deferred || instance.replied) throw alreadyReplied()
          instance.replied = true
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
  }

  // Ids and a user, as Discord always sends; no server unless the test names one, as in a direct message
  if (BaseInteraction.prototype.isPrototypeOf(instance)) {
    const unset = (key: string) => !Object.prototype.hasOwnProperty.call(instance, key)
    const generatedId = unset('id') ? (instance.id = nextSnowflake()) : undefined
    defineCreatedTime(instance, generatedId)
    if (unset('user')) instance.user = mockUser()
    if (unset('channelId')) instance.channelId = nextSnowflake()
    if (unset('guildId')) {
      instance.guildId = null
      if (unset('guild')) Object.defineProperty(instance, 'guild', { value: null, writable: true, configurable: true })
    }
    // The user as a member while the mock has a guildId, as discord.js has one for an interaction in a server
    let member: unknown
    if (unset('member')) {
      Object.defineProperty(instance, 'member', {
        get: () => (own('guildId') ? (member ??= memberOf(own('user'))) : null),
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
 * @remarks
 * Every property is a mock function created on first access, and the result is assignable to `T`. Values passed as
 * `props` are used as given rather than wrapped in mock functions.
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
 * Use it for the member a command acts on, such as a user option's value, or a message's author.
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
export const createMockUser = (): DeepMocked<User> => createMockInteraction(User, { id: nextSnowflake(), bot: false })

/**
 * Creates a mock {@link Client}, with `users`, `channels`, `guilds` and `application.commands` ready to stub.
 *
 * Use it when code under test reaches the client, such as to DM a user or fetch a channel, or to address messages to
 * the bot. A mock message or interaction built without one gets a client of its own.
 *
 * @remarks
 * Its managers' methods resolve as discord.js's do: `users.send()` to a mock message, `users.fetch(id)` to a mock
 * user, `channels.fetch(id)` to a mock text channel, and a list fetch to an empty collection. `users.cache` and
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
 * @remarks
 * A manager's `fetch(id)`, `create()` and `edit()` resolve to a mock of its item, and a list fetch to an empty
 * collection. Members, roles and channels given are put in their managers' caches, where dispatch looks first when it
 * resolves a message's typed params. The guild is named `'Guild'` and its `preferredLocale` is `'en-US'` unless given,
 * so `t.forGuild(guild)` translates as for a new English server.
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
  instance.roles = managerWith(RoleManager.prototype, overrides.roles as never)
  instance.bans = stubDeep(Object.create(GuildBanManager.prototype))

  return stubDeep(instance) as DeepMocked<Guild>
}

/**
 * Creates a mock channel of the given class, such as `TextChannel`, `ThreadChannel` or `DMChannel`.
 *
 * Use it for a channel a handler reads or posts to, such as one it fetches messages from or opens a thread in.
 *
 * @remarks
 * The managers the class has are ready to stub: `messages`, `threads` on text, announcement, forum and media channels,
 * and `members` on threads. A subclass gets the managers of the class it extends.
 *
 * @param Class - The discord.js channel class to mock.
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
export function createMockChannel<T extends BaseChannel>(Class: InteractionClass<T>): DeepMocked<T> {
  const instance = Object.create(Class.prototype) as Record<string, unknown>
  instance.id = nextSnowflake()
  const is = (Base: { prototype: object }) => Base.prototype.isPrototypeOf(Class.prototype) || Class === Base

  // Text and announcement channels: messages, and threads made in the channel
  if (is(TextChannel) || is(NewsChannel)) {
    instance.messages = stubDeep(Object.create(GuildMessageManager.prototype))
    instance.threads = stubDeep(Object.create(GuildTextThreadManager.prototype))
  }
  // Forum and media channels hold posts, each a thread started with its first message
  if (is(ForumChannel) || is(MediaChannel)) {
    instance.threads = stubDeep(Object.create(GuildForumThreadManager.prototype))
  }
  if (is(DMChannel)) {
    instance.messages = stubDeep(Object.create(DMMessageManager.prototype))
  }
  if (is(ThreadChannel)) {
    instance.messages = stubDeep(Object.create(GuildMessageManager.prototype))
    instance.members = stubDeep(Object.create(ThreadMemberManager.prototype))
  }

  return stubDeep(instance) as DeepMocked<T>
}

/** A member of a server, as the given user. */
function memberOf(user: unknown): object {
  return stubDeep(Object.assign(Object.create(GuildMember.prototype) as object, { user }))
}

/** The guild a mock message carries: a guild with the same stubbed managers as createMockGuild. */
function createMockGuildForMessage(): object {
  const guild = Object.create(Guild.prototype) as Record<string, unknown>
  guild.id = nextSnowflake()
  guild.members = managerWith(GuildMemberManager.prototype, undefined)
  guild.channels = managerWith(GuildChannelManager.prototype, undefined)
  guild.roles = managerWith(RoleManager.prototype, undefined)
  guild.bans = stubDeep(Object.create(GuildBanManager.prototype))
  return stubDeep(guild)
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
  /** Its top-level components: action rows, or Components V2 such as a container. */
  components?: readonly (APIMessageTopLevelComponent | JSONEncodable<APIMessageTopLevelComponent>)[]
  /** Its embeds. */
  embeds?: readonly (APIEmbed | JSONEncodable<APIEmbed>)[]
  /** Its flags: a number, flag names or a `MessageFlagsBitField`. */
  flags?: MessageFlagsResolvable
  /** The guild it was sent in, such as one from `createMockGuild` with members in its cache; `null` for a DM. */
  guild?: Guild | null
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
            cached(guildCaches.members, id, () => {
              const user = cached(userCache, id, () => mockUser(id))
              return stubDeep(Object.defineProperties(Object.create(GuildMember.prototype), { id: { value: id }, user: { value: user }, guild: { value: guild } }))
            }),
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
 * and `reply()` resolve to a new mock message. Without overrides the message is empty, in a server, with its author
 * as its `member`; with `guild: null` it is a direct message. The users, roles and channels the content mentions are
 * cached as the gateway delivers them.
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
  instance.author = mockUser()

  // Getters on the prototype — the proxy sees them as functions and returns
  // a mock fn, which is wrong. Pre-initialize as own properties to shadow
  // the prototype getters.
  const channel = stubDeep(Object.assign(Object.create(TextChannel.prototype), { id: nextSnowflake() })) as { id: string }
  const guild = (overrides.guild === undefined ? createMockGuildForMessage() : overrides.guild) as { id: string } | null
  Object.defineProperty(instance, 'channel', { value: channel, writable: true })
  Object.defineProperty(instance, 'guild', { value: guild, writable: true })
  // The author as a member of the message's server; a direct message has none
  Object.defineProperty(instance, 'member', { value: guild ? memberOf(instance.author) : null, writable: true })
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
  const userCache = cacheOf(client.users)
  for (const user of overrides.users ?? []) userCache?.set(user.id, user)

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
  if (typeof value === 'number') return ApplicationCommandOptionType.Number
  if (value instanceof User) return ApplicationCommandOptionType.User
  if (value instanceof GuildMember) return ApplicationCommandOptionType.User
  if (value instanceof Role) return ApplicationCommandOptionType.Role
  if (value instanceof BaseChannel) return ApplicationCommandOptionType.Channel
  if (value instanceof Attachment) return ApplicationCommandOptionType.Attachment
  if (typeof value === 'object' && value !== null) return ApplicationCommandOptionType.Mentionable
  return ApplicationCommandOptionType.String
}

/**
 * Shapes one supplied option the way the gateway sends it.
 *
 * An entity option arrives as a snowflake in `value` *and* as the resolved object on
 * its own field, and code that reads only one of the two is exactly what this lets a
 * test catch — so both are set.
 */
function toOptionData(name: string, value: ChatInputOptions[string]): CommandInteractionOption {
  const type = optionTypeOf(value)
  const isEntity = typeof value === 'object' && value !== null

  const option: Record<string, unknown> = { name, type, value: isEntity ? value.id : value }

  if (value instanceof User) option.user = value
  else if (value instanceof GuildMember) option.member = value
  else if (value instanceof Role) option.role = value
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
): CommandInteractionOption[] {
  const leaves = Object.entries(values).map(([name, value]) => toOptionData(name, value))

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
 * @remarks
 * Every method is a mock function, and methods not listed, such as `getAttachment`, are stubbed automatically. An
 * entity option carries its id in `value` and the object itself, as the gateway sends it.
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
  base.getInteger = createMockFn<(name: string, required?: boolean) => number | null>(
    (name: string, required?: boolean) =>
      resolveOrThrow(name, typeof values[name] === 'number' ? (values[name] as number) : null, required),
  )
  base.getBoolean = createMockFn<(name: string, required?: boolean) => boolean | null>(
    (name: string, required?: boolean) =>
      resolveOrThrow(name, typeof values[name] === 'boolean' ? (values[name] as boolean) : null, required),
  )

  const getObjectOption = (name: string, required?: boolean) =>
    resolveOrThrow(name, isObjectOption(values[name]) ? (values[name] as { id: string }) : null, required)

  base.getUser = createMockFn<(name: string, required?: boolean) => { id: string } | null>(getObjectOption)
  base.getRole = createMockFn<(name: string, required?: boolean) => { id: string } | null>(getObjectOption)
  base.getChannel = createMockFn<(name: string, required?: boolean) => { id: string } | null>(getObjectOption)
  base.getMember = createMockFn<(name: string, required?: boolean) => { id: string } | null>(getObjectOption)
  base.getMentionable = createMockFn<(name: string, required?: boolean) => { id: string } | null>(getObjectOption)

  base.getFocused = createMockFn((getFull?: boolean) => {
    if (focused === null) throw new Error('No focused option found.')
    const option = toOptionData(focused, values[focused] ?? null)
    return getFull === true ? { ...option, focused: true } : option.value
  })

  // `data` is what the framework reads to build a handler's params, and it is the one
  // part of the resolver that is not a method — so it has to be materialised here
  // rather than auto-stubbed, or every params assertion would see an empty record.
  base.data = buildOptionData(subcommandGroup, subcommand, values)

  return stubDeep(base) as unknown as DeepMocked<CommandInteractionOptionResolver<Cached>>
}
