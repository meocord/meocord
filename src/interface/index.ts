import {
  BaseInteraction,
  type Client,
  type GuildBasedChannel,
  type GuildMember,
  type Role,
  type ColorResolvable,
  type Interaction,
  type JSONEncodable,
  type APIComponentInContainer,
  type AttachmentBuilder,
  Message,
  MessageReaction,
  type MessageReplyOptions,
  type PartialUser,
  User,
} from 'discord.js'
import { type RsbuildConfig as RsbuildCoreConfig } from '@rsbuild/core'

/**
 * Rsbuild's configuration, as `meocord.config.ts`'s `rsbuild` hook receives and returns it.
 *
 * Import it from here to type a helper for that hook without depending on `@rsbuild/core` yourself.
 *
 * @example
 * ```ts
 * const markdownAsText = (config: RsbuildConfig) => {
 *   config.tools ??= {}
 *   config.tools.rspack = (_rspack, { addRules }) => {
 *     addRules([{ test: /\.md$/i, type: 'asset/source' }])
 *   }
 *   return config
 * }
 *
 * export default { discordToken: process.env.DISCORD_TOKEN!, rsbuild: markdownAsText } satisfies MeoCordConfig
 * ```
 *
 * @group Configuration
 * @category Config file
 * @see {@link MeoCordConfig}
 */
export type RsbuildConfig = RsbuildCoreConfig
import { ReactionHandlerAction } from '@src/enum/controller.enum.js'
import { type ExecutionContext } from '@src/common/execution-context.js'
import { type DeepReadonly, type MeoCordTheme } from '@src/interface/theme.interface.js'
import { type MEOCORD_MESSAGES } from '@src/common/meocord-messages.js'

/**
 * What a guard implements: `canActivate`, which decides whether the handler runs.
 *
 * Implement it on a class marked with {@link Guard}, and apply the class with {@link UseGuard}.
 *
 * @remarks
 * Before an `@Autocomplete` handler, a class-level or global guard receives an `AutocompleteInteraction` and
 * must not answer it: returning `false` closes the menu with an empty list. Before an `@On` or `@Once` handler,
 * it receives the event's arguments, such as a `GuildMember` for `guildMemberAdd`. `@Guard({ types })` limits a
 * guard to the calls it is written for.
 *
 * @pipeline guards where `@UseGuard` or `@MeoCord({ guards })` applies the class
 * @group Types
 * @see {@link Guard}
 * @see {@link UseGuard}
 */
export interface GuardInterface {
  /**
   * Decides whether the guarded handler runs.
   *
   * @param context - The interaction, message or reaction being handled, or an event's first argument.
   * @param args - The handler's remaining arguments, such as the params parsed from a customId.
   * @returns `true` to run the handler, `false` to skip it.
   */
  canActivate(context: BaseInteraction | Message | MessageReaction | unknown, ...args: any[]): Promise<boolean> | boolean
}

/**
 * The application {@link MeoCordFactory.create} returns: a bot in one process, or the manager of a process per shard.
 *
 * `main.ts` starts it and nothing else needs it: which of the two it is follows from `meocord.config.ts`'s
 * `sharding`, and both start and register commands the same way.
 *
 * @example
 * ```ts
 * @MeoCord({ controllers: [], clientOptions: { intents: [GatewayIntentBits.Guilds] } })
 * class App {}
 *
 * const app: MeoCordApplication = MeoCordFactory.create(App)
 * await app.start()
 * ```
 *
 * @group Controllers
 * @see {@link MeoCordFactory}
 */
export interface MeoCordApplication {
  /**
   * Starts the bot: resolves its providers and logs in, or with process sharding, spawns the shards,
   * each of which does so.
   *
   * A call while one is under way waits for it, and a call once the bot is online does nothing.
   * Retrying it after a failed login is deprecated; in the next major version (5.0) it rejects. Use
   * `MeoCordFactory.create` to make a new app instead. A retry after a provider's factory failed stays supported.
   *
   * A shard whose start fails exits 1 once the rejection is handled, and its manager restarts it. When MeoCord refuses
   * the app, which it would in every shard, the manager logs why, stops every shard and exits 1 instead.
   *
   * @returns A promise that resolves once the bot is logged in, or every shard has been spawned.
   * @throws For a bot in one process, the error of a provider's factory that failed, or the login
   *   error, such as an invalid token. A start that `stop()` ends rejects, and so does a start of an app already
   *   stopped.
   */
  start(): Promise<void>

  /**
   * Stops the bot without ending the process: runs the `onShutdown` hooks under the configured `shutdownTimeout`
   * and closes the client, or with process sharding, asks every shard to shut down and waits for it. A stop while
   * the bot starts ends that start, a call after the first waits for it, and a stopped app does not start again.
   *
   * @returns A promise that resolves once the bot is stopped. It never rejects: a failure to close is logged.
   */
  stop(): Promise<void>

  /**
   * Registers the application's commands with Discord, where `meocord.config.ts`'s `commands` says.
   * A failure is logged rather than thrown.
   */
  registerCommands(): Promise<void>
}

/**
 * What `onReady` learns about its process, beside the client: whether it should do one-off work.
 *
 * @group Types
 * @see {@link OnReady}
 */
export interface ReadyInfo {
  /**
   * Whether this process should do one-off work, such as starting a scheduler that must run once.
   * `true` for a bot running in one process, and in process sharding for the process holding shard 0
   * only.
   */
  primary: boolean
}

/**
 * A controller, service or provided value that does work once the bot is online, such as starting timers.
 *
 * Implement it for work that needs the ready client: a scheduler, a warmed cache, the bot's activity. For work in
 * response to Discord, use `@On` with a client event instead; to clean up, implement {@link OnShutdown}.
 *
 * @remarks
 * Called on every controller and service the app binds, including services no handler has used yet, and on every
 * value `@MeoCord({ providers })` provides, after the client is ready. Hooks run one at a time in dependency
 * order, so a service's hook runs after the hooks of the services it injects. Command registration runs alongside
 * and never delays them. A hook that throws is logged and the next one still runs.
 *
 * @example
 * ```ts
 * @Service()
 * export class ServerCountReporter implements OnReady, OnShutdown {
 *   private readonly logger = new Logger(ServerCountReporter.name)
 *   private timer?: NodeJS.Timeout
 *
 *   onReady(client: Client<true>, { primary }: ReadyInfo) {
 *     // One process reports, however many shards run
 *     if (primary) this.timer = setInterval(() => this.logger.log(`${client.guilds.cache.size} servers`), 60_000)
 *   }
 *
 *   onShutdown() {
 *     clearInterval(this.timer)
 *   }
 * }
 * ```
 *
 * @group Types
 * @see {@link OnShutdown}
 * @see {@link https://meocord.dev/docs/4.1/lifecycle-hooks | Lifecycle hooks}
 */
export interface OnReady {
  /**
   * Runs once the client is ready.
   *
   * @param client - The ready Discord client.
   * @param info - Facts about this process, such as whether it should do one-off work.
   */
  onReady(client: Client<true>, info: ReadyInfo): Promise<void> | void
}

/**
 * A controller, service or provided value that cleans up before the bot stops, such as closing a connection.
 *
 * Implement it to stop what {@link OnReady} started: timers, open connections, writes still buffered.
 *
 * @remarks
 * Called on SIGINT or SIGTERM, before the client is destroyed, and only if `onReady` hooks ran. Hooks
 * run one at a time in reverse dependency order, so a service stops before the services it injects.
 * The whole sequence is limited by `shutdownTimeout` in `meocord.config.ts`; the process then exits
 * whether or not it finished. A hook that throws is logged and the next one still runs.
 *
 * It runs only for a class whose `onReady` has finished, or that has none: a signal that arrives
 * while the ready hooks are running skips the class still starting and those not reached yet, and no
 * further `onReady` starts. An `onReady` that threw counts as finished, so its partial setup is cleaned up.
 *
 * @example
 * ```ts
 * import { appendFile } from 'node:fs/promises'
 *
 * @Service()
 * export class AuditLog implements OnShutdown {
 *   private readonly pending: string[] = []
 *
 *   record(line: string) {
 *     this.pending.push(line)
 *   }
 *
 *   // Writes what is still buffered before the process exits
 *   async onShutdown() {
 *     await appendFile('audit.log', this.pending.splice(0).map(line => `${line}\n`).join(''))
 *   }
 * }
 * ```
 *
 * @group Types
 * @see {@link OnReady}
 * @see {@link https://meocord.dev/docs/4.1/lifecycle-hooks | Lifecycle hooks}
 */
export interface OnShutdown {
  /** Runs before the client is destroyed. */
  onShutdown(): Promise<void> | void
}

/**
 * Runs the rest of a call from inside an interceptor: the next interceptor, then the handler.
 *
 * @group Types
 * @see {@link InterceptorInterface}
 */
export interface CallHandler {
  /**
   * Continues the call. Call it at most once: each call runs the rest of the pipeline, and the
   * handler, again. Return or await what it returns to act on the result. When the interceptor
   * returns first and leaves the promise, or a `then` or `finally` chain from it, without a rejection
   * handler, the call ends when the handler does and fails with what it throws, so its filters see
   * it. A promise it hands to something else, such as `Promise.all`, is that one's to handle.
   *
   * @returns What the handler returns, once it has run. Rejects with what the handler throws.
   */
  handle(): Promise<unknown>
}

/**
 * What an interceptor implements: `intercept`, which runs around the handler.
 *
 * Implement it on a class marked with {@link Interceptor}, and apply the class with {@link UseInterceptor}.
 *
 * @remarks
 * It continues with `next.handle()`, at most once, since each call runs the handler again; not calling it skips
 * the handler, and catching what it throws can replace the handler's error. One instance is shared by every
 * call, so per-call state lives in local variables, and a use's params come from `context.getParams()`. A
 * global interceptor also runs around `@On` and `@Once` handlers.
 *
 * @pipeline interceptors where `@UseInterceptor` or `@MeoCord({ interceptors })` applies the class
 * @group Types
 * @see {@link Interceptor}
 * @see {@link CallHandler}
 */
export interface InterceptorInterface {
  /**
   * Runs around the handler.
   *
   * @param context - The call being handled: its arguments, controller, handler and metadata.
   * @param next - Continues with the next interceptor, then the handler.
   * @returns What the call returns: usually the result of `next.handle()`.
   */
  intercept(context: ExecutionContext, next: CallHandler): Promise<unknown> | unknown
}

/**
 * What a presenter renders for a loading view or an error.
 *
 * MeoCord turns it into an embed, or into a Components V2 container on a Components V2 message.
 *
 * @group Responses
 * @category Presenters
 */
export interface ResponseView {
  /** The main text. */
  text: string

  /** A heading above the text. */
  title?: string

  /** The accent colour: the embed colour, or the container's accent. */
  color?: ColorResolvable

  /** An emoji shown before the text, and on the clicked button while it loads. */
  emoji?: string

  /** Further Components V2 content placed in the container, below the text and the view's files. Ignored in an embed. */
  components?: (APIComponentInContainer | JSONEncodable<APIComponentInContainer>)[]

  /**
   * Files sent with the view, such as an image the presenter drew. MeoCord shows them for you: in an embed, the first
   * image is the embed's image; in a Components V2 container, images go in a gallery and other files below the text.
   * A file the view's `components` already show by `attachment://<name>` is not shown again.
   *
   * @remarks
   * Discord takes at most 10 attachments on a message, counting those a message the view is added to keeps, and each
   * file within the interaction's `attachmentSizeLimit`. A view past either is sent without its files, with a warning.
   */
  files?: ResponseFile[]

  /**
   * The view's image, in place of its first image file: the name of one of its `files`, or a URL. In a container, it
   * leads the gallery below the text.
   */
  image?: string

  /** A small image beside the text: the name of one of its `files`, or a URL. In a container, the text's thumbnail. */
  thumbnail?: string
}

/**
 * A file a {@link ResponseView} carries: a discord.js `AttachmentBuilder`, or the file's name and its bytes.
 *
 * @group Responses
 * @category Presenters
 */
export type ResponseFile = AttachmentBuilder | { name: string; data: Buffer | Uint8Array; description?: string }

/**
 * What a presenter knows about the interaction it renders for.
 *
 * @group Responses
 * @category Presenters
 */
export interface ResponseContext {
  /** The interaction being answered. */
  interaction: Interaction

  /** The locale of the user who made the interaction. */
  locale: string

  /** Whether the view is rendered as an embed or as a Components V2 container. */
  mode: 'embed' | 'v2'

  /** The theme of the call being answered, to style the view from: the same one `useTheme()` returns in it. */
  theme: DeepReadonly<MeoCordTheme>
}

/**
 * What a presenter knows about the message command it renders an error reply for, in
 * {@link ResponsePresenter.messageError}.
 *
 * @group Responses
 * @category Presenters
 */
export interface MessageResponseContext {
  /** The message being answered. */
  message: Message

  /** The locale the reply is in: the server's preferred locale, or the translator's default in a DM. */
  locale: string

  /** How the view is rendered: a reply to a message is a new message, drawn as an embed. */
  mode: 'embed'

  /** The theme of the call being answered, to style the view from: the same one `useTheme()` returns in it. */
  theme: DeepReadonly<MeoCordTheme>
}

/**
 * An error a presenter styles: the words a filter chose, and the error itself.
 *
 * @group Responses
 * @category Presenters
 */
export interface PresentedError {
  /** What the user is told. */
  message: string

  /** The error being answered, so a presenter can style it by kind. */
  error: unknown

  /**
   * Which theme colour suits the error: `'warning'` for the user's own outcome, such as a cooldown, a refused
   * guard or a `UserError`, and `'danger'` for a fault in the bot. Read `context.theme.colors[tone]`.
   */
  tone: 'warning' | 'danger'
}

/**
 * Styles MeoCord's own answers: the loading view `@Defer` shows, the error view `respond().error()` shows, and, with
 * `messageError`, the error replies and direct messages the built-in fallback sends a message command's author.
 *
 * Implement it to give those views your bot's look, and register it with `@MeoCord({ presenter })`. It decides how
 * they look, not what they say: filters and the built-in fallback choose the words. A view may carry `files`, such as
 * an image drawn with a canvas library, which MeoCord attaches and shows, and each method may draw asynchronously.
 *
 * @remarks
 * It is resolved once from the container, so it can inject services such as a `Translator`.
 *
 * Should a method throw or reject, or draw a view MeoCord cannot render, MeoCord's own view takes its place and the
 * failure is logged with the presenter's name, so the user is still answered.
 *
 * @example
 * ```ts
 * @Service()
 * export class BrandPresenter implements ResponsePresenter {
 *   loading({ theme }: ResponseContext) {
 *     return { text: 'Working on it…', emoji: theme.emojis.loading, color: theme.colors.primary }
 *   }
 *
 *   error({ theme }: ResponseContext, { message, tone }: PresentedError) {
 *     return { title: 'Something went wrong', text: message, color: theme.colors[tone] }
 *   }
 * }
 * ```
 *
 * @example
 * An error drawn as an image, which MeoCord attaches and shows as the embed's image:
 * ```ts
 * @Service()
 * export class CardPresenter implements ResponsePresenter {
 *   constructor(private readonly cards: CardRenderer) {}
 *
 *   loading() {
 *     return { text: 'Working on it…' }
 *   }
 *
 *   async error(_context: ResponseContext, { message }: PresentedError) {
 *     return { text: message, files: [{ name: 'error.png', data: await this.cards.draw('Oops!', message) }] }
 *   }
 * }
 * ```
 *
 * @group Responses
 * @category Presenters
 */
export interface ResponsePresenter {
  /**
   * The view shown while a handler under `@Defer` works. It may draw it asynchronously: MeoCord acknowledges the
   * interaction first, so a slow drawing never misses Discord's three seconds. The handler waits for it, so a drawing
   * that takes longer than a second is given up on, with a warning, and MeoCord's own loading view is shown.
   */
  loading(context: ResponseContext): ResponseView | Promise<ResponseView>

  /**
   * The view shown for an error. It may draw it asynchronously: an interaction not yet acknowledged is acknowledged
   * first, privately, and the view then replaces the acknowledgement. Discord refusing that acknowledgement, such as
   * for an interaction past its three seconds, is logged as the send it is, never as the presenter failing.
   */
  error(context: ResponseContext, error: PresentedError): ResponseView | Promise<ResponseView>

  /**
   * The view a message command's error reply is drawn as: its usage, a guard's or validation's reason, a `UserError`'s
   * message, and the direct messages `dmOnError` and `dmOnCooldown` send. Without this method they are plain text. The
   * view is sent as an embed, with its files. Should it throw or reject, or return a view MeoCord cannot render, the
   * reply is sent as plain text, and the failure is then reported as the call's fault, as for `error`.
   *
   * @param context - The message being answered, its locale and theme.
   * @param error - The words the fallback chose, the error, and its tone.
   */
  messageError?(context: MessageResponseContext, error: PresentedError): ResponseView | Promise<ResponseView>

  /**
   * The reply to the built-in `help` message command, from what it found; without this method MeoCord writes it in
   * plain text. Return text, or the options `message.reply` takes, such as an embed.
   *
   * @param help - What the caller asked about and what they can use, as {@link MessageHelp} describes it.
   * @param message - The message that asked for help.
   */
  messageHelp?(help: MessageHelp, message: Message): string | MessageReplyOptions | Promise<string | MessageReplyOptions>
}

/**
 * What an exception filter implements: `catch`, which answers an error its `@Catch` names.
 *
 * Implement it on a class marked with {@link Catch}, and apply the class with {@link UseFilter} or
 * `@MeoCord({ filters })`.
 *
 * @remarks
 * It receives errors from the handler, its stages, or dispatch itself. The filter closest to the handler wins:
 * the method's, then the controller's, then the global ones. When none matches, the built-in fallback logs the
 * error and answers the user. One instance is shared by every call.
 *
 * @pipeline filters where `@UseFilter` or `@MeoCord({ filters })` applies the class
 * @group Types
 * @see {@link Catch}
 * @see {@link UseFilter}
 */
export interface ExceptionFilter<E = unknown> {
  /**
   * Handles an error. Returning ends the call; throwing is logged, and the built-in fallback then
   * answers the original error.
   *
   * @param error - The error thrown, of a type the filter's `@Catch` names.
   * @param context - The call that failed. For an interaction no handler was reached for, it has
   *   no controller or handler.
   */
  catch(error: E, context: ExecutionContext): Promise<void> | void
}

/**
 * What a pipe implements: `transform`, which turns one input value into what the handler receives.
 *
 * Implement it on a class marked with {@link Pipe}, and apply the class with {@link UsePipe} or
 * `@Validate(schema, { pipes })`: to turn an id into an account, say. One instance is shared by every call.
 *
 * @typeParam In - The value it receives.
 * @typeParam Out - The value the handler receives in its place.
 *
 * @pipeline pipes where `@UsePipe` or `@Validate`'s `pipes` applies the class, after validation
 * @group Types
 * @see {@link Pipe}
 * @see {@link UsePipe}
 */
export interface PipeInterface<In = any, Out = any> {
  /**
   * Transforms one value.
   *
   * @param value - The value, after validation and any pipe before this one.
   * @param context - The call being handled; `getParams()` returns this use's `{ provide, params }` values.
   * @returns The value the handler receives. Throw to stop the call; the error reaches the filters.
   */
  transform(value: In, context: ExecutionContext): Out | Promise<Out>
}

/**
 * The second argument a `@ReactionHandler` method receives: who reacted, and whether they added or removed it.
 *
 * @group Types
 * @see {@link ReactionHandler}
 */
export interface ReactionEvent {
  /** The user who added or removed the reaction. */
  user: User | PartialUser
  /** Whether the reaction was added or removed. */
  action: ReactionHandlerAction
}

/**
 * The second argument a `@ReactionHandler` method receives, under its earlier name.
 *
 * @deprecated Since 4.1, and removed in the next major version (5.0). Use `ReactionEvent` instead. Every other
 * `…Options` type is what a decorator takes, and this one is what a handler receives.
 *
 * @group Types
 * @see {@link ReactionEvent}
 */
export type ReactionHandlerOptions = ReactionEvent

/**
 * The settings a `@ReactionHandler` takes for itself.
 *
 * @group Types
 * @see {@link ReactionHandler}
 */
export interface ReactionHandlerSettings {
  /**
   * Also runs for reactions from bots, the bot's own included, which are skipped by default as
   * messages from bots are.
   * @defaultValue `false`
   */
  bots?: boolean
}

/**
 * How `@Controller` treats a class: whether the handlers it declares take the stages of the classes it extends.
 *
 * @group Types
 * @see {@link Controller}
 */
export interface ControllerOptions {
  /**
   * Whether the class-level guards, interceptors, filters and cooldowns of the classes this one
   * extends also apply to the handlers it declares itself. `false` limits those handlers to this
   * class's own class and method stages; handlers it inherits keep their base's stages either way.
   *
   * @defaultValue `true`
   */
  inheritStages?: boolean
}

/**
 * One prefix or several that start a message command, such as `'!'` or `['!', '?']`; `''` stands for none.
 *
 * @group Configuration
 * @category App options
 * @see {@link MessageCommandOptions}
 */
export type MessagePrefix = string | readonly string[]

/**
 * How message commands start and match across the app, set in `@MeoCord({ messages })`.
 *
 * Use it to give `@MessageHandler` patterns a prefix, accept a mention of the bot in its place, and add param
 * types of the app's own. A handler sets its own start and case with {@link MessageHandlerOptions}.
 *
 * @example
 * ```ts
 * @Controller()
 * class DiceController {
 *   @MessageHandler('roll {sides:int}')
 *   async roll(message: Message, { sides }: { sides: number }) {
 *     await message.reply(String(1 + Math.floor(Math.random() * sides)))
 *   }
 * }
 *
 * @MeoCord({
 *   controllers: [DiceController],
 *   clientOptions: { intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] },
 *   // !roll 20, or @Bot roll 20; a usage reply stays 30 seconds
 *   messages: { prefix: '!', mention: true, deleteUsageRepliesAfter: 30 },
 * })
 * class App {}
 * ```
 *
 * @group Configuration
 * @category App options
 * @see {@link MessageHandler}
 * @see {@link https://meocord.dev/docs/4.1/message-commands | Message commands}
 */
export interface MessageCommandOptions {
  /**
   * What a message starts with to reach a patterned handler: a prefix, a list of them, or a function
   * of the message returning them, such as a server's own prefix. Without one, a pattern matches the
   * message as it is. A function that finds none, returning an empty list or nothing, starts no command
   * for that message; only `''` takes it as it is. A handler's own `prefix` replaces it.
   */
  prefix?: MessagePrefix | ((message: Message) => MessagePrefix | Promise<MessagePrefix>)
  /**
   * Also accepts a mention of the bot, `<@id>` or `<@!id>`, where a prefix goes. `'only'` accepts nothing else
   * in a server, neither a prefix nor the message as it is, so a server's messages reach commands only when they
   * mention the bot, which Discord delivers with their text even without the privileged MessageContent intent. A
   * direct message, addressed to the bot already, starts as usual: after the prefix, or as it is without one.
   * @defaultValue `false`
   */
  mention?: boolean | 'only'
  /** Matches the prefix and a pattern's literal words in the case written; param values always are. @defaultValue `false` */
  caseSensitive?: boolean
  /**
   * Param types of the app's own, used in patterns as `{name:type}` by their key here. Declare each in
   * {@link MessageParamTypes} as well, so a handler's params are typed from its pattern.
   */
  types?: Record<string, MessageParamType>
  /**
   * How long a reply showing a command's usage stays before it is deleted, in seconds. `0` keeps it.
   * @defaultValue `10`
   */
  deleteUsageRepliesAfter?: number
  /**
   * Begins every text reply MeoCord sends to a message with the theme's `emojis.warning`: a command's usage, a
   * guard's or validation's reason, a `UserError`'s message, an `@On` listener's of a message event included, and the
   * direct messages `dmOnError` and `dmOnCooldown` send.
   * The emoji is the call's resolved theme's, so it follows `@UseTheme` and `themeFor`.
   * @defaultValue `false`
   */
  replyEmoji?: boolean
  /**
   * Tells the author of a message command, in a direct message, when it fails with an error no filter handled,
   * naming the command, the channel and the server. The error is logged as without it, and nothing is said in the
   * channel: a message cannot be answered privately there. A command sent in a direct message is answered in it.
   * The text is `meocord.dm.error`, around what the fallback answers the error with, such as the cooldown store's
   * `meocord.cooldown.storeDown`, in the server's language. A member whose direct messages are closed is not told.
   * Only patterned handlers are answered, not a listener for every message. A command refused because the cooldown
   * store failed is told once per outage per author.
   * @defaultValue `false`
   */
  dmOnError?: boolean
  /**
   * Tells the author of a message command, in a direct message, when a `@Cooldown` refuses it, with how long to
   * wait, once per wait: retrying before it ends sends nothing more. The notice is counted in the app's cooldown
   * store, so it holds across shards with a shared store. The text is `meocord.dm.cooldown`, around the cooldown's
   * own wait text, in the server's language. A command sent in a direct message is answered in it, and a member
   * whose direct messages are closed is not told. Only patterned handlers are answered.
   * @defaultValue `false`
   */
  dmOnCooldown?: boolean
  /**
   * Answers `!help` with the message commands the caller can use, and `!help <command>` with one of them, from the
   * `description` each handler gives. `true` uses the word `help`; `{ command, aliases }` names other words. It
   * answers only after a prefix or a mention, and an app's own handler for the word runs instead. The reply's text
   * comes from the presenter's `messageHelp` when it has one.
   * @defaultValue `false`
   */
  help?: boolean | MessageHelpOptions
}

/**
 * The words the built-in help command answers to, as `@MeoCord({ messages: { help } })` takes them.
 *
 * @group Configuration
 * @category App options
 * @see {@link MessageCommandOptions}
 */
export interface MessageHelpOptions {
  /**
   * The word that asks for help, after a prefix or mention.
   * @defaultValue `'help'`
   */
  command?: string
  /** Other words that ask for it, such as `'commands'`. */
  aliases?: readonly string[]
}

/**
 * What the built-in help command found, for a presenter's `messageHelp` to write.
 *
 * `list` is every command the caller can use here; `command` is the one a `!help <command>` names; `parent` is the
 * subcommands of the words it names; `unknown` is a name no command has; `empty` is nothing to list.
 *
 * @example
 * ```ts
 * @Service()
 * export class HelpPresenter implements ResponsePresenter {
 *   loading = ({ theme }: ResponseContext) => ({ text: 'Working on it…', emoji: theme.emojis.loading })
 *   error = (_context: ResponseContext, { message }: PresentedError) => ({ text: message })
 *
 *   messageHelp(help: MessageHelp) {
 *     if (help.kind !== 'list') return help.kind === 'unknown' ? `No "${help.query}" here.` : 'Ask a moderator.'
 *     return help.commands.map(entry => `${entry.usage}: ${entry.description ?? ''}`).join('\n')
 *   }
 * }
 * ```
 *
 * @group Types
 * @see {@link MessageHelpEntry}
 * @see {@link ResponsePresenter}
 */
export type MessageHelp =
  | { kind: 'list'; commands: MessageHelpEntry[]; invocation: string }
  | { kind: 'command'; commands: MessageHelpEntry[]; invocation: string }
  | { kind: 'parent'; subcommands: MessageHelpEntry[]; invocation: string }
  | { kind: 'unknown'; query: string; invocation: string }
  | { kind: 'empty'; reason: 'none' | 'server-only'; invocation: string }

/**
 * One message command as the built-in help shows it: how to type it, what it does, and where it works.
 *
 * @group Types
 * @see {@link MessageHelp}
 */
export interface MessageHelpEntry {
  /** The command as the caller types it here, such as `!mute <target> [duration] [reason…]`. */
  usage: string
  /** The words that name the command, such as `mute`, or `''` for a pattern that begins with a param. */
  command: string
  /** What the command does, from its handler's `description`. */
  description?: string
  /** Its aliases and other spellings, as the caller types them, such as `!m`. */
  aliases: string[]
  /** Where it works; a command with a `member`, `role` or `channel` param works in servers only. */
  scope: MessageScope
  /** Each param and flag, with what it takes. */
  params: MessageHelpParam[]
  /** The class and method that handle it, by name. */
  handler: { controller: string; method: string }
}

/**
 * One param or flag of a {@link MessageHelpEntry}, with what it takes in words.
 *
 * @group Types
 */
export interface MessageHelpParam {
  /** Its name as the usage shows it, such as `duration`, or `--bots` for a flag. */
  name: string
  /** What it takes, such as `whole number`, `one of asc, desc` or `text`, in the server's language where the app translates it. */
  label: string
  /** Whether it can be left out. */
  optional: boolean
}

/**
 * MeoCord's own texts for users, in English, by key under `meocord`: usage replies, the built-in help, cooldown
 * refusals, the fallback's answers and the default presenter's views.
 *
 * Translate any of them by adding a `meocord` group to a catalog; a text a locale leaves out stays in English. A key
 * MeoCord lacks, or a `{param}` its English text lacks, fails to compile.
 *
 * @example
 * ```ts
 * const enUS = defineCatalog({ ping: 'Pong!' })
 * const id = {
 *   ping: 'Pong!',
 *   meocord: { usage: { heading: 'Cara pakai: {usage}', missing: '{param} belum diisi' } },
 * }
 * export const t = createTranslator({ default: 'en-US', locales: { 'en-US': enUS, id } })
 * ```
 *
 * @group Types
 * @see {@link https://meocord.dev/docs/4.1/localisation | Localisation}
 */
export type MeoCordMessages = (typeof MEOCORD_MESSAGES)['meocord']

/**
 * A param type an app adds for its message patterns, such as `{accent:color}`: it reads a word as a value.
 *
 * Add one for a value the built-in types do not cover, such as a colour, an item from your catalogue or an
 * order ID. Register it in `@MeoCord({ messages: { types } })` by the name patterns use, and declare what it
 * gives in {@link MessageParamTypes}, so handlers using it are typed.
 *
 * @remarks
 * `parse` returns `undefined` for a word that is not one, which the user is told with the command's usage,
 * built from `label`. It runs before the handler's guards, so it should not call Discord; for something that
 * needs a request, return an {@link EntityRef}, resolved once the guards let the call through.
 *
 * @example
 * ```ts
 * const color: MessageParamType<number> = {
 *   label: 'hex colour',
 *   parse: word => (/^#[0-9a-f]{6}$/i.test(word) ? parseInt(word.slice(1), 16) : undefined),
 * }
 * // @MeoCord({ messages: { types: { color } } }), and in a .d.ts of the app:
 * declare module 'meocord/interface' {
 *   interface MessageParamTypes { color: number }
 * }
 * ```
 *
 * @group Configuration
 * @category App options
 * @see {@link https://meocord.dev/docs/4.1/message-params | Message params}
 */
export interface MessageParamType<T = unknown> {
  /** A noun such as `hex colour`, read in "is not a valid hex colour". Defaults to the type's key. */
  label?: string
  /**
   * A message key of the app's catalog, such as `types.color`, whose text is the label in each reply's language.
   * It needs `@MeoCord({ i18n })`, and the default catalog must have the message.
   */
  labelKey?: string
  /**
   * The value a word stands for, or `undefined` when it stands for none. It runs before the handler's guards,
   * so a caller they refuse can reach it: it should not call Discord. For something that needs a request,
   * return an {@link EntityRef}, whose `resolve()` runs only once the guards let the call through; guards see
   * the ref, and the handler the value it resolves to.
   */
  parse(word: string, message: Message): T | EntityRef<T> | undefined | Promise<T | EntityRef<T> | undefined>
}

/**
 * What each param type in a message pattern gives the handler, by the name a pattern uses for it.
 *
 * Read it to see what `{amount:int}` or `{target:member}` gives, and augment it with the types your app adds in
 * `@MeoCord({ messages: { types } })`, so their handlers are typed.
 *
 * @group Types
 * @see {@link MessageParamType}
 * @see {@link ParamsOf}
 */
export interface MessageParamTypes {
  /** A word, or "quoted words". The type of a param that names none. */
  string: string
  /** A whole number, such as `50` or `-3`. */
  int: number
  /** A number, such as `2.5`. */
  number: number
  /** `yes`, `no`, `true`, `false`, `on` or `off`. */
  bool: boolean
  /** A length of time such as `10m`, `2h30m` or `7d`, in milliseconds. */
  duration: number
  /** A member of the message's server, by mention or ID. */
  member: GuildMember
  /** A user, by mention or ID. */
  user: User
  /** A role of the message's server, by mention, ID or name. */
  role: Role
  /** A channel of the message's server, by mention or ID. */
  channel: GuildBasedChannel
}

/**
 * A member, user, role or channel a message command names, as its guards see it: not fetched yet.
 *
 * Read `cached` for what discord.js already has, and call `resolve()` only once a cheaper check has passed, so a
 * caller you refuse costs no request. The handler receives the entity itself, fetched after the guards.
 *
 * @remarks
 * `resolve()` makes one request per ID however many messages and guards ask at the same time, and the fetch
 * after the guards shares it. It gives `undefined` when there is no such entity.
 *
 * @example
 * ```ts
 * @Guard()
 * export class OutranksTargetGuard implements GuardInterface {
 *   async canActivate(message: Message, { target }: ParamRefsOf<'ban {target:member}'>) {
 *     if (!message.member?.permissions.has('BanMembers')) return false
 *     const member = target.cached ?? (await target.resolve())
 *     return !member || member.roles.highest.position < message.member.roles.highest.position
 *   }
 * }
 * ```
 *
 * @group Types
 * @see {@link ParamRefsOf}
 */
export interface EntityRef<T> {
  /** The ID the message gave, by mention or as a bare ID. */
  readonly id: string
  /** The entity when discord.js already has it, with no request; `undefined` otherwise. */
  readonly cached: T | undefined
  /** Fetches the entity, once however many callers ask at the same time; `undefined` when there is none. */
  resolve(): Promise<T | undefined>
}

/** Splits a pattern into its words, at most 16 of them, so the checker's work stays small. */
type PatternWords<S extends string, Acc extends string[] = []> = Acc['length'] extends 16
  ? Acc
  : S extends `${infer Word} ${infer Rest}`
    ? PatternWords<Rest, Word extends '' ? Acc : [...Acc, Word]>
    : S extends ''
      ? Acc
      : [...Acc, S]

/**
 * The value a param's type gives: a named type, or one of the words `a|b` lists. An app's type not declared
 * in {@link MessageParamTypes} is not checked.
 */
type ParamValue<T extends string> = T extends keyof MessageParamTypes
  ? MessageParamTypes[T]
  : T extends `${string}|${string}`
    ? SplitChoices<T>
    : any

type SplitChoices<T extends string> = T extends `${infer Head}|${infer Rest}` ? Head | SplitChoices<Rest> : T

/** The types whose values name something on Discord, which guards see as refs. */
type EntityType = 'member' | 'user' | 'role' | 'channel'

/**
 * What a guard sees for a param of type `T`: a ref for a member, user, role or channel, since nothing is
 * fetched before the guards; a scalar or a choice as its value; an app's type as its value, or the ref its
 * `parse` gives.
 */
type GuardValue<T extends string> = T extends EntityType
  ? EntityRef<ParamValue<T>>
  : T extends 'string' | 'int' | 'number' | 'bool' | 'duration' | `${string}|${string}`
    ? ParamValue<T>
    : ParamValue<T> | EntityRef<ParamValue<T>>

type ParamSpec<W extends string> = W extends `{--${infer Body}}`
  ? Body extends `${infer Head}?`
    ? FlagSpec<Head, true>
    : FlagSpec<Body, false>
  : W extends `{${infer Body}}`
    ? Body extends `${infer Head}?`
      ? RestSpec<Head, true>
      : RestSpec<Body, false>
    : never

/** A flag without a type is `true` when given and `false` when not, so it is always there. */
type FlagSpec<B extends string, Optional extends boolean> = B extends `${infer Name}:${infer Type}`
  ? { name: Name; value: ParamValue<Type>; guard: GuardValue<Type>; optional: Optional; typed: true }
  : { name: B; value: boolean; guard: boolean; optional: false; typed: true }

/** A rest with a type is a list of values; without one, the rest of the message as text. */
type RestSpec<B extends string, Optional extends boolean> = B extends `${infer Head}...`
  ? Head extends `${infer Name}:${infer Type}`
    ? { name: Name; value: ParamValue<Type>[]; guard: GuardValue<Type>[]; optional: Optional; typed: true }
    : TypedSpec<Head, Optional>
  : TypedSpec<B, Optional>

type TypedSpec<B extends string, Optional extends boolean> = B extends `${infer Name}:${infer Type}`
  ? { name: Name; value: ParamValue<Type>; guard: GuardValue<Type>; optional: Optional; typed: true }
  : { name: B; value: string; guard: string; optional: Optional; typed: false }

type PatternSpecs<P extends string> = ParamSpec<PatternWords<P>[number]>

/**
 * The params a message pattern gives its handler, read from the pattern itself.
 *
 * Use it to type a handler's params, or anything that receives them, from the pattern alone:
 * `ParamsOf<'ban {target:member} {days:int?}'>` is `{ target: GuildMember } & { days?: number }`. A handler's
 * declared params are checked against it anyway; for what guards see, use {@link ParamRefsOf}.
 *
 * @group Types
 * @see {@link MessageHandler}
 * @see {@link MessageParamTypes}
 */
export type ParamsOf<P extends string> = {
  [S in PatternSpecs<P> as S['optional'] extends true ? never : S['name']]: S['value']
} & {
  [S in PatternSpecs<P> as S['optional'] extends true ? S['name'] : never]?: S['value']
}

/**
 * The params of a message pattern as its guards see them: each member, user, role and channel as an `EntityRef`.
 *
 * Use it to type a guard's params for a message command: `ParamRefsOf<'ban {target:member}'>` is
 * `{ target: EntityRef<GuildMember> }`. Scalars and choices are their values, as in {@link ParamsOf}.
 *
 * @group Types
 * @see {@link EntityRef}
 */
export type ParamRefsOf<P extends string> = {
  [S in PatternSpecs<P> as S['optional'] extends true ? never : S['name']]: S['guard']
} & {
  [S in PatternSpecs<P> as S['optional'] extends true ? S['name'] : never]?: S['guard']
}

/**
 * The params a message handler declares, `Declared`, as `@MessageHandler` checks them against its pattern `P`.
 *
 * You do not use it directly: it is why a handler whose params name a param the pattern lacks, or give a typed
 * param a type its value does not fit, fails to compile, with the param named. Params such as
 * `Record<string, string>`, which take anything, are not checked.
 *
 * @group Types
 * @see {@link ParamsOf}
 */
export type CheckedParams<P extends string, Declared> = string extends keyof Declared
  ? Declared
  : {
      [K in keyof Declared]: K extends PatternSpecs<P>['name']
        ? Extract<PatternSpecs<P>, { name: K }> extends infer S extends { value: unknown; optional: boolean; typed: boolean }
          ? S['typed'] extends true
            ? S['optional'] extends true
              ? (S['value'] | undefined) extends Declared[K] ? Declared[K] : S['value'] | undefined
              : S['value'] extends Declared[K] ? Declared[K] : S['value']
            : S['optional'] extends true
              ? undefined extends Declared[K] ? Declared[K] : Declared[K] | undefined
              : Declared[K]
          : never
        : { readonly 'not a param of the pattern': K }
    }

/**
 * Where a message command works: `'guild'` in servers only, `'dm'` in direct messages only, or `'any'`.
 *
 * @group Types
 * @see {@link MessageHandlerOptions}
 */
export type MessageScope = 'guild' | 'dm' | 'any'

/**
 * What one message command sets for itself, over the app's `messages` options.
 *
 * Use it to give a command its own prefix or case, aliases, a description for a help listing, or the places it
 * works. The app-wide defaults are {@link MessageCommandOptions}.
 *
 * @example
 * ```ts
 * @MessageHandler('mute {target:member} {duration:duration?}', {
 *   aliases: ['m'],
 *   description: 'Times a member out.',
 *   scope: 'guild',
 * })
 * async mute(message: Message, { target, duration }: { target: GuildMember; duration?: number }) {
 *   await target.timeout(duration ?? 600_000)
 * }
 * ```
 *
 * @group Configuration
 * @category App options
 * @see {@link MessageHandler}
 * @see {@link https://meocord.dev/docs/4.1/message-commands | Message commands}
 */
export interface MessageHandlerOptions {
  /**
   * The handler's own prefixes, in place of the app's; a mention of the bot still counts when the app
   * accepts one. `false` matches the message as it is, with no prefix or mention.
   */
  prefix?: false | MessagePrefix
  /**
   * `'only'` starts the command in a server with a mention of the bot and nothing else, whatever the app's
   * prefixes, so it needs no MessageContent intent. In a direct message it starts as usual, after its own `prefix`
   * or the app's.
   */
  mention?: 'only'
  /** Overrides the app's `caseSensitive` for this handler. */
  caseSensitive?: boolean
  /**
   * Other words for the command, each in place of the words the pattern begins with: with `['b']`,
   * `ban {target:member}` also takes `!b @ana`. `HandlerRegistry` lists the handler once, with its aliases.
   */
  aliases?: readonly string[]
  /** What the command does, shown by the built-in help and by `HandlerRegistry`. */
  description?: string
  /**
   * Where the command works; `'any'` by default. A message sent elsewhere gets a usage reply saying
   * where it works, and the handler does not run. A command with a `member`, `role` or `channel` param
   * works in servers only, whatever this says.
   */
  scope?: MessageScope
  /**
   * Leaves the command out of the built-in help's list and of a parent's list of subcommands. It is not a secret:
   * it still runs, a misuse still gets its usage, and `!help <command>` still shows it when named.
   * @defaultValue `false`
   */
  hidden?: boolean
}

/**
 * The configuration `meocord.config.ts` exports: the bot's token, how it is built, and how it registers and shards.
 *
 * It holds what the CLI and the process need before the app class is read. What the app itself does, its
 * controllers, intents and message options, belongs in `@MeoCord` instead. A new app's config file imports
 * `dotenv/config` first, so `process.env` holds `.env`'s values.
 *
 * @example
 * ```ts
 * export default {
 *   appName: 'My Bot',
 *   // Read from .env, since this file is committed
 *   discordToken: process.env.DISCORD_TOKEN!,
 *   commands: { developmentGuild: process.env.DEV_GUILD_ID || undefined },
 * } satisfies MeoCordConfig
 * ```
 *
 * @group Configuration
 * @category Config file
 * @see {@link MeoCord}
 * @see {@link https://meocord.dev/docs/4.1/configuration | Configuration}
 */
export interface MeoCordConfig {
  /** Shown as a prefix on every log line. Omitted when unset. */
  appName?: string
  /** The Discord bot token. Read it from the environment rather than committing it. */
  discordToken: string
  /**
   * Bundles everything the bot needs into `dist`, so it runs without `node_modules`.
   *
   * Native addons such as `sharp` are copied with their platform binary into `dist/node_modules`.
   * A build with native addons only starts on the platform it was built on.
   *
   * @defaultValue `false`
   */
  bundleDependencies?: boolean
  /**
   * Modules to keep out of the bundle. With {@link bundleDependencies}, listed package names are
   * copied into `dist/node_modules`; native addons are found without being listed.
   *
   * @example
   * ```ts
   * externals: ['@opentelemetry/api']
   * ```
   */
  externals?: (string | RegExp)[]
  /**
   * Packages a dependency tries to load and runs without, such as `supports-color`, which `debug`
   * probes for inside a `try`. Each stays a `require` where the dependency calls it, inside the
   * dependency's own `try`, so a missing package is caught there rather than failing the bot at
   * startup. With {@link bundleDependencies}, an installed one is copied into `dist/node_modules`.
   *
   * Package names only. Do not also list a name in {@link externals}, which would turn it into an
   * import that runs, and fails, before the bot's code.
   *
   * @example
   * ```ts
   * optionalExternals: ['supports-color', '@node-rs/xxhash']
   * ```
   */
  optionalExternals?: string[]
  /**
   * Customises the Rsbuild configuration the bot is built with.
   *
   * Images, fonts, svg and media need no rules. Raw bundler rules go through `tools.rspack`.
   *
   * @param config - The configuration MeoCord builds with.
   * @returns The modified configuration, or `undefined` to keep it as is.
   */
  rsbuild?: (config: RsbuildConfig) => RsbuildConfig | undefined
  /**
   * Makes stack traces name your source files, lines and columns, from the source map the build writes
   * beside `dist/main.js`. Under Node, `meocord start` passes `--enable-source-maps`; under Bun, or Node
   * started without the flag, the bundle maps each stack through `Error.prepareStackTrace` itself.
   *
   * Set `false` for an error tracker that applies uploaded source maps to the bundle's positions, or a
   * source mapper of your own.
   *
   * @defaultValue `true`
   */
  sourceMappedStacks?: boolean
  /**
   * How long, in milliseconds, shutdown waits for the `onShutdown` hooks before destroying the client
   * anyway: from 0 to 2147478647, the longest a timer keeps less the margin the shard manager waits on top. The limit covers the whole sequence, not each hook,
   * including the calls under way that the cooldown store's shutdown waits for.
   *
   * @defaultValue `10_000`
   */
  shutdownTimeout?: number
  /**
   * The least severe log line `Logger` prints: `'debug'` prints everything, `'log'` hides `[DEBUG]`,
   * `'warn'` prints warnings and errors, `'error'` only errors, and `'silent'` nothing. The
   * `MEOCORD_LOG_LEVEL` environment variable overrides it for one run, without a rebuild.
   *
   * @defaultValue `'debug'` while `NODE_ENV` is `development`, as under `meocord start --dev`, and
   *   `'log'` otherwise
   *
   * @example
   * ```ts
   * logLevel: 'warn',
   * ```
   */
  logLevel?: 'debug' | 'log' | 'warn' | 'error' | 'silent'

  /**
   * Where the bot registers its application commands, and whether it does so at startup.
   *
   * @defaultValue Every command registered globally, each time the bot starts.
   */
  commands?: CommandRegistrationConfig

  /**
   * Splits the bot's gateway connection into shards, which Discord requires from about 2,500 servers.
   *
   * @defaultValue One connection, or whatever `clientOptions.shards` says.
   */
  sharding?: ShardingConfig
}

/**
 * How the bot splits its gateway connection into shards, set as `meocord.config.ts`'s `sharding`.
 *
 * Discord requires sharding from about 2,500 servers. Keep the default mode, every shard in one process, until
 * the bot needs more than one CPU core.
 *
 * @remarks
 * By default every shard runs in one process, in one client: one container, one set of services, and `onReady`
 * once. `mode: 'process'` runs each shard in a process of its own instead; `meocord start`, `node dist/main.js`
 * and bun then start a manager that spawns the shards, registers the commands once, and restarts a shard that
 * exits.
 *
 * @example
 * ```ts
 * export default {
 *   discordToken: process.env.DISCORD_TOKEN!,
 *   sharding: { shards: 'auto', mode: 'process' },
 * } satisfies MeoCordConfig
 * ```
 *
 * @group Configuration
 * @category Config file
 * @see {@link ShardContext}
 * @see {@link https://meocord.dev/docs/4.1/sharding | Sharding}
 */
export interface ShardingConfig {
  /**
   * How many shards to run: a number, or `'auto'` for the count Discord recommends.
   *
   * @defaultValue `'auto'`
   */
  shards?: number | 'auto'
  /**
   * `'internal'` runs every shard in one process; `'process'` runs each shard in a process of its own.
   *
   * @defaultValue `'internal'`
   */
  mode?: 'internal' | 'process'
  /**
   * Whether `mode: 'process'` also applies under `meocord start --dev`. Off by default, so the
   * development watcher restarts one process and never leaves shards behind.
   *
   * @defaultValue `false`
   */
  development?: boolean
}

/**
 * Where and whether MeoCord registers the application's commands with Discord, set as `meocord.config.ts`'s `commands`.
 *
 * Global commands can take a while to show up in clients; guild commands appear at once, which is what a
 * development guild is for. Set `register: false` to register only with `meocord register`, from CI for instance.
 *
 * @remarks
 * Registration replaces the commands in each scope it sends to with exactly the ones the bot declares.
 *
 * @example
 * ```ts
 * export default {
 *   discordToken: process.env.DISCORD_TOKEN!,
 *   // Every command goes to this guild under `meocord start --dev`, and globally in production
 *   commands: { developmentGuild: process.env.DEV_GUILD_ID || undefined },
 * } satisfies MeoCordConfig
 * ```
 *
 * @group Configuration
 * @category Config file
 * @see {@link https://meocord.dev/docs/4.1/slash-commands | Slash commands}
 */
export interface CommandRegistrationConfig {
  /**
   * Guilds to register every command to instead of globally. Unset or empty registers globally.
   * Blank ids are dropped; a list with none left, as `[process.env.GUILD_ID]` leaves it with the
   * variable unset, registers those commands nowhere, with a warning, rather than globally.
   * A builder's own `guilds` option takes precedence for its command.
   */
  guilds?: (string | undefined)[]
  /**
   * A guild that receives every command, and nothing else does, while `NODE_ENV` is `development` —
   * as under `meocord start --dev`. Ignored in production.
   */
  developmentGuild?: string
  /**
   * Whether the bot registers its commands when it starts. Set `false` to register only with
   * `meocord register`, from CI for instance.
   *
   * @defaultValue `true`
   */
  register?: boolean
  /**
   * Whether to remove this application's commands from the scopes this configuration names but is
   * not registering to, such as the global commands left behind after moving to `guilds`. Without it,
   * such leftovers are reported as a warning. While `developmentGuild` receives every command, as
   * under `start --dev`, leftovers are only warned about, since a production bot sharing the
   * application may own them; production starts and `meocord register` without `--dev` remove them.
   *
   * @defaultValue `false`
   */
  clearOther?: boolean
}

/**
 * Where a command `@CommandBuilder` describes is registered, in place of the configured scope.
 *
 * @group Types
 * @see {@link CommandBuilder}
 */
export interface CommandBuilderOptions {
  /**
   * The servers this command is registered to, in place of the configured scope. A command whose list is
   * empty after dropping blank ids is not registered at all, rather than falling back to global. Under a
   * development server, it goes there with every other command.
   *
   * @defaultValue the configured scope
   */
  guilds?: (string | undefined)[]
}

export type { CooldownOptions, CooldownStoreFailure } from '@src/core/cooldown-runner.js'
export type { DispatchObserver, DispatchOutcome, DispatchResult } from './observer.interface.js'
export type { StageParams } from './stage-params.interface.js'
export type { GuardOptions, InterceptorOptions, ObserverOptions, ValidateOptions, ValidatePipes } from './stage-options.interface.js'
export type {
  InferSchemaOutput,
  PIPED_BRAND,
  Piped,
  StandardSchemaV1,
  StandardSchemaV1Issue,
  StandardSchemaV1Props,
  StandardSchemaV1Result,
} from './standard-schema.interface.js'
export type {
  AutocompleteMetadata,
  BuildableCommandType,
  CommandBuilderBase,
  CommandBuildResult,
  CommandBuilderConstructor,
  CommandInteractionType,
  CommandMetadata,
  PrimaryEntryPointCommandData,
} from './command-decorator.interface.js'
export type {
  ClassProvider,
  FactoryProvider,
  Provider,
  ProviderToken,
  Token,
  ValueProvider,
} from '@src/interface/provider.interface.js'
export type {
  DeepPartial,
  DeepReadonly,
  GuildThemeTarget,
  MeoCordTheme,
  ReservedThemeRole,
  RootTheme,
  ThemeButtons,
  ThemeButtonStyle,
  ThemeColors,
  ThemeEmojis,
  ThemeOverride,
  ThemeResolvers,
  UserThemeTarget,
} from './theme.interface.js'
