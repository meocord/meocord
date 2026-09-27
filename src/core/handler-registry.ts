import 'reflect-metadata'
import { type ClientEvents, type RESTPostAPIApplicationCommandsJSONBody } from 'discord.js'
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
import { type MessageCommandOptions, type MessageHandlerOptions, type MessageScope } from '@src/interface/index.js'
import { commandWordsOf, type MessagePattern, parseMessagePattern } from '@src/core/message-routes.js'
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
  /** Reads the value stored under a metadata key for the handler, the method's before the controller's. */
  get<T = unknown>(key: string | symbol): T | undefined
  /** Reads every value a metadata decorator declared for the handler, the method's first, then the controller's. */
  getAll<T>(metadata: MetadataDecorator<T>): T[]
  /** Reads every value stored under a metadata key for the handler, the method's first, then the controller's. */
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
  /** Where the command works, from its `scope` option. */
  scope: MessageScope
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

/** A builder's JSON, or `undefined` for none, or for a builder missing a field, which registration reports. */
function builderJson(builder: unknown): RESTPostAPIApplicationCommandsJSONBody | undefined {
  const toJSON = (builder as { toJSON?: () => RESTPostAPIApplicationCommandsJSONBody } | undefined)?.toJSON
  if (typeof toJSON !== 'function') return undefined
  try {
    return toJSON.call(builder)
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
): Pick<MessageHandlerEntry, 'command' | 'aliases' | 'description' | 'scope' | 'usage' | 'matches'> {
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
    scope: options.scope ?? 'any',
    usage: (prefix = '') => parsed && usageOf(parsed, prefix),
    matches: words => names.has(key(words)),
  }
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

  /**
   * @param classes - The controllers and services to read handlers from. The factory fills the list
   *   once the app is bound; entries are read on the first {@link list}.
   * @param messages - The app's `messages` options, whose `caseSensitive` message entries' `matches` follows.
   */
  constructor(
    private readonly classes: readonly HandlerClass[],
    private readonly messages: MessageCommandOptions = {},
  ) {}

  /**
   * Lists the registered handlers.
   *
   * @param filter - Narrows the list by kind, controller, or both.
   * @returns The handlers, in the order their controllers and services were bound.
   */
  list<K extends HandlerKind = HandlerKind>(filter: HandlerFilter<K> = {}): Extract<HandlerEntry, { kind: K }>[] {
    this.entries ??= this.collect()
    return this.entries.filter(
      entry =>
        (filter.kind === undefined || entry.kind === filter.kind) &&
        (filter.controller === undefined || entry.controller === filter.controller),
    ) as Extract<HandlerEntry, { kind: K }>[]
  }

  private collect(): HandlerEntry[] {
    const commandJson = new Map<string, RESTPostAPIApplicationCommandsJSONBody>()
    for (const cls of this.classes) {
      for (const metas of Object.values(getCommandMap(cls.prototype) ?? {})) {
        for (const { builder } of metas) {
          const json = builderJson(builder)
          if (json && !commandJson.has(json.name)) commandJson.set(json.name, json)
        }
      }
    }

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
            const command = builderJson(builder) ?? commandJson.get(name.split(' ')[0])
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
