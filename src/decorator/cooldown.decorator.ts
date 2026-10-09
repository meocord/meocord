import 'reflect-metadata'
import { type CooldownOptions, type StoredCooldown } from '@src/core/cooldown-runner.js'
import { type Handler, type NoInput, type ParamsOf } from '@src/decorator/validation.decorator.js'
import { decoratedName, refuse, declaring } from '@src/util/refusal.util.js'
import { META } from '@src/util/metadata-keys.js'

/**
 * Allows the descriptor when the handler's params give `by` what it reads. Params `by` leaves
 * undeclared are unknown values of any handler, so they are not checked.
 */
type AcceptsBy<Params, P> = [Params] extends [NoInput]
  ? unknown
  : Record<string, unknown> extends P
  ? unknown
  : [Params] extends [P]
  ? unknown
  : { 'The handler params do not give by what it reads': P }

/** `@Cooldown` with a `by`: on a controller, or on a handler whose params fit what `by` reads. */
export interface CooldownByDecorator<P> {
  (target: abstract new (...args: any[]) => unknown): void
  <M extends Handler>(
    target: object,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<M> & AcceptsBy<ParamsOf<M>, P>,
  ): void
}

/**
 * Limits how often a handler runs, counted per user, server, channel or for everyone.
 *
 * Use it to rate-limit a command, a component or a message command: an interaction over the limit is answered only
 * to its caller, with how long to wait, and a message command's is ignored, or told in a direct message with
 * `@MeoCord({ messages: { dmOnCooldown: true } })`. For a check that is not about how often, use a {@link Guard}.
 *
 * @remarks
 * The window slides, so each use comes back `seconds` after it was spent. Stacked cooldowns are checked
 * together and counted only if all allow the call. A call is counted after its guards, validation and
 * pipes, so a denied call or bad input spends nothing; on a controller, each handler is counted apart.
 * Calls are kept in a `CooldownStore`, in memory unless `@MeoCord({ cooldownStore })` names another.
 *
 * @param options - The limit, whose calls count together, and how to exempt or tell calls apart.
 * @throws Error when `seconds` is not from `0.001` to `4320000000000`, `uses` is not a whole number of at least 1,
 * `per` is not a scope or `by` is not a function, as the decorator applies; `CooldownError` to a call over the limit.
 *
 * @example
 * ```ts
 * @Command('daily', CommandType.SLASH)
 * @Cooldown({ seconds: 3 })
 * @Cooldown({ uses: 5, seconds: 60 })
 * async daily(interaction: ChatInputCommandInteraction) {
 *   await respond(interaction).send('Here are your coins.')
 * }
 *
 * @Command('check-in/{uid}', CommandType.BUTTON)
 * @Cooldown({ seconds: 3600, by: (_context, { uid }: { uid: string }) => uid })
 * async checkIn(interaction: ButtonInteraction, { uid }: { uid: string }) {
 *   await respond(interaction).send(`Checked in ${uid}.`)
 * }
 * ```
 *
 * @pipeline cooldown-check for a cooldown without `by`, before a message's params are fetched
 * @pipeline cooldowns after validation and pipes
 * @group Decorators
 * @category Pipeline stages
 * @see {@link CooldownOptions}
 * @see {@link CooldownError}
 * @see {@link CooldownStore}
 * @see {@link https://meocord.dev/docs/4.2/cooldowns | Cooldowns}
 */
export function Cooldown(options: CooldownOptions & { by?: undefined }): ClassDecorator & MethodDecorator
/**
 * Limits how often a handler runs, counting calls apart by a value `by` reads from each call, such as the account a
 * button acts on.
 *
 * @param options - The limit, whose calls count together, and `by`; the handler's params are checked against what
 *   `by` reads.
 */
export function Cooldown<P extends object = Record<string, unknown>>(
  options: CooldownOptions<P> & { by: NonNullable<CooldownOptions<P>['by']> },
): CooldownByDecorator<P>
export function Cooldown(options: CooldownOptions<any>): ClassDecorator & MethodDecorator {
  const { seconds, uses = 1, per = 'user', by } = options
  const cooldown: StoredCooldown = { ...options, uses, per, windowMs: Math.round(seconds * 1000) }

  return declaring(function (target: object, propertyKey?: string | symbol) {
    // Checked where it applies, so the refusal names the handler or controller
    const problem = cooldownProblem(seconds, uses, per, by)
    if (problem) throw refuse(new Error(`${decoratedName(target, propertyKey)}: ${problem}`))
    // Decorators apply bottom-up; prepending keeps them in the order they read.
    if (propertyKey === undefined) {
      const existing = (Reflect.getOwnMetadata(META.classCooldowns, target) as StoredCooldown[]) ?? []
      Reflect.defineMetadata(META.classCooldowns, [cooldown, ...existing], target)
    } else {
      const existing = (Reflect.getOwnMetadata(META.methodCooldowns, target, propertyKey) as StoredCooldown[]) ?? []
      Reflect.defineMetadata(META.methodCooldowns, [cooldown, ...existing], target, propertyKey)
    }
  }) as ClassDecorator & MethodDecorator
}

/**
 * The longest window, in seconds: half the furthest time a `Date` holds, 8.64e15 ms, so the moment a wait ends, now
 * plus the window, is a real date for a refusal's `retryAt` and the time it shows.
 */
const MAX_SECONDS = 4_320_000_000_000

/** Why a cooldown's options cannot be counted, or undefined when they can. */
function cooldownProblem(seconds: number, uses: number, per: string, by: unknown): string | undefined {
  if (!(seconds >= 0.001 && seconds <= MAX_SECONDS)) return `@Cooldown needs a number of seconds from 0.001 to ${MAX_SECONDS}, not ${seconds}.`
  if (!Number.isInteger(uses) || uses < 1) return `@Cooldown needs a whole number of uses of at least 1, not ${uses}.`
  if (!['user', 'guild', 'channel', 'global'].includes(per)) {
    return `@Cooldown counts per 'user', 'guild', 'channel' or 'global', not '${per}'.`
  }
  if (by !== undefined && typeof by !== 'function') {
    return '@Cooldown takes by as a function of the call, returning the value to count by.'
  }
  return undefined
}
