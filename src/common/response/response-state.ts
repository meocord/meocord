import { AsyncResource } from 'node:async_hooks'
import {
  type AnySelectMenuInteraction,
  type APIEmbed,
  type APIMessageTopLevelComponent,
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
  embedLength,
  type RepliableInteraction,
  resolveColor,
} from 'discord.js'
import { warnDeprecated } from '@src/common/deprecation.js'
import { Logger } from '@src/common/logger.js'
import { UserError } from '@src/common/errors.js'
import { textFor } from '@src/common/meocord-text.js'
import { logFailedSend } from '@src/common/response/send-failure.js'
import { describeInteraction } from '@src/util/interaction.util.js'
import { getInstallContext, type InstallContext, isBotInstalled } from '@src/common/response/install-context.js'
import {
  droppedFlagsWarning,
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
  presentedMessage,
  presenterFor,
  REFUSED_AS_TOO_LARGE,
  renderContainer,
  renderEmbed,
  withoutFiles,
  TEXT_LIMITS,
  withSendableFiles,
} from '@src/common/response/presenter.js'
import {
  countComponents,
  countText,
  EMBED_LIMIT,
  EMBED_TEXT_LIMIT,
  lockComponents,
  type LockOptions,
  sameEmbed,
  V2_COMPONENT_LIMIT,
  withoutRenderedViews,
} from '@src/common/response/components.js'
import { stampCall, startOwnCall } from '@src/common/response/call-order.js'
import { type ResponseContext, type ResponsePresenter, type ResponseView } from '@src/interface/index.js'
import { isUserOutcome } from '@src/common/user-outcome.js'
import { type ResolvedTheme, themeForInteraction } from '@src/core/theme-scope.js'
import { LOADING_DRAW_TIMEOUT_MS } from '@src/core/theme-resolvers.js'
import { shared } from '@src/util/shared-state.util.js'

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

/**
 * Options for {@link ResponseState.lock}.
 *
 * @group Responses
 */
export interface ResponseLockOptions {
  /**
   * Which controls to disable: every control on the message (`'all'`, the default), only the one the
   * user used (`'clicked'`), or none (`'none'`), which leaves the message as it is, with no loading view.
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
 * One answer call an interaction got, as `getResponse` from `meocord/testing` reports it: made through `respond()`, or
 * with discord.js directly on a mock interaction.
 *
 * @group Responses
 */
export interface ResponseCall {
  /**
   * The Discord method it used; `respond` answers an autocomplete with its choices, and `message.edit` edits the message
   * itself, once the interaction's token has expired.
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
    | 'launchActivity'
    | 'sendPremiumRequired'
    | 'respond'
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
  /**
   * The message's own attachments when it was first locked, which an edit lists to keep them as a loading view's files
   * come and go.
   */
  attachments: unknown[]
  /** Whether a loading view put files of its own on it, which putting it back has to leave out. */
  drawn?: boolean
  /** The calls holding it, with the control each disabled, in the order they locked it. */
  holders: Map<InteractionResponse, LockOptions>
  /**
   * The edits made to it, one after another whichever call makes them, each drawn when its turn comes: Discord shows
   * the edit that lands last, so that one always draws the holders as they are.
   */
  edits: Promise<void>
  /**
   * When MeoCord last edited it, as Discord stamped the edit: a later stamp means something else edited it since.
   * Discord rewrites the components it returns, with ids and resolved media, so comparing them tells nothing.
   */
  editedAt?: number
  forget?: ReturnType<typeof setTimeout>
}

// Both builds of this meocord version keep one, so a message one locks, the other sees locked
const messageLocks = shared('messageLocks', () => new Map<unknown, MessageLock>())

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

  /**
   * The answer's message: the one this state last replied with, updated or edited, or the message a component is on. A
   * follow-up is it only once it is the answer, after replacing a public deferral or after `delete()`; after `delete()`
   * it is `undefined` until something is sent. Read-only: edit through the state.
   */
  readonly message: Message | undefined

  /** The components and embeds of the message before `@Defer` locked it; `undefined` until then. */
  readonly original: { readonly components: readonly APIMessageTopLevelComponent[]; readonly embeds: readonly APIEmbed[] } | undefined

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
   * presenter's loading view. Commands have no message to lock. Does nothing once locked, with `disable: 'none'`,
   * after the interaction was answered with a reply or a deferred reply, as by the app's own `deferReply()`, or once
   * Discord refused the acknowledgement because something else answered first, which may have been a reply.
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
   * After a private `followUp()` replaced a public deferral, it edits that follow-up. After `delete()` it sends a
   * follow-up, private when the deleted answer was unless `flags` say otherwise, and that follow-up is the answer.
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
   * Edits the answer, routed as `send()` is: an edit once the interaction is answered, of the follow-up that replaced
   * a public deferral, or, after `delete()`, a follow-up that becomes the answer.
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
   * deferral first, is sent privately, and is the answer `send()`, `edit()` and `delete()` act on. After `delete()`,
   * it is the answer too. After `modal()` it is sent as made, and Discord decides whether it accepts a follow-up
   * there; the modal's submit is the interaction to answer.
   *
   * @param payload - Text, or reply options; `Ephemeral` makes the follow-up private.
   * @param options - `fill: false` leaves this follow-up's embeds and containers uncoloured.
   * @returns The message sent, when Discord returns it.
   */
  followUp(payload: ResponsePayload, options?: ResponseSendOptions): Promise<Message | undefined>

  /**
   * Deletes the answer: the reply, the follow-up that replaced a public deferral, or for a component deferred
   * without a reply of its own, its message. `message` is then `undefined` until something is sent. Throws before any
   * answer, after `modal()`, which leaves no message, and again with nothing sent since the last `delete()`.
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
   * Presents an error, styled by the application's presenter, and never throws. A delivery Discord refuses for what it
   * reports, such as a missing permission, is logged at debug level; one whose body Discord could not read, a
   * presenter that fails, or any other failure, as an error.
   *
   * - Unanswered: a private reply. A select-menu pick is answered first with an update that sets no field, which
   *   puts the menu back as it was before the pick in the picker's client and changes nothing else, then follows up
   *   privately.
   * - A command whose reply is deferred: `'reply'` edits that reply into the error; `'private'` edits a
   *   private deferral into it, and deletes a public one, then follows up privately.
   * - A component on a private (ephemeral) message that MeoCord answered with an update or a deferred update: the
   *   error is added to that message, where it fits. Any other answer, such as one the handler made with discord.js,
   *   may be a reply, which an edit would replace, so the error follows up instead.
   * - Otherwise: a private follow-up. The message the user clicked is never edited into the error, only put back as
   *   it was before a lock. A select-menu pick MeoCord deferred and did not since edit is first put back with an edit
   *   that sets no field.
   *
   * A `UserError` shows its own message, privately, unless `options` say otherwise.
   *
   * @param error - The error, handed to the presenter so it can style it by kind.
   * @param options - What the user is told, and who sees it.
   */
  error(error: unknown, options?: ResponseErrorOptions): Promise<void>
}

/**
 * What Discord has been told about an interaction, as a wait for hooks under `@Defer` reads it: `told` once it has an
 * acknowledgement or an answer, `under way` while one is scheduled or on its way, `nothing` otherwise.
 */
export type Told = 'told' | 'under way' | 'nothing'

/**
 * Each state's Discord calls on their way, whether one went through and the step waiting for its theme before sending,
 * with whether its answer is private, and a promise settled at each change; kept beside the state rather than on it,
 * so a state's own keys, which a test may spread or compare, stay as they are.
 */
const tellings = new WeakMap<
  InteractionResponse,
  { inFlight: number; answered: boolean; preparing?: { ephemeral: boolean }; changed: PromiseWithResolvers<void> }
>()

/**
 * An acknowledgement asked for and still queued: its options, whether it still applies when a step would let it go
 * first, and the attempt it made first, if one did.
 */
interface AskedAcknowledgement {
  options: { ephemeral?: boolean }
  applies: () => boolean
  ahead?: Promise<void>
  /** Called with that attempt as it goes first, for whoever asked to settle with it rather than with the queue. */
  wentAhead?: (attempt: Promise<void>) => void
}

/** What {@link InteractionResponse.withdraw}'s deletion came to: whether the deferred reply is gone, and the error if it failed. */
export interface WithdrawnReply {
  deleted: boolean
  error?: unknown
}

/** What an answer asked for after a stop claimed the call's deferred reply for deletion rejects with. */
const WITHDRAWN_MESSAGE = 'The bot stopped before this call started; its deferred reply is deleted, and nothing more is sent for it.'

/** The response state behind `respond()`, with what `@Defer` and the testing helpers use besides. */
export class InteractionResponse implements ResponseState {
  // An own key, where it has always been, made a getter by the constructor: it reads the interaction's guildId, which
  // MeoCord's own answering doesn't need, so it is read on demand
  readonly location!: InstallContext
  #location?: InstallContext

  private phase: ResponsePhase = 'unanswered'
  private acknowledging?: Promise<void>
  /** The answer steps asked for, run one after another; `pending` counts those not yet settled. */
  private queue: Promise<unknown> = Promise.resolve()
  private pending = 0
  /** Whether the answer was a modal, which has no message to edit or delete. */
  private modalShown = false
  private v2: boolean
  private lastMessage?: Message
  /**
   * Which message is the answer: the interaction's own reply, a follow-up that took its place, with whether it is
   * private and Components V2, or none since `delete()`, with whether the deleted one was private. `sync()` leaves it
   * alone, so every edit follows it.
   */
  private answer:
    | { kind: 'original' }
    | { kind: 'followUp'; id: string; ephemeral: boolean; v2: boolean }
    | { kind: 'deleted'; ephemeral: boolean } = { kind: 'original' }
  private readonly calls: ResponseCall[] = []

  private snapshot?: Snapshot
  /** The message this call locked, shared with other calls holding it, while this one holds it. */
  private held?: { key: unknown; entry: MessageLock }
  /** The message this call locked, kept after it settles so its edits are still recorded there, and made in its order. */
  private lockEntry?: MessageLock
  /** The loading view this call drew on the message it locked, once Discord took its lock: until then, edits there leave it out. */
  private loadingView?: ResponseView
  /** Whether the interaction was acknowledged with a private deferred reply for a drawn error view, which that view replaces. */
  private privateDeferral = false
  /** Whether the locked message was answered, so nothing restores it again. */
  private settled = false
  private suppressNotifications = false
  // Set by @Defer's first step, so an error can name what acknowledged the interaction
  private underDefer = false
  /** Whether a raw discord.js call answered first, learned of in `sync()` whether or not `@Defer` configured the state yet. */
  #answeredRaw = false
  /** Whether the interaction's own reply was sent by a raw call, whose format an edit of it reads back first. */
  #replyFormatUnread = false
  /**
   * Whether a message MeoCord starts follows a Components V2 one: the component's message, until MeoCord's own reply
   * takes its place. A raw reply doesn't, so the answer's format and the one new messages follow stay apart.
   */
  #followsV2 = false
  /**
   * Set once this state answers with `update` or `deferUpdate`, which makes the original response the message the
   * component is on.
   */
  #answeredOnMessage = false
  /**
   * Set once Discord refuses this state's own acknowledgement because something it can't see answered first. That
   * answer may be a reply, which is then the original response, so no lock is drawn over it.
   */
  #acknowledgedElsewhere = false
  private timer?: ReturnType<typeof setTimeout>
  /** A lock `@Defer({ mode: 'auto' })` asked for before acknowledging, applied once the timer acknowledges. */
  private pendingLock?: ResponseLockOptions
  /** An acknowledgement asked for and still queued, which a step waiting only for its theme lets go first. */
  readonly #askedAcknowledgements = new Set<AskedAcknowledgement>()
  /** Whether this state was asked for an acknowledgement, which may still be on its way. */
  #acknowledgementAsked = false
  /** Whether this state was asked for anything but an acknowledgement: an answer, a deletion, a modal or a restore. */
  #answerAsked = false
  /** Whether {@link withdraw} ran; once it has, it gives the same result again. */
  #withdrawn = false
  /** The deletion {@link withdraw} claimed, after which no answer is sent. */
  #withdrawal?: Promise<WithdrawnReply>

  constructor(readonly interaction: RepliableInteraction) {
    Object.defineProperty(this, 'location', {
      get: () => (this.#location ??= getInstallContext(interaction)),
      enumerable: true,
      configurable: true,
    })
    const message = 'message' in interaction ? interaction.message : undefined
    this.v2 = this.#followsV2 = Boolean(message?.flags?.has(MessageFlags.IsComponentsV2))
  }

  get state(): ResponsePhase {
    this.sync()
    return this.phase
  }

  /** What Discord has been told: an acknowledgement or answer it has, one scheduled or on its way, or nothing. */
  get told(): Told {
    const telling = this.telling()
    if (this.phase !== 'unanswered' || telling.answered) return 'told'
    if (this.timer !== undefined || telling.inFlight > 0) return 'under way'
    // Answered with a raw discord.js call, which marks the interaction once Discord has it; read without moving the
    // phase, which a test's mock may mark before its call settles
    return this.interaction.replied || this.interaction.deferred ? 'told' : 'nothing'
  }

  /** Settles at the next change of what Discord has been told. */
  toldChanged(): Promise<void> {
    return this.telling().changed.promise
  }

  private telling() {
    let telling = tellings.get(this)
    if (!telling) tellings.set(this, (telling = { inFlight: 0, answered: false, changed: Promise.withResolvers() }))
    return telling
  }

  /** Wakes the waits that read {@link told}. */
  private toldChange(): void {
    const telling = this.telling()
    const { changed } = telling
    telling.changed = Promise.withResolvers()
    changed.resolve()
  }

  get message(): Message | undefined {
    // A deleted answer, or a follow-up in its place, leaves the component's own message behind
    if (this.answer.kind !== 'original') return this.lastMessage
    return this.lastMessage ?? ('message' in this.interaction ? (this.interaction.message ?? undefined) : undefined)
  }

  get original(): { readonly components: readonly APIMessageTopLevelComponent[]; readonly embeds: readonly APIEmbed[] } | undefined {
    // Each component is a top-level component's API JSON, as `toJSON()` gave it; the lock reads them as plain JSON
    return this.snapshot as { components: APIMessageTopLevelComponent[]; embeds: APIEmbed[] } | undefined
  }

  /** The Discord calls made through this state, for tests. */
  get history(): readonly ResponseCall[] {
    return this.calls
  }

  private sync(): void {
    // Where the state first learns of a first answer it didn't make; moving the phase on, it learns of it once
    if (this.phase === 'unanswered' && this.calls.length === 0 && (this.interaction.replied || this.interaction.deferred)) {
      this.#answeredRaw = true
      this.learnRawAnswer()
      this.warnAnsweredOutside()
    }
    if (this.interaction.replied) this.phase = 'replied'
    else if (this.interaction.deferred && this.phase === 'unanswered') this.phase = 'deferred'
  }

  /**
   * Takes in the format of a first answer a raw call made. discord.js gives `ephemeral` a value only in `reply()` and
   * `deferReply()`, whose message is the interaction's own reply; after `update()` or `deferUpdate()` the answer is the
   * component's message, whose format is known. A deferral is never Components V2 until edited, and a reply, or a
   * deferral edited since, keeps no flags in discord.js, so it is read back before its first edit.
   */
  private learnRawAnswer(): void {
    if (typeof this.interaction.ephemeral !== 'boolean') return
    this.v2 = false
    this.#replyFormatUnread = this.interaction.replied
  }

  /** Makes a Discord call, recorded as it is made so the order stays as issued, and marked with its error if it rejects. */
  private async call<T>(method: ResponseCall['method'], payload: unknown, run: () => Promise<T>): Promise<T> {
    const call: ResponseCall = { method, payload }
    stampCall(call)
    this.calls.push(call)
    // Every call but the first answer is made once Discord has one, so any call that goes through means it has
    const telling = this.telling()
    telling.inFlight++
    this.toldChange()
    try {
      const result = await startOwnCall(run)
      telling.answered = true
      return result
    } catch (error) {
      call.error = error
      // Refused as answered already, the interaction has an answer Discord holds
      if (errorCode(error) === ALREADY_ACKNOWLEDGED) telling.answered = true
      throw error
    } finally {
      // Before the caller moves the phase on, so `answered` is what a woken wait reads
      telling.inFlight--
      this.toldChange()
    }
  }

  private flagsFor(step: ResponseStep, requested: MessageFlagsResolvable | undefined, v2 = this.v2): number {
    const { flags, dropped } = resolveFlags(step, requested, v2)
    if (dropped && development()) {
      logger.warn(droppedFlagsWarning(step, dropped))
    }
    return flags
  }

  /**
   * Runs an answer step once every step asked for before it has settled, so each picks its Discord method from where
   * the last left the interaction. Steps call each other's unqueued forms, which never wait on the queue they run in.
   * A Discord call that hangs holds the steps after it until discord.js's REST timeout (15 s by default) rejects it.
   */
  private queued<T>(step: () => Promise<T>, kind: 'answer' | 'acknowledgement' | 'withdrawal' = 'answer'): Promise<T> {
    if (kind === 'answer') {
      // Claimed for deletion by a stop that dropped the call: an answer now would edit a reply about to be deleted
      if (this.#withdrawal) return Promise.reject(new Error(WITHDRAWN_MESSAGE))
      this.#answerAsked = true
    }
    this.pending++
    const run = this.queue.then(step).finally(() => this.pending--)
    this.queue = run.catch(() => undefined)
    return run
  }

  /** Settles once every answer step asked for so far has settled, whatever its outcome. */
  idle(): Promise<void> {
    return this.queue.then(() => undefined)
  }

  acknowledge(options: { ephemeral?: boolean } = {}): Promise<void> {
    return this.acknowledgeInTime(options)
  }

  /**
   * Acknowledges once the steps asked for before have settled, then runs `then` in the queue; unless one of them only
   * waits for its theme, as an answer outside a call or before the pipeline's own wait may.
   */
  private acknowledgeInTime(options: { ephemeral?: boolean }, then?: () => Promise<void>): Promise<void> {
    // Only a step already queued can let it go first
    const behind = this.pending > 0
    const ahead = Promise.withResolvers<void>()
    const queued = this.askAcknowledgement(
      options,
      wentAhead => {
        // Gone first, it is that attempt that settles this one, failure included
        if (wentAhead) return wentAhead
        const acknowledged = this.acknowledgeNow(options)
        return then ? acknowledged.then(then) : acknowledged
      },
      undefined,
      attempt => ahead.resolve(attempt),
    )
    // Gone ahead of a step waiting for its theme, whoever asked waits only for the acknowledgement, not for that step
    return behind ? Promise.race([queued, ahead.promise]) : queued
  }

  /**
   * Queues `step`, which acknowledges, unless a step ahead of it only waits for its theme: that would hold the
   * acknowledgement past its time, so it goes first, now or once that step starts waiting, if `applies` still says so
   * then, and the step answers once its theme is found. Standing in for that answer's own first reply, it is as private
   * as that answer. `step` gets the attempt that went first, if one did.
   */
  private askAcknowledgement(
    options: { ephemeral?: boolean },
    step: (ahead: Promise<void> | undefined) => Promise<void>,
    applies: () => boolean = () => true,
    wentAhead?: (attempt: Promise<void>) => void,
  ): Promise<void> {
    const asked: AskedAcknowledgement = { options, applies, wentAhead }
    this.#acknowledgementAsked = true
    const { preparing } = this.telling()
    if (preparing) this.goAhead(asked, preparing.ephemeral)
    else this.#askedAcknowledgements.add(asked)
    return this.queued(() => {
      this.#askedAcknowledgements.delete(asked)
      return step(asked.ahead)
    }, 'acknowledgement')
  }

  /** Lets an acknowledgement asked for go ahead of a step waiting for its theme, as private as that step's answer. */
  private goAhead(asked: AskedAcknowledgement, ephemeral: boolean): void {
    if (asked.ahead || !asked.applies()) return
    this.#askedAcknowledgements.delete(asked)
    asked.ahead = this.acknowledgeNow({ ...asked.options, ephemeral })
    // Its failure reaches whoever asked, once; until then it is not unhandled
    asked.ahead.catch(() => undefined)
    asked.wentAhead?.(asked.ahead)
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
        this.#answeredOnMessage = true
      }
      this.phase = 'deferred'
    } catch (error) {
      if (errorCode(error) !== ALREADY_ACKNOWLEDGED) throw error
      this.#acknowledgedElsewhere = true
      this.answeredElsewhere()
    }
  }

  /** Acknowledges an interaction a call leaves unanswered, in time as {@link acknowledgeInTime} does; a failure is logged. */
  private acknowledgeUnanswered(options: { ephemeral?: boolean } = {}): Promise<void> {
    return this.acknowledgeInTime(options).catch(error => logFailedSend(logger, 'acknowledge', error))
  }

  /** Sets what `@Defer` asks of every answer, notifications suppressed on new messages, and marks the state as under `@Defer`. */
  configure({ suppressNotifications = false }: { suppressNotifications?: boolean }): void {
    this.suppressNotifications = suppressNotifications
    // A raw first answer learned of before, as by a state read in an observer's onStart, is warned of now
    const learnedBefore = this.#answeredRaw && !this.underDefer
    this.underDefer = true
    if (learnedBefore) this.warnAnsweredOutside()
  }

  /**
   * Acknowledges after `delayMs` unless the interaction is answered first, as `@Defer({ mode: 'auto' })`
   * does: an answer's Discord call cancels it, while one still waiting for its theme does not, and is sent after it. A
   * timer cannot fire while synchronous work blocks the event loop. Until it fires or is cancelled, Discord's
   * acknowledgement counts as under way in {@link told}.
   */
  scheduleAcknowledge(delayMs: number, options: { ephemeral?: boolean } = {}): void {
    this.cancelScheduled()
    // Bound to the call it is armed in, so the loading view a pending lock draws reads the call's theme under any
    // scheduler, such as a test's fake timers, which run a callback outside the context it was armed in
    this.timer = setTimeout(AsyncResource.bind(() => {
      this.timer = undefined
      this.sync()
      if (this.phase !== 'unanswered') {
        this.toldChange()
        return
      }
      const telling = this.telling()
      // On its way from here until it settles, though queued behind earlier steps, so no wait reads `nothing` before it
      // is sent. Gone ahead of a step waiting for its theme, it leaves out the lock asked for, which would wait for the
      // same theme
      telling.inFlight++
      const acknowledging = this.acknowledgeInTime(options, async () => {
        if (this.pendingLock) await this.lockNow(this.pendingLock)
      })
      acknowledging
        .catch(error => logFailedSend(logger, 'acknowledge in time', error))
        .finally(() => {
          telling.inFlight--
          this.toldChange()
        })
    }), delayMs)
    this.timer.unref?.()
    this.toldChange()
  }

  private cancelScheduled(): void {
    const scheduled = this.timer !== undefined
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    this.pendingLock = undefined
    if (scheduled) this.toldChange()
  }

  /** Warns, under `@Defer` and in development, that a raw discord.js call answered the interaction first. */
  private warnAnsweredOutside(): void {
    if (this.underDefer && development()) {
      logger.warn(
        'An interaction under @Defer was answered with a raw discord.js call; answer through respond(interaction) ' +
          'so its state stays in step.',
      )
    }
  }

  lock(options: ResponseLockOptions = {}): Promise<void> {
    // A lock acknowledges for itself, unless a step waiting for its theme lets that go first while it still applies:
    // a lock that holds a message and isn't left to @Defer's timer; a failure reaches the lock
    return this.askAcknowledgement(
      {},
      ahead => (ahead ? ahead.then(() => this.lockNow(options)) : this.lockNow(options)),
      () => this.lockTarget(options.disable) !== undefined && !this.timer,
    )
  }

  /**
   * The message a lock would hold and the controls it disables: none for a call already holding it or answered over
   * it, for one that answers with its own message, or for `disable: 'none'`.
   */
  private lockTarget(
    disable: ResponseLockOptions['disable'] = 'all',
  ): { message: Message; disable: Exclude<ResponseLockOptions['disable'], 'none' | undefined> } | undefined {
    // An answer already sent to the message leaves nothing to hold, nor to put back over it
    if (this.snapshot || this.settled || disable === 'none' || answersWithOwnMessage(this.interaction)) return undefined
    const message = 'message' in this.interaction ? this.interaction.message : undefined
    return message ? { message, disable } : undefined
  }

  private async lockNow(options: ResponseLockOptions): Promise<void> {
    const target = this.lockTarget(options.disable)
    if (!target) return
    const { message, disable } = target
    if (this.timer) {
      // Not acknowledged yet under 'auto': lock only if the timer fires before an answer.
      this.pendingLock = { disable }
      return
    }
    await this.acknowledgeNow()
    this.sync()
    // Answered over since, or first by something else, whose answer may be a reply the lock would replace
    if ((this.phase === 'replied' && !this.acknowledging) || this.#acknowledgedElsewhere) return
    // Deferred with a reply, the app's own or a private one for an error view: that reply is the original response, which
    // the lock would replace. discord.js gives ephemeral a value only in reply() and deferReply(); this state's own
    // deferred update is known to have left the message the answer, whatever ephemeral a test gave
    if (this.phase === 'deferred' && !this.#answeredOnMessage && typeof this.interaction.ephemeral === 'boolean') return

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
        edits: Promise.resolve(),
      }
      messageLocks.set(key, entry)
    }
    clearTimeout(entry.forget)
    const clickedId = 'customId' in this.interaction ? this.interaction.customId : undefined
    entry.holders.set(this, { disable, clickedId, loadingEmoji: view.emoji })
    this.snapshot = entry.original
    this.held = { key, entry }
    this.lockEntry = entry
    // One turn for the lock and its retry without files, so no other edit there draws the refused view in between
    await this.takeTurn(() =>
      this.withFilesFallback(view, async shown => {
        // Set for the lock's own edit, and kept only once Discord takes it
        this.loadingView = shown
        try {
          await this.editMessageNow(this.heldBody(entry, entry.original), { restoring: true })
        } catch (error) {
          this.loadingView = undefined
          throw error
        }
      }),
    )
    this.settled = false
  }

  /**
   * A message as `base` shows it, with the control of each call holding it disabled and the loading view of the call
   * that locked it last, unless `withView` is false. A call counts once its lock has had its turn there.
   */
  private heldBody(entry: MessageLock, base: Snapshot, { withView = true } = {}): Body {
    const holding = [...entry.holders].filter(([holder]) => holder.loadingView)
    const locked = holding.reduce<Record<string, unknown>[]>((components, [, options]) => lockComponents(components, options), base.components)
    const view = withView ? holding.at(-1)?.[0].loadingView : undefined
    if (!view) return this.leavingDrawn(entry, this.v2 ? { components: locked } : { components: locked, embeds: base.embeds })
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
   * Ends a call a stop dropped before it started, which never reached `@Defer`'s lock, in one step as the stop decides.
   * An acknowledgement scheduled and not yet made is cancelled without one. A deferred reply this state made, or is
   * making, with nothing else asked of it, is claimed for deletion: from then on, an answer asked for is refused, so a
   * reply is never both edited and deleted. The deletion waits for an acknowledgement still on its way, and deletes
   * nothing if that fails or Discord refused it as answered elsewhere. A component's deferred update shows nothing and
   * is left alone, as is anything a raw call or an answer asked for before made. A second call claims nothing more.
   *
   * @returns The claimed deletion, which never rejects, for the stop to wait on; `undefined` when nothing was claimed.
   */
  withdraw(): Promise<WithdrawnReply> | undefined {
    if (this.#withdrawn) return this.#withdrawal
    this.#withdrawn = true
    // Learns of a raw first answer, which is not this state's to delete
    this.sync()
    // Every call but an acknowledgement is asked for as an answer, so a command acknowledged and asked nothing else has
    // made, or is making, only its deferReply
    const ownAcknowledgement = answersWithOwnMessage(this.interaction) && (this.calls.length > 0 || this.#acknowledgementAsked)
    const claimed = ownAcknowledgement && !this.#answerAsked && !this.#answeredRaw
    this.cancelScheduled()
    if (!claimed) return undefined
    this.#withdrawal = this.queued(async () => {
      this.sync()
      // An acknowledgement that failed, or that Discord refused as answered elsewhere, left nothing of this state's
      if (this.phase !== 'deferred' || this.calls.length === 0) return { deleted: false }
      try {
        await this.call('deleteReply', undefined, () => this.interaction.deleteReply())
        return { deleted: true }
      } catch (error) {
        return { deleted: false, error }
      }
    }, 'withdrawal')
    return this.#withdrawal
  }

  /**
   * Puts a locked message back as it was, unless something else changed it since the lock. `@Defer`
   * calls it after the handler, for a handler that never answered. Never throws.
   */
  release(): Promise<void> {
    if (this.#withdrawal) return Promise.resolve()
    const waiting = this.timer !== undefined
    this.cancelScheduled()
    // A component's handler that returned before the 'auto' timer, unanswered, gets eager's invisible acknowledgement
    const acknowledging = waiting && !answersWithOwnMessage(this.interaction) ? this.acknowledgeUnanswered() : undefined
    return this.queued(async () => {
      await acknowledging
      // A raw answer the handler made with nothing since is learned of here
      this.sync()
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
    // Calls still holding the message when the edit's turn comes keep their controls disabled
    await this.editMessage(() => this.heldBody(entry, entry.original), { restoring: true })
  }

  /**
   * Ends a call a guard denied silently. A component still unanswered is acknowledged invisibly, with or without
   * `@Defer`, since Discord tells the user an unanswered call failed; so is a command `@Defer`'s 'auto' timer was
   * waiting on, whose deferred reply is then deleted, as `@Defer`'s is while nothing was sent into it. Never throws.
   */
  abandon(): Promise<void> {
    if (this.#withdrawal) return Promise.resolve()
    const waiting = this.timer !== undefined
    this.cancelScheduled()
    // A command's acknowledgement shows "thinking…", so one is made only for the timer that would have made it
    const acknowledging = waiting || !answersWithOwnMessage(this.interaction) ? this.acknowledgeUnanswered({ ephemeral: true }) : undefined
    return this.queued(async () => {
      await acknowledging
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
    return this.queued(async () => {
      this.sync()
      this.refuseAfterModal()
      const draw = this.withRestore(await this.themed(payload, options))
      if (this.phase !== 'unanswered') return this.editMessage(() => this.keptPrivate(draw()))
      return answersWithOwnMessage(this.interaction) ? this.reply(draw()) : this.update(draw())
    })
  }

  edit(payload: ResponseEditPayload, options?: ResponseSendOptions): Promise<Message | undefined> {
    return this.send(payload as ResponsePayload, options)
  }

  followUp(payload: ResponsePayload, options?: ResponseSendOptions): Promise<Message | undefined> {
    return this.queued(() => this.followUpNow(payload, options))
  }

  private async followUpNow(payload: ResponsePayload, options?: ResponseSendOptions): Promise<Message | undefined> {
    this.sync()
    const body = await this.themed(payload, options)
    if (this.phase === 'unanswered') return this.reply(body)
    // Once the answer is deleted, the next message sent is the answer
    if (this.answer.kind === 'deleted') return this.answerWith(body)
    if (this.phase === 'deferred' && answersWithOwnMessage(this.interaction) && this.answer.kind === 'original') {
      // Discord makes a follow-up to a deferred, unsent reply that reply, ignoring its flags: a private one
      // would be shown to everyone on a public deferral, so that deferral is deleted, and the follow-up is the answer.
      if (!hasEphemeral(Number(MessageFlagsBitField.resolve(body.flags ?? 0))) || this.interaction.ephemeral) return this.editMessage(this.keptPrivate(body))
      await this.call('deleteReply', undefined, () => this.interaction.deleteReply())
      this.phase = 'replied'
      return this.answerWith(body)
    }
    return (await this.sendFollowUp(body)).message
  }

  /** Sends a follow-up, with the flags it was sent with. */
  private async sendFollowUp(body: Body): Promise<{ message: Message; flags: number }> {
    const flags = this.withSuppression(this.flagsFor('followUp', body.flags, false))
    const sent = forMode(body, hasComponentsV2(flags))
    const message = await this.call('followUp', { ...sent, flags }, () =>
      this.interaction.followUp({ ...sent, flags } as InteractionReplyOptions),
    )
    return { message: message as Message, flags }
  }

  /** Sends a follow-up that becomes the answer, which later edits and `delete()` act on by its id. */
  private async answerWith(body: Body): Promise<Message> {
    const { message, flags } = await this.sendFollowUp(body)
    // Its privacy and format as sent, not as read back from the message
    this.answer = { kind: 'followUp', id: message.id, ephemeral: hasEphemeral(flags), v2: hasComponentsV2(flags) }
    this.lastMessage = message
    return message
  }

  delete(): Promise<void> {
    return this.queued(async () => {
      this.sync()
      if (this.phase === 'unanswered') throw new Error('There is no answer to delete: the interaction has not been answered.')
      this.refuseAfterModal()
      const { answer } = this
      if (answer.kind === 'deleted') throw new Error('There is no answer to delete: it was deleted.')
      // A follow-up is as private as it was sent, a command's own reply as the interaction's answer, a component's
      // message as its flags
      const shown = this.message?.flags?.has(MessageFlags.Ephemeral) ?? false
      const ephemeral =
        answer.kind === 'followUp'
          ? answer.ephemeral
          : answersWithOwnMessage(this.interaction)
            ? Boolean(this.interaction.ephemeral) || shown
            : shown
      if (answer.kind === 'followUp') await this.call('deleteReply', answer.id, () => this.interaction.deleteReply(answer.id))
      else await this.call('deleteReply', undefined, () => this.interaction.deleteReply())
      this.answer = { kind: 'deleted', ephemeral }
      this.lastMessage = undefined
      // The message is gone: nothing is left to put back as it was before a lock
      this.settled = true
      this.leave()
    })
  }

  /** A modal is the interaction's whole answer: what the user enters arrives as a submit interaction of its own. */
  private refuseAfterModal(): void {
    if (this.modalShown) {
      throw new Error("This interaction was answered with a modal, which has no message to edit or delete; answer the modal's submit instead.")
    }
  }

  async modal(modal: JSONEncodable<APIModalInteractionResponseCallbackData> | ModalComponentData): Promise<void> {
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
    // Only a modal that will be shown replaces the scheduled acknowledgement
    this.cancelScheduled()
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
    return options?.fill === false ? body : withThemeColours(body, await this.answerTheme(hasEphemeral(Number(MessageFlagsBitField.resolve(body.flags ?? 0)))))
  }

  /**
   * An answer asking to be private, as an edit of a private deferral, which already is what the flag asks for: the
   * flag an edit can't take left out rather than dropped with a warning, for a `send()` and a `followUp()` alike.
   */
  private keptPrivate(body: Body): Body {
    const requested = Number(MessageFlagsBitField.resolve(body.flags ?? 0))
    if (!hasEphemeral(requested) || this.phase !== 'deferred' || this.answer.kind !== 'original' || !this.interaction.ephemeral) return body
    return { ...body, flags: requested & ~MessageFlags.Ephemeral }
  }

  /**
   * The theme an answer is drawn in, which may wait for the call's server and user themes, or outside a call for the
   * theme resolver's hooks. While it waits, the step counts as preparing, so an acknowledgement asked for meanwhile or
   * behind it goes ahead of it, as private as `ephemeral` says the answer is; the step goes on once that settles, from
   * where it leaves the interaction.
   */
  private async answerTheme(ephemeral: boolean): Promise<ResolvedTheme> {
    const theme = themeForInteraction(this.interaction)
    // A theme found at once holds nothing back, so nothing goes ahead of the answer
    const waits = theme instanceof Promise
    const telling = this.telling()
    if (waits) {
      telling.preparing = { ephemeral }
      // An acknowledgement asked for behind this step goes first, rather than wait for the theme with it
      for (const asked of [...this.#askedAcknowledgements]) this.goAhead(asked, ephemeral)
    }
    try {
      return await theme
    } finally {
      if (waits) telling.preparing = undefined
      await this.acknowledging?.catch(() => undefined)
    }
  }

  /**
   * Leaves the lock with the message as `body` leaves it, and draws `body` with omitted components and embeds put back
   * as the message was before the lock, once the edit's turn comes.
   */
  private withRestore(body: Body): () => Body {
    if (!this.snapshot || this.settled) return () => body
    const entry = this.held?.entry
    const base = entry?.original ?? this.snapshot
    const left: Snapshot = {
      components: body.components === undefined ? base.components : body.components.map(toJson),
      embeds: body.embeds === undefined ? base.embeds : (body.embeds.map(toJson) as APIEmbed[]),
    }
    this.leave({ left })
    return () => {
      // Calls still holding the message when the edit's turn comes keep their controls disabled
      const components = entry && entry.holders.size > 0 ? this.heldBody(entry, left, { withView: false }).components : body.components
      return {
        ...body,
        components: components ?? base.components,
        ...(body.embeds === undefined && !this.v2 ? { embeds: base.embeds } : {}),
      }
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
    this.v2 = this.#followsV2 = hasComponentsV2(flags)
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
    this.#answeredOnMessage = true
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

  /**
   * Edits the answer with `body`, or what `body` draws. On a message this call locked, it is drawn and sent at its
   * turn there, so the edit that lands last shows the lock as it is then.
   */
  private editMessage(body: Body | (() => Body), options: { restoring?: boolean } = {}): Promise<Message | undefined> {
    const draw = typeof body === 'function' ? body : () => body
    return this.takeTurn(() => this.editMessageNow(draw(), options))
  }

  /**
   * Runs `step`, which edits the message this call locked, once every step asked for before it there has finished,
   * whichever call asked for it; on any other message at once. A step there that hangs holds the others' until
   * discord.js's REST timeout (15 s by default) rejects its edit.
   */
  private takeTurn<T>(step: () => Promise<T>): Promise<T> {
    const entry = this.lockEntry
    if (!entry) return step()
    const turn = entry.edits.then(step)
    entry.edits = turn.then(
      () => undefined,
      () => undefined,
    )
    return turn
  }

  /**
   * Edits the answer through the interaction, and through the channel only once its token has expired. Once the answer
   * is deleted, the edit is sent as a follow-up that becomes the answer, as private as the deleted one unless it sets
   * flags of its own.
   */
  private async editMessageNow(body: Body, { restoring = false } = {}): Promise<Message | undefined> {
    const { answer } = this
    if (answer.kind === 'deleted') {
      if (restoring) return undefined
      const { attachments: _attachments, ...rest } = body
      return this.answerWith({ ...rest, flags: body.flags ?? (answer.ephemeral ? MessageFlags.Ephemeral : 0) })
    }
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
    // A follow-up that is the answer has its own format; the interaction's reply has the one this state knows, or reads
    const v2 = answer.kind === 'followUp' ? answer.v2 : await this.originalV2()
    const flags = this.flagsFor('edit', body.flags, v2) | this.keptFlags(body)
    if (answer.kind === 'followUp') answer.v2 ||= hasComponentsV2(flags)
    else this.v2 ||= hasComponentsV2(flags)
    const sent = { ...this.withAttachments(forMode(body, hasComponentsV2(flags))), flags }
    // A follow-up that is the answer is edited by its id
    const edit = answer.kind === 'followUp' ? { ...sent, message: answer.id } : sent
    try {
      this.lastMessage = await this.call('editReply', edit, () => this.interaction.editReply(edit as InteractionEditReplyOptions))
    } catch (error) {
      const message = this.message
      const expired = Date.now() - this.interaction.createdTimestamp >= TOKEN_EXPIRED_AFTER_MS
      if (!TOKEN_EXPIRED.has(errorCode(error) as number) || !expired || !isBotInstalled(this.interaction) || !message) throw error
      this.lastMessage = await this.call('message.edit', sent, () => message.edit(sent as never))
    }
    this.phase = 'replied'
    // When MeoCord last edited the locked message, for a restore to tell whether something else edited it since
    if (this.lockEntry && !answersWithOwnMessage(this.interaction)) {
      this.lockEntry.editedAt = this.lastMessage?.editedTimestamp ?? undefined
    }
    return this.lastMessage
  }

  /**
   * Whether the interaction's own reply is Components V2, which its edit must know: Discord refuses content or embeds
   * on a V2 message. A reply a raw discord.js call sent, embed or V2, is read back once before MeoCord first edits it,
   * as discord.js keeps no flags of it; every other answer's format is known from the call that made it.
   */
  private async originalV2(): Promise<boolean> {
    if (!this.#replyFormatUnread) return this.v2
    this.#replyFormatUnread = false
    try {
      const reply = await this.interaction.fetchReply()
      this.v2 = Boolean(reply?.flags?.has(MessageFlags.IsComponentsV2))
    } catch {
      // Unread, it is edited as this state knows it
    }
    return this.v2
  }

  /** Whether a message MeoCord starts is Components V2: as the answer is, or as the component's message it follows. */
  private newMessageV2(): boolean {
    return this.v2 || this.#followsV2
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
    // Nothing is sent for a call a stop dropped and whose deferred reply it deletes
    if (this.#withdrawal) return
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
    const theme = await this.answerTheme(visibility === 'private')
    // Drawn before anything is sent; a presenter that fails is answered for with MeoCord's own view, then thrown to
    // the caller, which reports it as the call's fault rather than passing it for a refusal
    const { view, failure, gone, reset } = await this.drawnView(error, message, theme)
    // Its refusal already logged, an interaction Discord no longer knows is not answered again
    if (!gone) await this.deliverError(view, visibility, ifUnanswered, reset)
    if (failure !== undefined) throw failure
  }

  /**
   * Sends an error's view where the interaction stands; a delivery Discord refuses is logged, never thrown. A select-menu
   * pick nothing has answered is first answered with the update that puts its menu back, unless `reset` says that was
   * done already, and the view then follows up.
   */
  private async deliverError(view: ResponseView, visibility: 'reply' | 'private', ifUnanswered: boolean, reset = false): Promise<void> {
    try {
      this.sync()
      if (!reset && this.phase === 'unanswered' && this.interaction.isAnySelectMenu()) {
        await this.resetPick()
        reset = true
      }
      await this.withFilesFallback(view, shown => this.presentError(shown, visibility, { ifUnanswered, reset }))
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
   * acknowledged first, so the drawing never misses Discord's three seconds: privately, or a select-menu pick with the
   * update that puts its menu back, which `reset` reports; `gone` when Discord no longer knows the interaction. Should
   * the presenter fail, or draw a view MeoCord cannot render, MeoCord's own view takes its place, and the failure is
   * returned for the caller to report once the user is answered.
   */
  private async drawnView(
    error: unknown,
    message: string,
    theme: ResolvedTheme,
  ): Promise<{ view: ResponseView; failure?: unknown; gone?: boolean; reset?: boolean }> {
    const tone = isUserOutcome(error, this.interaction) ? 'warning' : 'danger'
    const context = this.presenterContext(this.newMessageV2(), theme)
    // Fitted to the mode's limit first, so a presenter that writes the message as its text, MeoCord's own included, renders
    const generic = () => textFor(this.interaction, { key: 'meocord.fallback.error' })
    const presented = { message: presentedMessage(message, TEXT_LIMITS[context.mode], generic), error, tone } as const
    const ready = (view: ResponseView) => {
      const sendable = this.sendable(themedView(view, theme), this.keptBeside())
      // Rendered once here, so a view MeoCord cannot render fails before anything is sent
      this.render(sendable, this.newMessageV2())
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
    // Set when a select-menu pick was answered with the update that puts its menu back
    let reset = false
    if (isDrawing(produced)) {
      // Settled into a value now, so a drawing that rejects while the acknowledgement is awaited is still handled
      const drawing = Promise.resolve(produced).then(
        view => ({ view }),
        (failure: unknown) => ({ failure }),
      )
      this.sync()
      // Discord's refusal is the acknowledgement's, never the presenter's, and is logged once
      if (this.phase === 'unanswered') {
        // A pick is acknowledged with the update that puts its menu back, which the view then follows up
        const pick = this.interaction.isAnySelectMenu()
        const acknowledging = pick ? this.resetPick().then(() => true) : this.acknowledgePrivately().then(() => false)
        reset = await acknowledging.catch((refusal: unknown) => {
          gone = errorCode(refusal) === UNKNOWN_INTERACTION
          // A pick answered elsewhere is recorded as answered, as a private acknowledgement records it
          if (errorCode(refusal) !== ALREADY_ACKNOWLEDGED) {
            logFailedSend(logger, pick ? 'put the menu back' : 'acknowledge the interaction privately', refusal)
          }
          return false
        })
      }
      const drawn = await drawing
      if ('failure' in drawn) return { ...fallback(drawn.failure), gone, reset }
      produced = drawn.view
    }
    try {
      return { view: ready(produced), gone, reset }
    } catch (failure) {
      return { ...fallback(failure), gone, reset }
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
    const body = this.render(view, this.newMessageV2())
    return { ...body, flags: Number(body.flags ?? 0) | MessageFlags.Ephemeral } as ResponsePayload
  }

  private async presentError(
    view: ResponseView,
    visibility: 'reply' | 'private',
    { ifUnanswered = false, reset = false }: { ifUnanswered?: boolean; reset?: boolean } = {},
  ): Promise<void> {
    this.sync()
    // The private deferral made for a drawn view is that view's reply
    if (this.privateDeferral && this.phase === 'deferred') {
      await this.editMessage(this.render(view, this.newMessageV2()))
      this.privateDeferral = false
      return
    }
    // A pick answered with the update that put its menu back is told privately
    if (reset) {
      await this.followUpNow(this.privateError(view))
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
        await this.editMessage(this.render(view, this.newMessageV2()))
        return
      }
      // A private follow-up edits a private deferral into it, and replaces a public one
      await this.followUpNow(this.privateError(view))
      return
    }

    // A deleted message has nothing to add the error to or put back: the error follows up, and is the answer
    if (this.answer.kind === 'deleted') {
      await this.followUpNow(this.privateError(view))
      return
    }
    // The message the component is on: whether it is private does not change with edits.
    const current = 'message' in this.interaction ? (this.interaction.message ?? undefined) : this.message
    // Added to only while that message is the answer: any other answer, made elsewhere or by the app, may be a reply,
    // which an edit would replace
    if (this.answerIsMessage() && current?.flags?.has(MessageFlags.Ephemeral)) {
      const appended = this.appendError(current, view)
      if (this.fits(appended)) {
        await this.editMessage(appended)
        return
      }
    }
    await this.restore()
    // A pick this state deferred, and since edited by nothing, not even a restore, still shows in its menu
    if (this.phase === 'deferred' && this.answerIsMessage() && this.interaction.isAnySelectMenu()) await this.resetDeferredPick()
    await this.followUpNow(this.privateError(view))
  }

  /**
   * Whether the answer is the message the component is on: this state answered with `update` or `deferUpdate`, and no
   * follow-up has taken the answer's place since. An answer made elsewhere or by the app may be a reply instead.
   */
  private answerIsMessage(): boolean {
    return this.#answeredOnMessage && this.answer.kind === 'original'
  }

  /**
   * Answers a select-menu pick nothing has answered with an update that sets no field. Discord then draws the menu
   * again in the picker's client, as it was before the pick, and changes nothing else: the message keeps every edit and
   * shows no "(edited)". Discord's refusal is thrown; one saying something else answered the pick first is recorded
   * as that answer before it is thrown.
   */
  private async resetPick(): Promise<void> {
    this.cancelScheduled()
    const target = this.interaction as AnySelectMenuInteraction
    await this.firstAnswer(() => this.call('update', {}, () => target.update({})))
    this.phase = 'replied'
    this.#answeredOnMessage = true
  }

  /**
   * Puts a deferred pick's menu back with an edit that sets no field, as {@link resetPick} does for one nothing has
   * answered. A failure is logged, and the error still follows up.
   */
  private async resetDeferredPick(): Promise<void> {
    try {
      await this.takeTurn(() => this.call('editReply', {}, () => this.interaction.editReply({})))
      this.phase = 'replied'
    } catch (error) {
      logFailedSend(logger, 'put the menu back', error)
    }
  }

  /**
   * Whether a message stays within Discord's limits for its form: of Components V2 components and the 4000 characters
   * their Text Displays total, or of 10 embeds and the 6000 characters across them.
   */
  private fits(body: Body): boolean {
    if (this.v2) {
      const components = (body.components ?? []) as Record<string, unknown>[]
      return countComponents(components) <= V2_COMPONENT_LIMIT && countText(components) <= TEXT_LIMITS.v2
    }
    const embeds = (body.embeds ?? []).map(embed => toJson(embed) as APIEmbed)
    return embeds.length <= EMBED_LIMIT && embeds.reduce((total, embed) => total + embedLength(embed), 0) <= EMBED_TEXT_LIMIT
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

// One state per interaction for both builds of this version, so either sees where the other left its answer
const states = shared('responseStates', () => new WeakMap<object, InteractionResponse>())

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

