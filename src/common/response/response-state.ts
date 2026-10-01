import {
  type APIEmbed,
  type BitFieldResolvable,
  type Interaction,
  type InteractionEditReplyOptions,
  type InteractionReplyOptions,
  type Message,
  MessageFlags,
  MessageFlagsBitField,
  type MessageFlagsResolvable,
  type ModalComponentData,
  type JSONEncodable,
  type APIModalInteractionResponseCallbackData,
  ComponentType,
  type RepliableInteraction,
  resolveColor,
} from 'discord.js'
import { warnDeprecated } from '@src/common/deprecation.js'
import { Logger } from '@src/common/logger.js'
import { UserError } from '@src/common/errors.js'
import { textFor } from '@src/common/meocord-text.js'
import { logFailedSend } from '@src/common/response/send-failure.js'
import { describeInteraction } from '@src/util/interaction.util.js'
import { getInstallContext, type InstallContext } from '@src/common/response/install-context.js'
import {
  flagNames,
  hasComponentsV2,
  hasEphemeral,
  resolveFlags,
  type ResponseStep,
} from '@src/common/response/flags.js'
import { keptAttachmentNames, rewriteAttachmentUrls } from '@src/common/response/attachments.js'
import {
  attachmentsOf,
  DEFAULT_ATTACHMENT_SIZE_LIMIT,
  defaultPresenter,
  isTooLarge,
  presenterFor,
  REFUSED_AS_TOO_LARGE,
  renderContainer,
  renderEmbed,
  withoutFiles,
  withSendableFiles,
} from '@src/common/response/presenter.js'
import {
  countComponents,
  EMBED_LIMIT,
  lockComponents,
  type LockOptions,
  sameEmbed,
  V2_COMPONENT_LIMIT,
  withoutRenderedViews,
} from '@src/common/response/components.js'
import { stampCall } from '@src/common/response/call-order.js'
import { type ResponseContext, type ResponsePresenter, type ResponseView } from '@src/interface/index.js'
import { isUserOutcome } from '@src/common/user-outcome.js'
import { type ResolvedTheme, themeForInteraction } from '@src/core/theme-scope.js'
import { LOADING_DRAW_TIMEOUT_MS } from '@src/core/theme-resolvers.js'

/**
 * The flags a message sent through `respond()` can ask for.
 *
 * @group Responses
 */
export type ResponseFlags = BitFieldResolvable<
  'Ephemeral' | 'SuppressEmbeds' | 'SuppressNotifications' | 'IsComponentsV2',
  MessageFlags.Ephemeral | MessageFlags.SuppressEmbeds | MessageFlags.SuppressNotifications | MessageFlags.IsComponentsV2
>

/**
 * The flags an edit through `respond()` can ask for.
 *
 * @group Responses
 */
export type ResponseEditFlags = BitFieldResolvable<
  'SuppressEmbeds' | 'IsComponentsV2',
  MessageFlags.SuppressEmbeds | MessageFlags.IsComponentsV2
>

/**
 * A message sent with `send()` or `followUp()`: text, or reply options with the flags it can take.
 *
 * @group Responses
 */
export type ResponsePayload =
  | string
  | (Omit<InteractionReplyOptions, 'flags' | 'withResponse' | 'ephemeral'> & {
      flags?: ResponseFlags
      /**
       * Whether the message is private, read as the `MessageFlags.Ephemeral` flag.
       *
       * @deprecated Since 4.1, and removed in the next major version (5.0). Use `flags: MessageFlags.Ephemeral`
       * instead. discord.js deprecates the option it mirrors.
       */
      ephemeral?: boolean
    })

/**
 * An edit made with `edit()`: text, or edit options with the flags an edit can take.
 *
 * @group Responses
 */
export type ResponseEditPayload = string | (Omit<InteractionEditReplyOptions, 'flags'> & { flags?: ResponseEditFlags })

/**
 * Where an interaction's answer stands.
 *
 * @group Responses
 */
export type ResponsePhase = 'unanswered' | 'deferred' | 'replied'

/**
 * Options for {@link ResponseState.error}.
 *
 * @group Responses
 */
export interface ResponseErrorOptions {
  /** What the user is told. Defaults to a `UserError`'s own message, or a generic sentence. */
  message?: string

  /**
   * `'reply'` (default) may turn a public deferred reply into the error; `'private'` (the default for a
   * `UserError`) never shows it to anyone but the user who made the call.
   */
  visibility?: 'reply' | 'private'
}

/** Options for {@link ResponseState.lock}. */
export interface ResponseLockOptions {
  /**
   * Which controls to disable: every control on the message (`'all'`, the default), only the one the
   * user used (`'clicked'`), or none, which also skips the loading view (`'none'`).
   */
  disable?: 'all' | 'clicked' | 'none'
}

/**
 * Options for one message sent with `send()`, `edit()` or `followUp()`.
 *
 * @group Responses
 */
export interface ResponseSendOptions {
  /**
   * Whether an embed with no colour and a Components V2 container with no accent take the theme's
   * primary colour. Defaults to `true`; `false` sends this message's embeds and containers as written.
   */
  fill?: boolean
}

/**
 * One Discord call made through a response state, as the testing helpers report it.
 *
 * @group Responses
 */
export interface ResponseCall {
  /**
   * The Discord method it used; `message.edit` edits the message itself, once the interaction's token has expired.
   */
  method:
    | 'deferReply'
    | 'deferUpdate'
    | 'reply'
    | 'update'
    | 'editReply'
    | 'followUp'
    | 'deleteReply'
    | 'showModal'
    | 'message.edit'
  /** What was sent, as that method received it; none for a deferral or a deletion. */
  payload?: unknown
  /** What the call rejected with, such as the `DiscordAPIError` for a refused call; absent when it succeeded. */
  error?: unknown
}

const ALREADY_ACKNOWLEDGED = 40060
/** Discord's code for an interaction it no longer knows, such as one past its three seconds unacknowledged. */
const UNKNOWN_INTERACTION = 10062
const TOKEN_EXPIRED = new Set([50027, 10015])
/**
 * How old an interaction's token must be for a token error to mean it expired. Discord's tokens last 15
 * minutes; the age is read on this host's clock, which may run behind Discord's, so a minute is allowed.
 */
const TOKEN_EXPIRED_AFTER_MS = 14 * 60 * 1000

const logger = new Logger('Response')
const development = () => process.env.NODE_ENV !== 'production'

function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined
}

/** Whether the interaction's reply is a message of its own rather than the message a component sits on. */
function answersWithOwnMessage(interaction: RepliableInteraction): boolean {
  return interaction.isCommand() || (interaction.isModalSubmit() && !interaction.isFromMessage())
}

type Body = Record<string, unknown> & {
  flags?: MessageFlagsResolvable
  components?: unknown[]
  embeds?: unknown[]
  files?: unknown[]
  attachments?: unknown[]
}

function toBody(payload: ResponsePayload | ResponseEditPayload): Body {
  if (typeof payload === 'string') return { content: payload }
  // discord.js's deprecated option, read as the flag it stands for before anything decides on flags, and
  // kept out of the call, where discord.js would add Ephemeral back to an edit or an update
  const { ephemeral, ...body } = payload as Body & { ephemeral?: boolean }
  if (ephemeral !== undefined) warnDeprecated(logger, 'The ephemeral option of respond()', 'flags: MessageFlags.Ephemeral')
  if (ephemeral) body.flags = Number(MessageFlagsBitField.resolve(body.flags ?? 0)) | MessageFlags.Ephemeral
  return body
}

/** Drops what a Components V2 message cannot carry. */
function forMode(body: Body, v2: boolean): Body {
  if (!v2) return body
  const { content: _content, embeds: _embeds, ...rest } = body
  return rest
}

interface Snapshot { components: Record<string, unknown>[]; embeds: APIEmbed[] }

/**
 * Whether a message was edited after MeoCord's own edit at `ours`: only a later stamp says so. A message with no
 * stamp, or an edit of ours Discord returned without one, cannot tell, and counts as not edited since.
 */
function editedSince(stamp: number | null | undefined, ours: number | undefined): boolean {
  return typeof stamp === 'number' && ours !== undefined && stamp > ours
}

/** A message `@Defer` locked, shared by the calls holding it, so concurrent clicks each put back their own control. */
interface MessageLock {
  /** The message with no call holding it: before the first lock, then as the last settled call left it. */
  original: Snapshot
  /** The message's own attachments when it was first locked, which every edit keeps by listing them. */
  attachments: unknown[]
  /** Whether a loading view put files of its own on it, which putting it back has to leave out. */
  drawn?: boolean
  /** The calls holding it, with the control each disabled. */
  holders: Map<InteractionResponse, LockOptions>
  /**
   * When MeoCord last edited it, as Discord stamped the edit: a later stamp means something else edited it since.
   * Discord rewrites the components it returns, with ids and resolved media, so comparing them tells nothing.
   */
  editedAt?: number
  forget?: ReturnType<typeof setTimeout>
}

const messageLocks = new Map<unknown, MessageLock>()

/** How long a locked message is remembered once no call holds it. */
export const LOCK_MEMORY_MS = 60_000

/** How many locked messages are remembered, for tests. */
export function lockedMessageCount(): number {
  return messageLocks.size
}

/**
 * A body with the theme's primary colour where the app left one unset: an embed with no `color`, and a
 * Components V2 container with no `accent_color`. A value set, even `0` or a `null` accent, is kept, and the app's
 * own builders are read, never changed.
 */
function withThemeColours(body: Body, theme: ResolvedTheme): Body {
  let primary: number | undefined
  const colour = () => (primary ??= resolveColor(theme.colors.primary))
  // Read without toJSON: only an uncoloured embed or an unaccented container is converted, and everything else is
  // passed on as the app gave it
  const embeds = body.embeds?.map(embed => (field(embed, 'color') === undefined ? { ...toJson(embed), color: colour() } : embed))
  const components = body.components?.map(component =>
    field(component, 'type') === ComponentType.Container && field(component, 'accent_color') === undefined
      ? { ...toJson(component), accent_color: colour() }
      : component,
  )
  return { ...body, ...(embeds && { embeds }), ...(components && { components }) }
}

/** A field of a payload part, from a builder's data or the plain object, without building its JSON. */
function field(part: unknown, key: string): unknown {
  const data = (part as { data?: Record<string, unknown> } | null)?.data
  return typeof (part as { toJSON?: unknown } | null)?.toJSON === 'function' && data ? data[key] : (part as Record<string, unknown> | null)?.[key]
}

/** A view MeoCord renders, in the theme's primary colour when its presenter gave it none. */
function themedView(view: ResponseView, theme: ResolvedTheme): ResponseView {
  return view.color === undefined ? { ...view, color: theme.colors.primary } : view
}

/** A message's attachments, as an edit lists them to keep them. */
function attachmentList(message: { attachments?: unknown } | null | undefined): unknown[] {
  const values = (message?.attachments as { values?: () => unknown } | undefined)?.values?.()
  return values && typeof (values as Iterable<unknown>)[Symbol.iterator] === 'function' ? [...(values as Iterable<unknown>)] : []
}

/** What a loading drawing that missed its deadline is taken as. */
const LATE = Symbol('late')

/** How a log names the presenter: its class, or "The presenter" for one written as an object. */
function presenterName(presenter: ResponsePresenter): string {
  const cls = (presenter as { constructor?: unknown }).constructor
  return typeof cls === 'function' && cls !== Object && cls.name ? cls.name : 'The presenter'
}

/** Whether a presenter's result is a view still being drawn. */
function isDrawing(view: ResponseView | Promise<ResponseView>): view is Promise<ResponseView> {
  return typeof (view as { then?: unknown }).then === 'function'
}

function toJson(value: unknown): Record<string, unknown> {
  return typeof (value as { toJSON?: unknown })?.toJSON === 'function'
    ? ((value as { toJSON(): Record<string, unknown> }).toJSON())
    : (value as Record<string, unknown>)
}

/**
 * How one interaction is answered: the single place its replies, edits and follow-ups go through.
 *
 * Get it with `respond()`. Each call picks the right Discord method for where the answer stands. Calls made
 * together run one after another, in the order they were made, so two `send()` calls at once reply, then edit.
 *
 * @group Responses
 */
export interface ResponseState {
  /** Where the interaction happened, and whether the bot can reach the channel there. */
  readonly location: InstallContext

  /** Where the answer stands, re-read from the interaction so answers made around this state count. */
  readonly state: ResponsePhase

  /** The message this state last sent or edited, or the message a component is on. Read-only: edit through the state. */
  readonly message: Message | undefined

  /** The components and embeds of the message before `@Defer` locked it; `undefined` until then. */
  readonly original: { readonly components: readonly unknown[]; readonly embeds: readonly APIEmbed[] } | undefined

  /**
   * Acknowledges the interaction without answering it yet: a deferred reply for a command, and an
   * invisible deferred update for a component or a modal from a message. Does nothing once answered,
   * and concurrent calls share one acknowledgement. One that fails leaves the interaction unanswered,
   * so the next answer replies.
   *
   * @param options - `ephemeral` to make a command's deferred reply private.
   */
  acknowledge(options?: { ephemeral?: boolean }): Promise<void>

  /**
   * Locks the message a component is on, as `@Defer`'s second step does: snapshots its components
   * and embeds, disables its controls, shows the loading emoji on the clicked button, and adds the
   * presenter's loading view. Commands have no message to lock. Does nothing once locked.
   *
   * The loading view is left out when it would pass 10 embeds or the Components V2 component limit;
   * the lock still applies. A loading view left behind by a crash or restart is dropped first.
   *
   * @param options - Which controls to disable.
   */
  lock(options?: ResponseLockOptions): Promise<void>

  /**
   * Sends the answer: a reply to an unanswered command, an update of an unanswered component's
   * message, and an edit once the interaction is deferred or replied. A second `send()` edits again.
   * A reply Discord refuses as already acknowledged elsewhere still throws, and the next `send()` edits.
   * After `modal()` it throws: a modal has no message, and the modal's submit is answered instead.
   *
   * After `@Defer` locked a message, omitting `components` puts back its components as they were
   * before the lock, and omitting `embeds` drops the loading view; `components: []` clears them.
   *
   * @param payload - Text, or reply options.
   * @param options - `fill: false` leaves this message's embeds and containers uncoloured.
   * @returns The message sent or edited, when Discord returns it.
   */
  send(payload: ResponsePayload, options?: ResponseSendOptions): Promise<Message | undefined>

  /**
   * Edits the answer, routed as `send()` is: an edit once the interaction is answered.
   *
   * @param payload - Text, or edit options.
   * @param options - `fill: false` leaves this edit's embeds and containers uncoloured.
   * @returns The edited message, when Discord returns it.
   */
  edit(payload: ResponseEditPayload, options?: ResponseSendOptions): Promise<Message | undefined>

  /**
   * Sends another message after the answer. Before any answer it is the first reply. While a command's
   * reply is deferred and nothing is sent yet, Discord turns a follow-up into the deferred reply and
   * ignores its flags, so it is sent as that edit; a private follow-up on a public deferral deletes the
   * deferral first and is sent privately. After `modal()` it is sent as made, and Discord decides whether it
   * accepts a follow-up there; the modal's submit is the interaction to answer.
   *
   * @param payload - Text, or reply options; `Ephemeral` makes the follow-up private.
   * @param options - `fill: false` leaves this follow-up's embeds and containers uncoloured.
   * @returns The message sent, when Discord returns it.
   */
  followUp(payload: ResponsePayload, options?: ResponseSendOptions): Promise<Message | undefined>

  /**
   * Deletes the answer: the reply, or for a component deferred without a reply of its own, its message.
   * Throws before any answer, and after `modal()`, which leaves no message.
   */
  delete(): Promise<void>

  /**
   * Shows a modal. A modal must be the interaction's first response, so this throws once the
   * interaction is acknowledged, or while another answer is in flight, rather than failing at Discord.
   * What the user enters arrives as a modal submit interaction, which is answered in its own right.
   *
   * @param modal - The modal to show.
   */
  modal(modal: JSONEncodable<APIModalInteractionResponseCallbackData> | ModalComponentData): Promise<void>

  /**
   * Presents an error, styled by the application's presenter, and never throws. A delivery Discord refuses, such
   * as for a missing permission, is logged at debug level; a presenter that fails, or any other failure, as an error.
   *
   * - Unanswered: a private reply.
   * - A command whose reply is deferred: `'reply'` edits that reply into the error; `'private'` edits a
   *   private deferral into it, and deletes a public one, then follows up privately.
   * - A component on a private (ephemeral) message: the error is added to that message, where it fits.
   * - Otherwise: a private follow-up, never an edit of the message the user clicked.
   *
   * A `UserError` shows its own message, privately, unless `options` say otherwise.
   *
   * @param error - The error, handed to the presenter so it can style it by kind.
   * @param options - What the user is told, and who sees it.
   */
  error(error: unknown, options?: ResponseErrorOptions): Promise<void>
}

/** The response state behind `respond()`, with what `@Defer` and the testing helpers use besides. */
export class InteractionResponse implements ResponseState {
  readonly location: InstallContext

  private phase: ResponsePhase = 'unanswered'
  private acknowledging?: Promise<void>
  /** The answer steps asked for, run one after another; `pending` counts those not yet settled. */
  private queue: Promise<unknown> = Promise.resolve()
  private pending = 0
  /** Whether the answer was a modal, which has no message to edit or delete. */
  private modalShown = false
  private v2: boolean
  private lastMessage?: Message
  private readonly calls: ResponseCall[] = []

  private snapshot?: Snapshot
  /** The message this call locked, shared with other calls holding it, while this one holds it. */
  private held?: { key: unknown; entry: MessageLock }
  /** The message this call locked, kept after it settles so its edits are still recorded there. */
  private lockEntry?: MessageLock
  private loadingView?: ResponseView
  /** Whether the interaction was acknowledged with a private deferred reply for a drawn error view, which that view replaces. */
  private privateDeferral = false
  /** Whether the locked message was answered, so nothing restores it again. */
  private settled = false
  private suppressNotifications = false
  // Set by @Defer's first step, so an error can name what acknowledged the interaction
  private underDefer = false
  private timer?: ReturnType<typeof setTimeout>
  /** A lock `@Defer({ mode: 'auto' })` asked for before acknowledging, applied once the timer acknowledges. */
  private pendingLock?: ResponseLockOptions

  constructor(readonly interaction: RepliableInteraction) {
    this.location = getInstallContext(interaction)
    const message = 'message' in interaction ? interaction.message : undefined
    this.v2 = Boolean(message?.flags?.has(MessageFlags.IsComponentsV2))
  }

  get state(): ResponsePhase {
    this.sync()
    return this.phase
  }

  get message(): Message | undefined {
    return this.lastMessage ?? ('message' in this.interaction ? (this.interaction.message ?? undefined) : undefined)
  }

  get original(): { readonly components: readonly unknown[]; readonly embeds: readonly APIEmbed[] } | undefined {
    return this.snapshot
  }

  /** The Discord calls made through this state, for tests. */
  get history(): readonly ResponseCall[] {
    return this.calls
  }

  private sync(): void {
    if (this.interaction.replied) this.phase = 'replied'
    else if (this.interaction.deferred && this.phase === 'unanswered') this.phase = 'deferred'
  }

  /** Makes a Discord call, recorded as it is made so the order stays as issued, and marked with its error if it rejects. */
  private async call<T>(method: ResponseCall['method'], payload: unknown, run: () => Promise<T>): Promise<T> {
    const call: ResponseCall = { method, payload }
    stampCall(call)
    this.calls.push(call)
    try {
      return await run()
    } catch (error) {
      call.error = error
      throw error
    }
  }

  private flagsFor(step: ResponseStep, requested: MessageFlagsResolvable | undefined, v2 = this.v2): number {
    const { flags, dropped } = resolveFlags(step, requested, v2)
    if (dropped && development()) {
      logger.warn(`Dropped flags ${flagNames(dropped).join(', ')}, which a ${step} cannot take.`)
    }
    return flags
  }

  /**
   * Runs an answer step once every step asked for before it has settled, so each picks its Discord method from where
   * the last left the interaction. Steps call each other's unqueued forms, which never wait on the queue they run in.
   * A Discord call that hangs holds the steps after it until discord.js's REST timeout (15 s by default) rejects it.
   */
  private queued<T>(step: () => Promise<T>): Promise<T> {
    this.pending++
    const run = this.queue.then(step).finally(() => this.pending--)
    this.queue = run.catch(() => undefined)
    return run
  }

  acknowledge(options: { ephemeral?: boolean } = {}): Promise<void> {
    return this.queued(() => this.acknowledgeNow(options))
  }

  private acknowledgeNow(options: { ephemeral?: boolean } = {}): Promise<void> {
    this.sync()
    if (this.phase !== 'unanswered') return this.acknowledging ?? Promise.resolve()
    if (this.acknowledging) return this.acknowledging
    const acknowledging = this.runAcknowledge(options).finally(() => this.sync())
    this.acknowledging = acknowledging
    // Still unanswered after a failure, so the next answer acknowledges or replies rather than throwing it again
    acknowledging.catch(() => {
      if (this.acknowledging === acknowledging) this.acknowledging = undefined
    })
    return acknowledging
  }

  private async runAcknowledge({ ephemeral }: { ephemeral?: boolean }): Promise<void> {
    try {
      if (answersWithOwnMessage(this.interaction)) {
        const flags = this.flagsFor('deferReply', ephemeral ? MessageFlags.Ephemeral : 0)
        await this.call('deferReply', { flags }, () => this.interaction.deferReply({ flags }))
      } else if ('deferUpdate' in this.interaction) {
        const target = this.interaction
        await this.call('deferUpdate', undefined, () => target.deferUpdate())
      }
      this.phase = 'deferred'
    } catch (error) {
      if (errorCode(error) !== ALREADY_ACKNOWLEDGED) throw error
      this.answeredElsewhere()
    }
  }

  private async acknowledgeUnanswered(options: { ephemeral?: boolean } = {}): Promise<void> {
    try {
      await this.acknowledgeNow(options)
    } catch (error) {
      logFailedSend(logger, 'acknowledge', error)
    }
  }

  /** Sets what `@Defer` asks of every answer, notifications suppressed on new messages, and marks the state as under `@Defer`. */
  configure({ suppressNotifications = false }: { suppressNotifications?: boolean }): void {
    this.suppressNotifications = suppressNotifications
    this.underDefer = true
  }

  /**
   * Acknowledges after `delayMs` unless the interaction is answered first, as `@Defer({ mode: 'auto' })`
   * does. A timer cannot fire while synchronous work blocks the event loop.
   */
  scheduleAcknowledge(delayMs: number, options: { ephemeral?: boolean } = {}): void {
    this.cancelScheduled()
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.sync()
      if (this.phase !== 'unanswered') {
        this.warnIfAnsweredOutside()
        return
      }
      this.queued(async () => {
        await this.acknowledgeNow(options)
        if (this.pendingLock) await this.lockNow(this.pendingLock)
      }).catch(error => logFailedSend(logger, 'acknowledge in time', error))
    }, delayMs)
    this.timer.unref?.()
  }

  private cancelScheduled(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    this.pendingLock = undefined
  }

  private warnIfAnsweredOutside(): void {
    if (this.calls.length === 0 && (this.interaction.replied || this.interaction.deferred) && development()) {
      logger.warn(
        'An interaction under @Defer was answered with a raw discord.js call; answer through respond(interaction) ' +
          'so its state stays in step.',
      )
    }
  }

  lock(options: ResponseLockOptions = {}): Promise<void> {
    return this.queued(() => this.lockNow(options))
  }

  private async lockNow({ disable = 'all' }: ResponseLockOptions): Promise<void> {
    if (this.snapshot || disable === 'none' || answersWithOwnMessage(this.interaction)) return
    const message = 'message' in this.interaction ? this.interaction.message : undefined
    if (!message) return
    if (this.timer) {
      // Not acknowledged yet under 'auto': lock only if the timer fires before an answer.
      this.pendingLock = { disable }
      return
    }
    await this.acknowledgeNow()
    this.sync()
    if (this.phase === 'replied' && !this.acknowledging) return

    const theme = await themeForInteraction(this.interaction)
    // Drawn only now, after the acknowledgement, so a slow drawing never misses Discord's three seconds
    const view = await this.drawnLoading(theme, attachmentList(message).length)
    const loadingEmbed = renderEmbed(view)
    const key = typeof message.id === 'string' ? message.id : message
    // A message another call holds is snapshotted as it was before any lock, not as that call's lock shows it
    let entry = messageLocks.get(key)
    if (!entry) {
      entry = {
        original: {
          components: withoutRenderedViews(message.components.map(component => component.toJSON() as unknown as Record<string, unknown>)),
          embeds: message.embeds.map(embed => embed.toJSON()).filter(embed => !sameEmbed(embed, loadingEmbed)),
        },
        attachments: attachmentList(message),
        holders: new Map(),
      }
      messageLocks.set(key, entry)
    }
    clearTimeout(entry.forget)
    const clickedId = 'customId' in this.interaction ? this.interaction.customId : undefined
    entry.holders.set(this, { disable, clickedId, loadingEmoji: view.emoji })
    this.snapshot = entry.original
    this.held = { key, entry }
    this.lockEntry = entry
    this.loadingView = view
    try {
      await this.editMessage(this.heldBody(entry, entry.original, view), { restoring: true })
    } catch (error) {
      if (!view.files?.length || !isTooLarge(error)) throw error
      this.warnFilesDropped(REFUSED_AS_TOO_LARGE)
      this.loadingView = withoutFiles(view)
      await this.editMessage(this.heldBody(entry, entry.original, this.loadingView), { restoring: true })
    }
    this.settled = false
  }

  /** A message as `base` shows it, with every control a call still holding it disabled, and the loading view. */
  private heldBody(entry: MessageLock, base: Snapshot, view: ResponseView | undefined): Body {
    const locked = [...entry.holders.values()].reduce<Record<string, unknown>[]>(
      (components, options) => lockComponents(components, options),
      base.components,
    )
    if (!view || entry.holders.size === 0) return this.leavingDrawn(entry, this.v2 ? { components: locked } : { components: locked, embeds: base.embeds })
    let body: Body
    let shown: boolean
    if (this.v2) {
      const withView = [...locked, renderContainer(view) as unknown as Record<string, unknown>]
      shown = countComponents(withView) <= V2_COMPONENT_LIMIT
      body = { components: shown ? withView : locked }
    } else {
      shown = base.embeds.length < EMBED_LIMIT
      body = { components: locked, embeds: shown ? [...base.embeds, renderEmbed(view)] : base.embeds }
    }
    const files = shown ? attachmentsOf(view) : []
    if (files.length === 0) return this.leavingDrawn(entry, body)
    entry.drawn = true
    return { ...body, files, attachments: [...entry.attachments] }
  }

  /** `body`, listing the message's own attachments when a loading view's files are on it, so the edit takes them off. */
  private leavingDrawn(entry: MessageLock, body: Body): Body {
    if (!entry.drawn) return body
    entry.drawn = false
    return { ...body, attachments: [...entry.attachments] }
  }

  /**
   * Stops holding the locked message. `left` is the message as this call leaves it, for calls that lock
   * it later; a message changed outside MeoCord is forgotten. Once no call holds it, it is forgotten
   * after `LOCK_MEMORY_MS`, which covers a click made on the lock and snapshotted after it settled.
   */
  private leave({ left, changedOutside = false }: { left?: Snapshot; changedOutside?: boolean } = {}): void {
    if (!this.held) return
    const { key, entry } = this.held
    this.held = undefined
    entry.holders.delete(this)
    if (left) entry.original = left
    if (entry.holders.size > 0) return
    if (changedOutside) {
      messageLocks.delete(key)
      return
    }
    entry.forget = setTimeout(() => {
      if (messageLocks.get(key) === entry && entry.holders.size === 0) messageLocks.delete(key)
    }, LOCK_MEMORY_MS)
    entry.forget.unref?.()
  }

  /**
   * Puts a locked message back as it was, unless something else changed it since the lock. `@Defer`
   * calls it after the handler, for a handler that never answered. Never throws.
   */
  release(): Promise<void> {
    const waiting = this.timer !== undefined
    this.cancelScheduled()
    return this.queued(async () => {
      // A component's handler that returned before the 'auto' timer, unanswered, gets eager's invisible acknowledgement
      if (waiting && !answersWithOwnMessage(this.interaction)) await this.acknowledgeUnanswered()
      this.warnIfAnsweredOutside()
      try {
        await this.restore()
      } catch (error) {
        logFailedSend(logger, 'restore the message', error)
      }
    })
  }

  /** Restores the snapshot while the message still shows the lock. */
  private async restore(): Promise<void> {
    // A call holds its message from the lock until it settles, so an unsettled lock always has its entry
    const entry = this.held?.entry
    if (!entry || this.settled) return
    this.settled = true
    try {
      const current = await this.interaction.fetchReply()
      if (editedSince(current?.editedTimestamp, entry.editedAt)) {
        this.leave({ changedOutside: true })
        return
      }
    } catch {
      // The message cannot be read here, as in a direct message the bot is not in: restore anyway.
    }
    this.leave()
    // Calls still holding the message keep their controls disabled
    await this.editMessage(this.heldBody(entry, entry.original, this.loadingView), { restoring: true })
  }

  /**
   * Undoes `@Defer`'s acknowledgement after a guard denied the call silently: a command's deferred
   * reply is deleted while nothing was sent into it; a component's invisible acknowledgement needs
   * nothing. Never throws.
   */
  abandon(): Promise<void> {
    const waiting = this.timer !== undefined
    this.cancelScheduled()
    return this.queued(async () => {
      // Denied before the 'auto' timer: acknowledged here, since Discord tells the user an unanswered call failed
      if (waiting) await this.acknowledgeUnanswered({ ephemeral: true })
      this.sync()
      const onlyDeferred = this.calls.every(call => call.method === 'deferReply')
      if (this.phase !== 'deferred' || !answersWithOwnMessage(this.interaction) || !onlyDeferred) return
      try {
        await this.call('deleteReply', undefined, () => this.interaction.deleteReply())
      } catch (error) {
        logFailedSend(logger, 'delete the deferred reply', error)
      }
    })
  }

  send(payload: ResponsePayload, options?: ResponseSendOptions): Promise<Message | undefined> {
    this.cancelScheduled()
    return this.queued(async () => {
      this.sync()
      this.refuseAfterModal()
      const body = this.withRestore(await this.themed(payload, options))
      if (this.phase !== 'unanswered') return this.editMessage(body)
      return answersWithOwnMessage(this.interaction) ? this.reply(body) : this.update(body)
    })
  }

  edit(payload: ResponseEditPayload, options?: ResponseSendOptions): Promise<Message | undefined> {
    return this.send(payload as ResponsePayload, options)
  }

  followUp(payload: ResponsePayload, options?: ResponseSendOptions): Promise<Message | undefined> {
    this.cancelScheduled()
    return this.queued(() => this.followUpNow(payload, options))
  }

  private async followUpNow(payload: ResponsePayload, options?: ResponseSendOptions): Promise<Message | undefined> {
    this.sync()
    const body = await this.themed(payload, options)
    if (this.phase === 'unanswered') return this.reply(body)
    if (this.phase === 'deferred' && answersWithOwnMessage(this.interaction)) {
      // Discord makes a follow-up to a deferred, unsent reply that reply, ignoring its flags: a private one
      // would be shown to everyone on a public deferral, so that deferral is deleted first.
      const requested = Number(MessageFlagsBitField.resolve(body.flags ?? 0))
      if (!hasEphemeral(requested)) return this.editMessage(body)
      // A private deferral is already what the flag asks for, which an edit cannot take
      if (this.interaction.ephemeral) return this.editMessage({ ...body, flags: requested & ~MessageFlags.Ephemeral })
      await this.call('deleteReply', undefined, () => this.interaction.deleteReply())
      this.phase = 'replied'
    }
    const flags = this.withSuppression(this.flagsFor('followUp', body.flags, false))
    const sent = forMode(body, hasComponentsV2(flags))
    const message = await this.call('followUp', { ...sent, flags }, () =>
      this.interaction.followUp({ ...sent, flags } as InteractionReplyOptions),
    )
    return message as Message
  }

  delete(): Promise<void> {
    return this.queued(async () => {
      this.sync()
      if (this.phase === 'unanswered') throw new Error('There is no answer to delete: the interaction has not been answered.')
      this.refuseAfterModal()
      await this.call('deleteReply', undefined, () => this.interaction.deleteReply())
    })
  }

  /** A modal is the interaction's whole answer: what the user enters arrives as a submit interaction of its own. */
  private refuseAfterModal(): void {
    if (this.modalShown) {
      throw new Error("This interaction was answered with a modal, which has no message to edit or delete; answer the modal's submit instead.")
    }
  }

  async modal(modal: JSONEncodable<APIModalInteractionResponseCallbackData> | ModalComponentData): Promise<void> {
    this.cancelScheduled()
    this.sync()
    // Refused at once while any answer is in flight, since a modal can only be the first
    if (this.phase !== 'unanswered' || this.pending > 0) {
      throw new Error(
        this.underDefer
          ? 'A modal must be the first response to an interaction, and @Defer acknowledged it before the handler ran. ' +
              "Remove @Defer from a handler that shows a modal, or use @Defer({ mode: 'auto' }), which acknowledges only a slow handler."
          : 'A modal must be the first response to an interaction, and this one is already acknowledged.',
      )
    }
    if (!('showModal' in this.interaction)) throw new Error('This interaction cannot show a modal.')
    const target = this.interaction
    return this.queued(async () => {
      // A first answer like a reply: one refused as already acknowledged leaves the interaction answered elsewhere
      await this.firstAnswer(() => this.call('showModal', modal, () => target.showModal(modal)))
      this.phase = 'replied'
      this.modalShown = true
    })
  }

  /** The payload as a body, filled with the theme's primary colour unless `fill: false` asks for it as written. */
  private async themed(payload: ResponsePayload, options: ResponseSendOptions | undefined): Promise<Body> {
    const body = toBody(payload)
    return options?.fill === false ? body : withThemeColours(body, await themeForInteraction(this.interaction))
  }

  /** Omitted components and embeds put back the message as it was before the lock. */
  private withRestore(body: Body): Body {
    if (!this.snapshot || this.settled) return body
    const entry = this.held?.entry
    const base = entry?.original ?? this.snapshot
    const left: Snapshot = {
      components: body.components === undefined ? base.components : body.components.map(toJson),
      embeds: body.embeds === undefined ? base.embeds : (body.embeds.map(toJson) as APIEmbed[]),
    }
    this.leave({ left })
    // Calls still holding the message keep their controls disabled
    const components = entry && entry.holders.size > 0 ? this.heldBody(entry, left, undefined).components : body.components
    return {
      ...body,
      components: components ?? base.components,
      ...(body.embeds === undefined && !this.v2 ? { embeds: base.embeds } : {}),
    }
  }

  /** A payload that sets no flags keeps the edited message's suppressed embeds, as a raw edit does. */
  private keptFlags(body: Body): number {
    return body.flags === undefined && this.message?.flags?.has(MessageFlags.SuppressEmbeds) ? MessageFlags.SuppressEmbeds : 0
  }

  private withSuppression(flags: number): number {
    return this.suppressNotifications ? flags | MessageFlags.SuppressNotifications : flags
  }

  private async reply(body: Body): Promise<Message | undefined> {
    this.cancelScheduled()
    const flags = this.withSuppression(this.flagsFor('reply', body.flags, false))
    this.v2 = hasComponentsV2(flags)
    const sent = forMode(body, this.v2)
    const response = await this.firstAnswer(() =>
      this.call('reply', { ...sent, flags }, () =>
        this.interaction.reply({ ...sent, flags, withResponse: true } as InteractionReplyOptions & { withResponse: true }),
      ),
    )
    this.phase = 'replied'
    this.lastMessage = response?.resource?.message ?? this.lastMessage
    return this.lastMessage
  }

  private async update(body: Body): Promise<Message | undefined> {
    if (!('update' in this.interaction)) return this.reply(body)
    this.cancelScheduled()
    this.settled = true
    const flags = this.flagsFor('update', body.flags) | this.keptFlags(body)
    this.v2 ||= hasComponentsV2(flags)
    const sent = this.withAttachments(forMode(body, this.v2))
    const target = this.interaction
    const response = await this.firstAnswer(() =>
      this.call('update', { ...sent, flags }, () => target.update({ ...sent, flags, withResponse: true } as never)),
    )
    this.phase = 'replied'
    this.lastMessage = (response as { resource?: { message?: Message } })?.resource?.message ?? this.lastMessage
    return this.lastMessage
  }

  /** Makes a first answer; one Discord refuses as already acknowledged leaves the interaction answered, as for a deferral. */
  private async firstAnswer<T>(answer: () => Promise<T>): Promise<T> {
    try {
      return await answer()
    } catch (error) {
      if (errorCode(error) === ALREADY_ACKNOWLEDGED) this.answeredElsewhere()
      throw error
    }
  }

  /**
   * Records an acknowledgement made elsewhere, which discord.js did not see, on the interaction as well: discord.js
   * refuses an edit or a follow-up of an interaction it holds unanswered.
   */
  private answeredElsewhere(): void {
    this.interaction.replied = true
    this.phase = 'replied'
  }

  private withAttachments(body: Body): Body {
    return rewriteAttachmentUrls(body, keptAttachmentNames(body, this.message?.attachments?.values() ?? []))
  }

  /** Edits the answer through the interaction, and through the channel only once its token has expired. */
  private async editMessage(body: Body, { restoring = false } = {}): Promise<Message | undefined> {
    if (!restoring) {
      this.settled = true
      this.leave()
    }
    // An answer that takes the place of a drawn loading view leaves its files out, keeping the message's own
    const entry = this.lockEntry
    if (!restoring && entry?.drawn && body.attachments === undefined) {
      entry.drawn = false
      body = { ...body, attachments: [...entry.attachments] }
    }
    const flags = this.flagsFor('edit', body.flags) | this.keptFlags(body)
    this.v2 ||= hasComponentsV2(flags)
    const sent = { ...this.withAttachments(forMode(body, this.v2)), flags }
    try {
      this.lastMessage = await this.call('editReply', sent, () => this.interaction.editReply(sent as InteractionEditReplyOptions))
    } catch (error) {
      const message = this.message
      const expired = Date.now() - this.interaction.createdTimestamp >= TOKEN_EXPIRED_AFTER_MS
      if (!TOKEN_EXPIRED.has(errorCode(error) as number) || !expired || !this.location.botInstalled || !message) throw error
      this.lastMessage = await this.call('message.edit', sent, () => message.edit(sent as never))
    }
    this.phase = 'replied'
    // When MeoCord last edited the locked message, for a restore to tell whether something else edited it since
    if (this.lockEntry && !answersWithOwnMessage(this.interaction)) {
      this.lockEntry.editedAt = this.lastMessage?.editedTimestamp ?? undefined
    }
    return this.lastMessage
  }

  private render(view: ResponseView, v2: boolean): Body {
    const body: Body = v2
      ? { components: [renderContainer(view)], flags: MessageFlags.IsComponentsV2 }
      : { embeds: [renderEmbed(view)] }
    const files = attachmentsOf(view)
    return files.length > 0 ? { ...body, files } : body
  }

  /** A view Discord takes, its files dropped with a warning when it would refuse them; `kept` attachments stay beside them. */
  private sendable(view: ResponseView, kept = 0): ResponseView {
    const limit = (this.interaction as { attachmentSizeLimit?: unknown }).attachmentSizeLimit
    const sizeLimit = typeof limit === 'number' && limit > 0 ? limit : DEFAULT_ATTACHMENT_SIZE_LIMIT
    return withSendableFiles(view, { kept, sizeLimit }, problem => this.warnFilesDropped(problem))
  }

  /** Warns that a view goes without its files, and why. */
  private warnFilesDropped(problem: string): void {
    const named = presenterName(presenterFor(this.interaction.client))
    logger.warn(`${named}'s view for ${describeInteraction(this.interaction as Interaction)} is sent without its files: ${problem}.`)
  }

  /**
   * Sends `view` with `send`, and again without its files should Discord refuse them as too large, as for a file whose
   * size could not be checked before, so the answer still reaches the user.
   */
  private async withFilesFallback(view: ResponseView, send: (view: ResponseView) => Promise<void>): Promise<void> {
    try {
      await send(view)
    } catch (error) {
      if (!view.files?.length || !isTooLarge(error)) throw error
      this.warnFilesDropped(REFUSED_AS_TOO_LARGE)
      await send(withoutFiles(view))
    }
  }

  /**
   * `ifUnanswered`, for MeoCord's own answers alone: the answer is moot once anything else has answered, as for
   * "Command not found!" to a click a collector took, so Discord refusing it as already answered ends it.
   */
  async error(error: unknown, options: ResponseErrorOptions = {}, answer: { ifUnanswered?: boolean } = {}): Promise<void> {
    try {
      await this.presentAnswer(error, options, answer)
    } catch (renderError) {
      logger.error(`Could not write the error answer for ${describeInteraction(this.interaction as Interaction)}:`, renderError)
    }
  }

  /**
   * {@link error}, but throwing when the presenter fails to build the view, for MeoCord's own fallback to report
   * that fault; a failed delivery is logged, as by `error()`.
   */
  presentAnswer(error: unknown, options: ResponseErrorOptions = {}, answer: { ifUnanswered?: boolean } = {}): Promise<void> {
    return this.queued(() => this.presentAnswerNow(error, options, answer))
  }

  private async presentAnswerNow(error: unknown, options: ResponseErrorOptions, { ifUnanswered = false }: { ifUnanswered?: boolean }): Promise<void> {
    // A UserError is the user's own mistake: its message, for them alone, unless told otherwise
    const own = error instanceof UserError
    const { message = own ? error.message : textFor(this.interaction, { key: 'meocord.fallback.error' }), visibility = own ? 'private' : 'reply' } = options
    const theme = await themeForInteraction(this.interaction)
    // Drawn before anything is sent; a presenter that fails is answered for with MeoCord's own view, then thrown to
    // the caller, which reports it as the call's fault rather than passing it for a refusal
    const { view, failure, gone } = await this.drawnView(error, message, theme)
    // Its refusal already logged, an interaction Discord no longer knows is not answered again
    if (!gone) await this.deliverError(view, visibility, ifUnanswered)
    if (failure !== undefined) throw failure
  }

  /** Sends an error's view where the interaction stands; a delivery Discord refuses is logged, never thrown. */
  private async deliverError(view: ResponseView, visibility: 'reply' | 'private', ifUnanswered: boolean): Promise<void> {
    try {
      await this.withFilesFallback(view, shown => this.presentError(shown, visibility, ifUnanswered))
    } catch (deliveryError) {
      if (errorCode(deliveryError) !== ALREADY_ACKNOWLEDGED) {
        logFailedSend(logger, 'deliver the error reply', deliveryError)
        return
      }
      // Answered by something discord.js did not see: follow up once instead, unless the answer was only for
      // an interaction nothing else answered
      this.answeredElsewhere()
      if (ifUnanswered) return
      try {
        await this.withFilesFallback(view, async shown => void (await this.followUpNow(this.privateError(shown))))
      } catch (retryError) {
        logFailedSend(logger, 'deliver the error reply', retryError)
      }
    }
  }

  private presenterContext(v2: boolean, theme: ResolvedTheme): ResponseContext {
    return { interaction: this.interaction as Interaction, locale: this.interaction.locale, mode: v2 ? 'v2' : 'embed', theme }
  }

  /**
   * The presenter's error view, drawn and rendered as one step. One it draws asynchronously has the interaction
   * acknowledged privately first, so the drawing never misses Discord's three seconds; `gone` when Discord no longer
   * knows the interaction. Should the presenter fail, or draw a view MeoCord cannot render, MeoCord's own view takes its
   * place, and the failure is returned for the caller to report once the user is answered.
   */
  private async drawnView(
    error: unknown,
    message: string,
    theme: ResolvedTheme,
  ): Promise<{ view: ResponseView; failure?: unknown; gone?: boolean }> {
    const tone = isUserOutcome(error, this.interaction) ? 'warning' : 'danger'
    const presented = { message, error, tone } as const
    const context = this.presenterContext(this.v2, theme)
    const ready = (view: ResponseView) => {
      const sendable = this.sendable(themedView(view, theme), this.keptBeside())
      // Rendered once here, so a view MeoCord cannot render fails before anything is sent
      this.render(sendable, this.v2)
      return sendable
    }
    const fallback = (failure: unknown) => ({ view: ready(defaultPresenter.error(context, presented)), failure })
    let produced: ResponseView | Promise<ResponseView>
    try {
      produced = presenterFor(this.interaction.client).error(context, presented)
    } catch (failure) {
      return fallback(failure)
    }
    // Set when the interaction is one Discord no longer knows, which takes no answer at all
    let gone = false
    if (isDrawing(produced)) {
      // Settled into a value now, so a drawing that rejects while the acknowledgement is awaited is still handled
      const drawing = Promise.resolve(produced).then(
        view => ({ view }),
        (failure: unknown) => ({ failure }),
      )
      this.sync()
      // Discord's refusal is the acknowledgement's, never the presenter's, and is logged once
      if (this.phase === 'unanswered') {
        await this.acknowledgePrivately().catch((refusal: unknown) => {
          gone = errorCode(refusal) === UNKNOWN_INTERACTION
          logFailedSend(logger, 'acknowledge the interaction privately', refusal)
        })
      }
      const drawn = await drawing
      if ('failure' in drawn) return { ...fallback(drawn.failure), gone }
      produced = drawn.view
    }
    try {
      return { view: ready(produced), gone }
    } catch (failure) {
      return { ...fallback(failure), gone }
    }
  }

  /**
   * The presenter's loading view, drawn and rendered as one step after the lock acknowledged the click. Should the
   * presenter throw or reject, take longer than {@link LOADING_DRAW_TIMEOUT_MS}, or draw a view MeoCord cannot render,
   * it is warned about and MeoCord's own loading view is shown, so the lock, and the handler after it, still go ahead.
   */
  private async drawnLoading(theme: ResolvedTheme, kept: number): Promise<ResponseView> {
    const context = this.presenterContext(this.v2, theme)
    const ready = (view: ResponseView) => {
      const sendable = this.sendable(themedView(view, theme), kept)
      this.render(sendable, this.v2)
      return sendable
    }
    const presenter = presenterFor(this.interaction.client)
    const shownInstead = (problem: string, failure?: unknown) => {
      const named = `${presenterName(presenter)}'s loading view ${problem} for ${describeInteraction(this.interaction as Interaction)}`
      if (failure === undefined) logger.warn(`${named}; MeoCord's own is shown.`)
      else logger.warn(`${named}; MeoCord's own is shown:`, failure)
      return ready(defaultPresenter.loading(context))
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const produced = presenter.loading(context)
      if (!isDrawing(produced)) return ready(produced)
      const late = new Promise<typeof LATE>(resolve => {
        timer = setTimeout(() => resolve(LATE), LOADING_DRAW_TIMEOUT_MS)
      })
      const drawn = await Promise.race([produced, late])
      if (drawn !== LATE) return ready(drawn)
      // Never applied over MeoCord's view, and a late failure is no unhandled rejection
      produced.then(undefined, () => undefined)
      return shownInstead(`did not come within ${LOADING_DRAW_TIMEOUT_MS} ms`)
    } catch (failure) {
      return shownInstead('could not be drawn', failure)
    } finally {
      clearTimeout(timer)
    }
  }

  /** How many attachments the message an error view may be added to keeps: a private component message's own. */
  private keptBeside(): number {
    if (answersWithOwnMessage(this.interaction) || this.modalShown) return 0
    const current = 'message' in this.interaction ? (this.interaction.message ?? undefined) : this.message
    return current?.flags?.has(MessageFlags.Ephemeral) ? attachmentList(current).length : 0
  }

  /** Acknowledges with a private deferred reply, which the error view then replaces, as a private reply would show it. */
  private async acknowledgePrivately(): Promise<void> {
    const flags = this.flagsFor('deferReply', MessageFlags.Ephemeral)
    try {
      await this.call('deferReply', { flags }, () => this.interaction.deferReply({ flags }))
      this.phase = 'deferred'
      this.privateDeferral = true
    } catch (error) {
      if (errorCode(error) !== ALREADY_ACKNOWLEDGED) throw error
      this.answeredElsewhere()
    }
  }

  private privateError(view: ResponseView): ResponsePayload {
    const body = this.render(view, this.v2)
    return { ...body, flags: Number(body.flags ?? 0) | MessageFlags.Ephemeral } as ResponsePayload
  }

  private async presentError(view: ResponseView, visibility: 'reply' | 'private', ifUnanswered = false): Promise<void> {
    this.sync()
    // The private deferral made for a drawn view is that view's reply
    if (this.privateDeferral && this.phase === 'deferred') {
      await this.editMessage(this.render(view, this.v2))
      this.privateDeferral = false
      return
    }
    if (this.phase === 'unanswered') {
      await this.reply(toBody(this.privateError(view)))
      return
    }
    // Answered meanwhile, as by a collector while the theme was looked up: an answer only for an unanswered one is moot
    if (ifUnanswered) return

    // A command answers with its own reply; a modal leaves no message to edit, so its error follows up too
    if (answersWithOwnMessage(this.interaction) || this.modalShown) {
      if (this.phase === 'deferred' && visibility === 'reply') {
        await this.editMessage(this.render(view, this.v2))
        return
      }
      // A private follow-up edits a private deferral into it, and replaces a public one
      await this.followUpNow(this.privateError(view))
      return
    }

    // The message the component is on: whether it is private does not change with edits.
    const current = 'message' in this.interaction ? (this.interaction.message ?? undefined) : this.message
    if (current?.flags?.has(MessageFlags.Ephemeral)) {
      const appended = this.appendError(current, view)
      if (this.fits(appended)) {
        await this.editMessage(appended)
        return
      }
    }
    await this.restore()
    await this.followUpNow(this.privateError(view))
  }

  /** Whether a message stays within Discord's limits of 10 embeds and of Components V2 components. */
  private fits(body: Body): boolean {
    return this.v2
      ? countComponents((body.components ?? []) as Record<string, unknown>[]) <= V2_COMPONENT_LIMIT
      : (body.embeds?.length ?? 0) <= EMBED_LIMIT
  }

  /** The private message the component is on, as it was before loading, with the error added. */
  private appendError(current: Message, view: ResponseView): Body {
    const base = this.snapshot ?? {
      components: current.components.map(component => component.toJSON()),
      embeds: current.embeds.map(embed => embed.toJSON()),
    }
    const body: Body = this.v2
      ? { components: [...base.components, renderContainer(view)] }
      : { components: base.components, embeds: [...base.embeds, renderEmbed(view)] }
    const files = attachmentsOf(view)
    return files.length > 0 ? { ...body, files, attachments: attachmentList(current) } : body
  }
}

const states = new WeakMap<object, InteractionResponse>()

/** The response state of a repliable interaction, created on first use. */
export function responseOf(interaction: RepliableInteraction): InteractionResponse {
  let state = states.get(interaction)
  if (!state) states.set(interaction, (state = new InteractionResponse(interaction)))
  return state
}

/**
 * The response state of an interaction, through which its replies, edits, follow-ups and errors go.
 *
 * Use it for every answer a handler, a guard, an interceptor, a filter or a collector's callback gives an interaction.
 * There is one per interaction, created on first use.
 *
 * @remarks
 * Each call picks the Discord method from where the answer stands, re-read from the interaction, so answers made
 * directly with discord.js or by a collector still count. Answers use the interaction's own methods, which work
 * wherever the interaction happened, including user-installed apps in servers and direct messages the bot is not in.
 *
 * @param interaction - A command, component or modal submission.
 * @returns The interaction's response state.
 *
 * @example
 * ```typescript
 * constructor(private readonly profiles: ProfileService) {}
 *
 * @Command('profile', CommandType.SLASH)
 * async profile(interaction: ChatInputCommandInteraction) {
 *   await respond(interaction).acknowledge()
 *   const card = await this.profiles.render(interaction.user.id)
 *   await respond(interaction).send({ embeds: [card] })
 * }
 * ```
 *
 * @group Responses
 */
export function respond(interaction: Interaction): ResponseState {
  if (!interaction.isRepliable()) {
    throw new Error('respond() takes a command, component or modal submission; autocomplete answers with respond([]).')
  }
  return responseOf(interaction)
}

/** The response state of an interaction, if `respond()` created one. */
export function existingResponse(interaction: object): InteractionResponse | undefined {
  return states.get(interaction)
}

