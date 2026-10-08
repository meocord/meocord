import 'reflect-metadata'
import {
  type MessageCommandOptions,
} from '@src/interface/index.js'
import { makeInjectable } from '@src/util/injectable.util.js'
import { assertStageEntries } from '@src/core/stage-scope.js'
import { type CatalogShape, CATALOGS, lookup, type Translator } from '@src/common/translator.js'
import { type MeoCordOptions } from '@src/decorator/app-options.js'
import { providerMap } from '@src/core/providers.js'
import { BUILT_IN_TYPES } from '@src/core/message-params.js'
import { assertObservers } from '@src/core/observer-runner.js'
import { assertValidTheme, themeForProblem } from '@src/core/theme-validation.js'
import { copyLayer } from '@src/core/theme-scope.js'
import { deprecatedOnMethod, refuse, declaring } from '@src/util/refusal.util.js'
import { timeoutProblem } from '@src/util/timer-limit.util.js'
import { META } from '@src/util/metadata-keys.js'

/** Refuses a `messages` option of the wrong type where the app is declared, rather than at the first message. */
function assertMessageOptions(appName: string, messages: MessageCommandOptions | undefined, i18n: Translator<any> | undefined): void {
  if (!messages) return
  const { prefix, mention, caseSensitive } = messages
  const isText = (value: unknown) => typeof value === 'string'
  if (prefix !== undefined && !isText(prefix) && typeof prefix !== 'function' && !(Array.isArray(prefix) && prefix.every(isText))) {
    throw refuse(new TypeError(`${appName}: @MeoCord({ messages: { prefix } }) takes a string, a list of strings, or a function of the message returning them.`))
  }
  const flags = { caseSensitive, replyEmoji: messages.replyEmoji, dmOnError: messages.dmOnError, dmOnCooldown: messages.dmOnCooldown, slowHandlerWarning: messages.slowHandlerWarning }
  for (const [name, value] of Object.entries(flags)) {
    if (value !== undefined && typeof value !== 'boolean') throw refuse(new TypeError(`${appName}: @MeoCord({ messages: { ${name} } }) takes true or false.`))
  }
  if (messages.handlers !== undefined && messages.handlers !== 'sequential' && messages.handlers !== 'concurrent') {
    throw refuse(new TypeError(`${appName}: @MeoCord({ messages: { handlers } }) takes 'sequential' or 'concurrent'.`))
  }
  if (mention !== undefined && typeof mention !== 'boolean' && mention !== 'only') {
    throw refuse(new TypeError(`${appName}: @MeoCord({ messages: { mention } }) takes true, false or 'only'.`))
  }
  const { types, deleteUsageRepliesAfter } = messages
  if (deleteUsageRepliesAfter !== undefined && !(typeof deleteUsageRepliesAfter === 'number' && deleteUsageRepliesAfter >= 0 && Number.isFinite(deleteUsageRepliesAfter))) {
    throw refuse(new TypeError(`${appName}: @MeoCord({ messages: { deleteUsageRepliesAfter } }) takes a number of seconds, or 0 to keep usage replies.`))
  }
  const { help } = messages
  // One word each, since help is asked for by its first word
  const isWord = (value: unknown) => typeof value === 'string' && /^\S+$/.test(value)
  if (
    help !== undefined &&
    typeof help !== 'boolean' &&
    !(
      typeof help === 'object' &&
      help !== null &&
      (help.command === undefined || isWord(help.command)) &&
      (help.aliases === undefined || (Array.isArray(help.aliases) && help.aliases.every(isWord)))
    )
  ) {
    throw refuse(new TypeError(`${appName}: @MeoCord({ messages: { help } }) takes true, false, or { command, aliases } of single words.`))
  }
  for (const [name, type] of Object.entries(types ?? {})) {
    if (name in BUILT_IN_TYPES) throw refuse(new TypeError(`${appName}: @MeoCord({ messages: { types } }): "${name}" is a built-in type; give yours another name.`))
    if (typeof type?.parse !== 'function') {
      throw refuse(new TypeError(`${appName}: @MeoCord({ messages: { types } }): "${name}" needs a parse(word, message) function.`))
    }
    if (type.labelKey !== undefined) assertLabelKey(appName, name, type.labelKey, i18n)
  }
}

/** Refuses a type's `labelKey` that no message of the app's default catalog has, as it would be shown as the key. */
function assertLabelKey(appName: string, name: string, labelKey: unknown, i18n: Translator<any> | undefined): void {
  const where = `${appName}: @MeoCord({ messages: { types } }): "${name}" has labelKey`
  if (typeof labelKey !== 'string') throw refuse(new TypeError(`${where} ${String(labelKey)}; it takes a message key, such as 'types.${name}'.`))
  if (!i18n) throw refuse(new TypeError(`${where} '${labelKey}', which needs @MeoCord({ i18n }).`))
  const catalogs = (i18n as unknown as { [CATALOGS]?: Partial<Record<string, CatalogShape>> })[CATALOGS]
  if (catalogs && typeof lookup(catalogs[i18n.defaultLocale], labelKey) !== 'string') {
    throw refuse(new TypeError(`${where} '${labelKey}', which the default catalog has no message for.`))
  }
}

/**
 * Declares the application class: its controllers, services, client options and what applies to every handler.
 *
 * Put it on one class, the one `main.ts` passes to `MeoCordFactory.create()`. What the process needs before this
 * class is read, the token, build and sharding, belongs in `meocord.config.ts` instead.
 *
 * @remarks
 * The options are stored as metadata and read when the application is created. Stages listed here, guards,
 * interceptors and filters, apply to every dispatched handler, outside the controller's and the method's own.
 *
 * @param options - The app's controllers, client options and the rest; see {@link MeoCordOptions}.
 *
 * @example
 * ```ts
 * @Controller()
 * class PingController {
 *   @Command('ping', CommandType.SLASH)
 *   async ping(interaction: ChatInputCommandInteraction) {
 *     await respond(interaction).send('Pong!')
 *   }
 * }
 *
 * @MeoCord({ controllers: [PingController], clientOptions: { intents: [GatewayIntentBits.Guilds] } })
 * class App {}
 * ```
 *
 * @group Decorators
 * @category App
 * @see {@link MeoCordOptions}
 * @see {@link MeoCordFactory}
 * @see {@link MeoCordConfig}
 * @see {@link https://meocord.dev/docs/4.1/configuration | Configuration}
 */
export function MeoCord<const G extends readonly unknown[] = [], const I extends readonly unknown[] = [], const F extends readonly unknown[] = []>(
  options: MeoCordOptions<G, I, F>,
): (target: any, propertyKey?: string | symbol) => void {
  return declaring((target: any, propertyKey?: string | symbol): void => {
    if (deprecatedOnMethod('@MeoCord', target, propertyKey)) return
    assertStageEntries('@MeoCord({ guards })', 'guard', target.name, options.guards ?? [])
    assertStageEntries('@MeoCord({ interceptors })', 'interceptor', target.name, options.interceptors ?? [])
    assertStageEntries('@MeoCord({ filters })', 'filter', target.name, options.filters ?? [])
    assertObservers(`${target.name}: @MeoCord({ observers })`, options.observers ?? [])
    // Checked where the app is declared, so a malformed provider fails at import rather than at start
    providerMap(options.providers ?? [], `${target.name}: @MeoCord({ providers })`)
    assertMessageOptions(target.name, options.messages, options.i18n)
    assertCooldownPolicy(target.name, options)
    if (options.warnUnanswered !== undefined && typeof options.warnUnanswered !== 'boolean') {
      throw refuse(new TypeError(`${target.name}: @MeoCord({ warnUnanswered }) takes true or false.`))
    }
    assertThemeFor(target.name, options)
    // Copied first, so what is checked is what the app runs with, whatever happens to the object afterwards
    const theme = options.theme === undefined ? undefined : copyLayer(options.theme)
    if (theme !== undefined) assertValidTheme(theme, `${target.name}: @MeoCord({ theme })`)
    makeInjectable(target)

    Reflect.defineMetadata(META.appOptions, theme === undefined ? options : { ...options, theme }, target)
  })
}

/** Refuses theme resolvers and cache options the runtime cannot follow, where the app is declared. */
function assertThemeFor(
  appName: string,
  { themeFor, themeCache, themeForTimeoutMs }: { themeFor?: unknown; themeCache?: unknown; themeForTimeoutMs?: unknown },
): void {
  const problem = themeFor === undefined ? undefined : themeForProblem(themeFor, `${appName}: @MeoCord({ themeFor })`, 'or a class implementing ThemeResolver.')
  if (problem) throw refuse(new TypeError(problem))
  const whole = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value > 0
  if (themeCache !== undefined) {
    if (themeCache === null || typeof themeCache !== 'object') {
      throw refuse(new TypeError(`${appName}: @MeoCord({ themeCache }) takes { ttlSeconds?, maxGuilds?, maxUsers? }.`))
    }
    for (const [key, value] of Object.entries(themeCache)) {
      if (!['ttlSeconds', 'maxGuilds', 'maxUsers'].includes(key)) {
        throw refuse(new TypeError(`${appName}: @MeoCord({ themeCache }) has no option '${key}': give ttlSeconds, maxGuilds or maxUsers.`))
      }
      if (value !== undefined && !(key === 'ttlSeconds' ? typeof value === 'number' && value > 0 && Number.isFinite(value) : whole(value))) {
        throw refuse(new TypeError(`${appName}: @MeoCord({ themeCache }): ${key} must be ${key === 'ttlSeconds' ? 'a number of seconds above 0' : 'a whole number above 0'} (got ${JSON.stringify(value)}).`))
      }
    }
  }
  // Above a timer's limit, Node waits 1 ms instead, so every lookup would time out at once
  const timeout = themeForTimeoutMs === undefined ? undefined : timeoutProblem(themeForTimeoutMs)
  if (timeout) throw refuse(new TypeError(`${appName}: @MeoCord({ themeForTimeoutMs }) ${timeout}.`))
}

/** Refuses a cooldown policy the runner cannot follow, where the app is declared. */
function assertCooldownPolicy(
  appName: string,
  { cooldownStoreFailure, cooldownStoreTimeoutMs }: { cooldownStoreFailure?: unknown; cooldownStoreTimeoutMs?: unknown },
): void {
  if (cooldownStoreFailure !== undefined && cooldownStoreFailure !== 'deny' && cooldownStoreFailure !== 'allow') {
    throw refuse(new TypeError(`${appName}: @MeoCord({ cooldownStoreFailure }) must be 'deny' or 'allow' (got ${JSON.stringify(cooldownStoreFailure)}).`))
  }
  const timeout = cooldownStoreTimeoutMs === undefined ? undefined : timeoutProblem(cooldownStoreTimeoutMs)
  if (timeout) throw refuse(new TypeError(`${appName}: @MeoCord({ cooldownStoreTimeoutMs }) ${timeout}.`))
}
