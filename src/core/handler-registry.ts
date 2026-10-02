import 'reflect-metadata'
import { type ClientEvents, type Message, type RESTPostAPIApplicationCommandsJSONBody } from 'discord.js'
import { type MetadataDecorator } from '@src/common/metadata.js'
import { HandlerExecutionContext } from '@src/common/execution-context.js'
import {
  getAutocompleteHandlers,
  getCommandMap,
  getMessageHandlers,
  getReactionHandlers,
} from '@src/decorator/controller.decorator.js'
import { getEventHandlers } from '@src/decorator/event.decorator.js'
import { CommandType } from '@src/enum/index.js'
import { type MessageCommandOptions, type MessageHandlerOptions, type MessageHelp, type MessageScope } from '@src/interface/index.js'
import {
  afterStart,
  buildMessageRoutes,
  commandWordsOf,
  type MessagePattern,
  type MessageRoute,
  messageStarts,
  parseMessagePattern,
} from '@src/core/message-routes.js'
import { computeMessageHelp, effectiveScope, helpInvocation } from '@src/core/message-help.js'
import { commandNameOf, registrationKey, SENT_AS, serialise } from '@src/core/command-registration.js'
import { type CommandMeta } from '@src/interface/command-decorator.interface.js'
import { messageLocale, textRenderer } from '@src/common/meocord-text.js'
import { type Translator } from '@src/common/translator.js'
import { usageOf } from '@src/core/message-params.js'

type HandlerClass = new (...args: any[]) => unknown

/**
 * The kind of handler a {@link HandlerEntry} describes, such as `'command'` or `'message'`.
 *
 * Pass one to {@link HandlerRegistry.list} to list only that kind; the entries it returns are narrowed to it.
 *
 * @group Controllers
 * @see {@link HandlerFilter}
 */
export type HandlerKind = 'command' | 'component' | 'modal' | 'autocomplete' | 'message' | 'reaction' | 'event'

interface HandlerEntryBase {
  /** The controller or service declaring the handler. */
  controller: HandlerClass
  /** The name of the handler method. */
  method: string
  /**
   * Reads a metadata decorator's value for the handler: the method's value, else the controller's, as
   * `ExecutionContext.get` does.
   */
  get<T>(metadata: MetadataDecorator<T>): T | undefined
  /**
   * Reads the value stored under a metadata key for the handler, the method's before the controller's.
   *
   * @deprecated Since 4.1, and removed in the next major version (5.0). Use `get(metadata)` instead. Its `metadata` is
   * a decorator made by `createMetadata`, whose value is typed and whose key cannot collide with another.
   */
  get<T = unknown>(key: string | symbol): T | undefined
  /** Reads every value a metadata decorator declared for the handler, the method's first, then the controller's. */
  getAll<T>(metadata: MetadataDecorator<T>): T[]
  /**
   * Reads every value stored under a metadata key for the handler, the method's first, then the controller's.
   *
   * @deprecated Since 4.1, and removed in the next major version (5.0). Use `getAll(metadata)` instead. Its `metadata`
   * is a decorator made by `createMetadata`, whose values are typed and whose key cannot collide with another.
   */
  getAll<T = unknown>(key: string | symbol): T[]
}

/**
 * A registered slash command, subcommand, context menu command or entry point command, as the registry lists it.
 *
 * @group Controllers
 * @see {@link HandlerRegistry}
 */
export interface CommandHandlerEntry extends HandlerEntryBase {
  /** Marks a command, so `kind` narrows a {@link HandlerEntry} to this type. */
  kind: 'command'
  /** The `CommandType` the handler is declared with. */
  commandType: CommandType
  /** The command's name, or a subcommand's full path such as `settings notify email`. */
  name: string
  /** The registered command's JSON, the top-level command's for a subcommand. */
  command?: RESTPostAPIApplicationCommandsJSONBody
  /** The command's description, a subcommand's own for a subcommand; `undefined` for a context menu command. */
  description?: string
}

/**
 * A registered button or select menu handler, as the registry lists it.
 *
 * @group Controllers
 * @see {@link HandlerRegistry}
 */
export interface ComponentHandlerEntry extends HandlerEntryBase {
  /** Marks a component handler, so `kind` narrows a {@link HandlerEntry} to this type. */
  kind: 'component'
  /** The `CommandType` the handler is declared with. */
  commandType: CommandType
  /** The customId pattern, such as `profile/{uid}`. */
  name: string
}

/**
 * A registered modal submit handler, as the registry lists it.
 *
 * @group Controllers
 * @see {@link HandlerRegistry}
 */
export interface ModalHandlerEntry extends HandlerEntryBase {
  /** Marks a modal handler, so `kind` narrows a {@link HandlerEntry} to this type. */
  kind: 'modal'
  /** Always `CommandType.MODAL_SUBMIT`. */
  commandType: CommandType.MODAL_SUBMIT
  /** The customId pattern. */
  name: string
}

/**
 * A registered `@Autocomplete` handler, as the registry lists it.
 *
 * @group Controllers
 * @see {@link HandlerRegistry}
 */
export interface AutocompleteHandlerEntry extends HandlerEntryBase {
  /** Marks an autocomplete handler, so `kind` narrows a {@link HandlerEntry} to this type. */
  kind: 'autocomplete'
  /** The command path, followed by the option name when the handler completes one option only. */
  name: string
}

/**
 * A registered `@MessageHandler`, a message command or a listener for every message, as the registry lists it.
 *
 * A message command is listed once, with its aliases, description, scope and usage, which is what a help
 * command needs.
 *
 * @group Controllers
 * @see {@link HandlerRegistry}
 */
export interface MessageHandlerEntry extends HandlerEntryBase {
  /** Marks a message handler, so `kind` narrows a {@link HandlerEntry} to this type. */
  kind: 'message'
  /** The pattern, or `undefined` for a handler that takes every message. */
  name: string | undefined
  /** The command words the pattern begins with, such as `config set`; `undefined` when it begins with a param. */
  command: string | undefined
  /** The other command words the handler takes, from its `aliases` option. */
  aliases: readonly string[]
  /** What the command does, from its `description` option. */
  description: string | undefined
  /** Where the command works: its `scope` option, narrowed to servers by a `member`, `role` or `channel` param or flag. */
  scope: MessageScope
  /** Whether its `hidden` option leaves it out of help's lists, including a parent's list of subcommands. */
  hidden: boolean
  /**
   * The command as a user types it, after `prefix`: `usage('!')` gives `!ban <target> [duration] [reason…]`.
   * `undefined` for a handler that takes every message.
   */
  usage(prefix?: string): string | undefined
  /**
   * Whether words name this command or one of its aliases, as a help command's argument does: `ban` or `b`.
   * Compared in any case unless the handler, or the app, is case-sensitive.
   */
  matches(words: string): boolean
}

/**
 * A registered `@ReactionHandler`, as the registry lists it.
 *
 * @group Controllers
 * @see {@link HandlerRegistry}
 */
export interface ReactionHandlerEntry extends HandlerEntryBase {
  /** Marks a reaction handler, so `kind` narrows a {@link HandlerEntry} to this type. */
  kind: 'reaction'
  /** The emoji, or `undefined` for a handler that takes every reaction. */
  name: string | undefined
}

/**
 * A registered `@On` or `@Once` handler, as the registry lists it.
 *
 * @group Controllers
 * @see {@link HandlerRegistry}
 */
export interface EventHandlerEntry extends HandlerEntryBase {
  /** Marks an event handler, so `kind` narrows a {@link HandlerEntry} to this type. */
  kind: 'event'
  /** The client event. */
  name: keyof ClientEvents
  /** Whether it handles only the first time the event is emitted. */
  once: boolean
}

/**
 * One registered handler, as {@link HandlerRegistry.list} gives it, narrowed by its `kind`.
 *
 * Every entry names its controller and method, and reads the metadata declared on it with `get` and `getAll`.
 *
 * @group Controllers
 * @see {@link HandlerRegistry}
 */
export type HandlerEntry =
  | CommandHandlerEntry
  | ComponentHandlerEntry
  | ModalHandlerEntry
  | AutocompleteHandlerEntry
  | MessageHandlerEntry
  | ReactionHandlerEntry
  | EventHandlerEntry

/**
 * What {@link HandlerRegistry.list} lists: handlers of one kind, of one controller, or both.
 *
 * @group Controllers
 * @see {@link HandlerRegistry}
 */
export interface HandlerFilter<K extends HandlerKind = HandlerKind> {
  /** Only handlers of this kind. */
  kind?: K
  /** Only handlers declared by this controller or service. */
  controller?: HandlerClass
}

const COMMAND_TYPES = new Set<CommandType>([CommandType.SLASH, CommandType.CONTEXT_MENU, CommandType.PRIMARY_ENTRY_POINT])

/**
 * What a builder registers, from discord.js's builder or the REST body it returns, or `undefined` for none, or for a
 * builder missing a field, which registration reports.
 */
function builderJson(builder: CommandMeta['builder']): RESTPostAPIApplicationCommandsJSONBody | undefined {
  if (!builder) return undefined
  try {
    return serialise(builder) as RESTPostAPIApplicationCommandsJSONBody
  } catch {
    return undefined
  }
}

/** The description of the command or subcommand at `path` within a command's JSON. */
function describe(json: RESTPostAPIApplicationCommandsJSONBody | undefined, path: string): string | undefined {
  interface Described {
    name?: string
    description?: string
    options?: Described[]
  }
  let node = json as Described | undefined
  for (const segment of path.split(' ').slice(1)) {
    node = node?.options?.find(option => option.name === segment)
  }
  return node?.description
}

/** What a message handler's entry says about its command, read from its pattern and options. */
function messageCommand(
  pattern: string | undefined,
  options: MessageHandlerOptions,
  messages: MessageCommandOptions,
): Pick<MessageHandlerEntry, 'command' | 'aliases' | 'description' | 'scope' | 'hidden' | 'usage' | 'matches'> {
  let parsed: MessagePattern | undefined
  try {
    parsed = pattern === undefined ? undefined : parseMessagePattern(pattern)
  } catch {
    // Startup refuses a pattern that cannot be read, naming the handler
  }
  const command = parsed && commandWordsOf(parsed.tokens).join(' ')
  const aliases = (options.aliases ?? []).map(alias => alias.trim())
  const exact = options.caseSensitive ?? messages.caseSensitive ?? false
  const key = (words: string) => {
    const joined = words.trim().split(/\s+/).join(' ')
    return exact ? joined : joined.toLowerCase()
  }
  const names = new Set([command, ...aliases].filter(Boolean).map(name => key(name!)))
  return {
    command: command || undefined,
    aliases,
    description: options.description,
    scope: effectiveScope({ scope: options.scope ?? 'any', tokens: parsed?.tokens ?? [], flags: parsed?.flags ?? [] }),
    hidden: options.hidden ?? false,
    usage: (prefix = '') => parsed && usageOf(parsed, prefix),
    matches: words => names.has(key(words)),
  }
}

/** The message routes the app's dispatcher reads, by the app's registry, so its help and dispatch read one table. */
const dispatchedRoutes = new WeakMap<HandlerRegistry, readonly MessageRoute[]>()

/** Has `registry` work out message help from `routes`, the table the app's dispatcher routes messages with. */
export function shareMessageRoutes(registry: HandlerRegistry, routes: readonly MessageRoute[]): void {
  dispatchedRoutes.set(registry, routes)
}

/**
 * Lists every handler the app registered, with the metadata declared on it.
 *
 * Inject it to build what reads the app's own handlers: a help command, an admin page or generated docs. To act
 * on a handler's metadata while it runs, read it from {@link ExecutionContext} instead.
 *
 * @remarks
 * It lists commands, one entry per subcommand path, and components, modals, autocomplete, message, reaction and
 * event handlers, on every controller and service the app binds. A message command is listed once, with its
 * aliases, description, scope and usage.
 *
 * @example
 * ```ts
 * @Service()
 * export class HelpService {
 *   constructor(private readonly handlers: HandlerRegistry) {}
 *
 *   // `!help` lists the message commands; `!help ban` shows one
 *   messageHelp(command?: string) {
 *     const commands = this.handlers.list({ kind: 'message' }).filter(entry => entry.command)
 *     const one = command ? commands.find(entry => entry.matches(command)) : undefined
 *     if (one) return [one.usage('!'), one.description].filter(Boolean).join('\n')
 *     return commands.map(entry => `${entry.usage('!')}: ${entry.description ?? ''}`).join('\n')
 *   }
 * }
 * ```
 *
 * @group Controllers
 * @see {@link HandlerEntry}
 * @see {@link https://meocord.dev/docs/4.1/handler-discovery | Handler discovery}
 */
export class HandlerRegistry {
  private entries?: HandlerEntry[]
  /** Built from `classes` for a registry no dispatcher shares its routes with. */
  private messageRoutes?: MessageRoute[]

  /**
   * @param classes - The app's classes to read handlers from. The factory fills the list
   *   once the app is bound; entries are read on the first {@link list}.
   * @param messages - The app's `messages` options, whose `caseSensitive` message entries' `matches` follows.
   * @param translator - The app's translator, read when {@link messageHelp} words its labels; none for English.
   */
  constructor(
    private readonly classes: readonly HandlerClass[],
    private readonly messages: MessageCommandOptions = {},
    private readonly translator: () => Translator<any> | undefined = () => undefined,
  ) {}

  /**
   * Lists the registered handlers.
   *
   * @param filter - Narrows the list by kind, controller, or both.
   * @returns The handlers, class by class in the order the app makes its classes, each after what it injects.
   */
  list<K extends HandlerKind = HandlerKind>(filter: HandlerFilter<K> = {}): Extract<HandlerEntry, { kind: K }>[] {
    this.entries ??= this.collect()
    return this.entries.filter(
      entry =>
        (filter.kind === undefined || entry.kind === filter.kind) &&
        (filter.controller === undefined || entry.controller === filter.controller),
    ) as Extract<HandlerEntry, { kind: K }>[]
  }

  /**
   * Works out what the built-in help would answer a message, for a help command of your own.
   *
   * It lists the message commands of the app's controllers that work where the message was sent, or describes the
   * one `query` names, with the same routes and rules the built-in follows: hidden and guarded handlers are left out
   * of lists, and shown when named. It works whether `messages.help` is on or off.
   *
   * @param message - The message asking for help; its start and where it was sent decide what is listed.
   * @param query - The command asked about, such as `ban` or `config set`; leave it out to list them all.
   * @returns The help, as the presenter's `messageHelp` receives it.
   *
   * @example
   * ```ts
   * @MessageHandler('help {command...?}')
   * async help(message: Message, { command }: { command?: string }) {
   *   const help = await this.handlers.messageHelp(message, command)
   *   if (help.kind === 'list') await message.reply(help.commands.map(entry => `**${entry.usage}** ${entry.description ?? ''}`).join('\n'))
   *   else await message.reply(help.kind === 'unknown' ? `No command is called ${help.query}.` : 'Ask a moderator.')
   * }
   * ```
   */
  async messageHelp(message: Message, query?: string): Promise<MessageHelp> {
    const routes = dispatchedRoutes.get(this) ?? (this.messageRoutes ??= buildMessageRoutes([...this.classes], this.messages))
    const starts = await messageStarts(this.messages, message, message.client?.user?.id)
    const text = (message.content ?? '').trim()
    const rest = afterStart(text, starts.prefixes.filter(prefix => prefix !== ''), starts.mention, this.messages.caseSensitive ?? false)
    // The start the message used, else the one a caller would type: the app's first prefix, or a mention
    const start =
      rest !== undefined
        ? text.slice(0, text.length - rest.length)
        : (starts.prefixes.find(prefix => prefix !== '') ?? (starts.mention ? `<@${starts.mention}> ` : ''))
    return computeMessageHelp(
      routes,
      { start, query: query?.trim() ?? '', starts, invocation: helpInvocation(start, this.messages.help) },
      this.messages.types,
      textRenderer(this.translator(), messageLocale(message)),
    )
  }

  private collect(): HandlerEntry[] {
    // Each built command by type and name, as Discord tells them apart, for the handlers with no builder of their own
    const commandJson = new Map<string, RESTPostAPIApplicationCommandsJSONBody>()
    for (const cls of this.classes) {
      for (const [name, metas] of Object.entries(getCommandMap(cls.prototype) ?? {})) {
        for (const { builder } of metas) {
          const json = builderJson(builder)
          const key = json && registrationKey(json, name)
          if (key && !commandJson.has(key)) commandJson.set(key, json)
        }
      }
    }
    const builtFor = (type: CommandType, name: string) =>
      (SENT_AS[type] ?? []).map(sentAs => commandJson.get(`${sentAs}:${commandNameOf(type, name)}`)).find(Boolean)

    const entries: HandlerEntry[] = []
    for (const controller of this.classes) {
      const prototype = controller.prototype as object
      const base = (method: string) => {
        const context = new HandlerExecutionContext({ controller, methodName: method, args: [] })
        return {
          controller,
          method,
          get: context.get.bind(context),
          getAll: context.getAll.bind(context),
        } as HandlerEntryBase
      }

      for (const [name, metas] of Object.entries(getCommandMap(prototype) ?? {})) {
        for (const { methodName, type, builder } of metas) {
          if (COMMAND_TYPES.has(type)) {
            const command = builderJson(builder) ?? builtFor(type, name)
            const description = describe(command, name)
            entries.push({ ...base(methodName), kind: 'command', commandType: type, name, command, description })
          } else if (type === CommandType.MODAL_SUBMIT) {
            entries.push({ ...base(methodName), kind: 'modal', commandType: type, name })
          } else {
            entries.push({ ...base(methodName), kind: 'component', commandType: type, name })
          }
        }
      }
      for (const { commandPath, optionName, methodName } of getAutocompleteHandlers(prototype)) {
        const name = optionName === undefined ? commandPath : `${commandPath} ${optionName}`
        entries.push({ ...base(methodName), kind: 'autocomplete', name })
      }
      for (const { pattern, method, options } of getMessageHandlers(prototype)) {
        entries.push({ ...base(method), kind: 'message', name: pattern, ...messageCommand(pattern, options, this.messages) })
      }
      for (const { emoji, method } of getReactionHandlers(prototype)) {
        entries.push({ ...base(method), kind: 'reaction', name: emoji })
      }
      for (const { event, method, once } of getEventHandlers(prototype)) {
        entries.push({ ...base(method), kind: 'event', name: event, once })
      }
    }
    return entries
  }
}
