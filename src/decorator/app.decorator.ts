import 'reflect-metadata'
import { type ServiceIdentifier } from 'inversify'
import { type ActivityOptions, type ClientOptions } from 'discord.js'
import { MetadataKey } from '@src/enum/index.js'
import {
  type DispatchObserver,
  type ExceptionFilter,
  type GuardInterface,
  type MessageCommandOptions,
  type InterceptorInterface,
  type ResponsePresenter,
} from '@src/interface/index.js'
import { makeInjectable } from '@src/util/injectable.util.js'
import { assertStageEntries } from '@src/core/stage-scope.js'
import { type CatalogShape, CATALOGS, lookup, type Translator } from '@src/common/translator.js'
import { type CooldownStore } from '@src/common/cooldown-store.js'
import { type Provider } from '@src/interface/provider.interface.js'
import { providerMap } from '@src/core/providers.js'
import { BUILT_IN_TYPES } from '@src/core/message-params.js'
import { assertObservers } from '@src/core/observer-runner.js'
import { type CooldownStoreFailure } from '@src/core/cooldown-runner.js'
import { type CheckedEntry } from '@src/decorator/stage-entry.js'
import { type RootTheme, type ThemeResolvers } from '@src/interface/theme.interface.js'
import { assertValidTheme } from '@src/core/theme-validation.js'
import { copyLayer } from '@src/core/theme-scope.js'
import { refuse } from '@src/util/refusal.util.js'

/** Refuses a `messages` option of the wrong type where the app is declared, rather than at the first message. */
function assertMessageOptions(messages: MessageCommandOptions | undefined, i18n: Translator<any> | undefined): void {
  if (!messages) return
  const { prefix, mention, caseSensitive } = messages
  const isText = (value: unknown) => typeof value === 'string'
  if (prefix !== undefined && !isText(prefix) && typeof prefix !== 'function' && !(Array.isArray(prefix) && prefix.every(isText))) {
    throw refuse(new TypeError('@MeoCord({ messages: { prefix } }) takes a string, a list of strings, or a function of the message returning them.'))
  }
  for (const [name, value] of Object.entries({ caseSensitive, replyEmoji: messages.replyEmoji })) {
    if (value !== undefined && typeof value !== 'boolean') throw refuse(new TypeError(`@MeoCord({ messages: { ${name} } }) takes true or false.`))
  }
  if (mention !== undefined && typeof mention !== 'boolean' && mention !== 'only') {
    throw refuse(new TypeError("@MeoCord({ messages: { mention } }) takes true, false or 'only'."))
  }
  const { types, deleteUsageRepliesAfter } = messages
  if (deleteUsageRepliesAfter !== undefined && !(typeof deleteUsageRepliesAfter === 'number' && deleteUsageRepliesAfter >= 0 && Number.isFinite(deleteUsageRepliesAfter))) {
    throw refuse(new TypeError('@MeoCord({ messages: { deleteUsageRepliesAfter } }) takes a number of seconds, or 0 to keep usage replies.'))
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
    throw refuse(new TypeError('@MeoCord({ messages: { help } }) takes true, false, or { command, aliases } of single words.'))
  }
  for (const [name, type] of Object.entries(types ?? {})) {
    if (name in BUILT_IN_TYPES) throw refuse(new TypeError(`@MeoCord({ messages: { types } }): "${name}" is a built-in type; give yours another name.`))
    if (typeof type?.parse !== 'function') {
      throw refuse(new TypeError(`@MeoCord({ messages: { types } }): "${name}" needs a parse(word, message) function.`))
    }
    if (type.labelKey !== undefined) assertLabelKey(name, type.labelKey, i18n)
  }
}

/** Refuses a type's `labelKey` that no message of the app's default catalog has, as it would be shown as the key. */
function assertLabelKey(name: string, labelKey: unknown, i18n: Translator<any> | undefined): void {
  const where = `@MeoCord({ messages: { types } }): "${name}" has labelKey`
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
 * @param options.controllers - Controllers to register.
 * @param options.clientOptions - Options for the discord.js `Client`.
 * @param options.activities - Activities the bot rotates through, if any.
 * @param options.services - Services to register that no controller depends on.
 * @param options.providers - Values classes inject by token with `@Inject`: `{ provide, useValue }`,
 *   `{ provide, useClass }`, or `{ provide, useFactory, inject? }`, whose factory may return a promise,
 *   awaited before login. A token is a class, a string, a symbol or a `createToken` token. Provided
 *   values run their `onReady` and `onShutdown` hooks, in dependency order with the services.
 * @param options.guards - Guards run before every dispatched handler, ahead of the controller's and
 *   the method's own guards: guard classes, or `{ provide, params? }`. A controller method called
 *   directly runs only its own guards.
 * @param options.interceptors - Interceptors run around every dispatched handler except autocomplete,
 *   outside the controller's and the method's own. A controller method called directly runs none.
 * @param options.filters - Exception filters tried after the method's and the controller's, and for
 *   errors outside any handler, such as `CommandNotFoundError`.
 * @param options.cooldownStore - Where `@Cooldown` counts calls, in place of this process's memory: a
 *   class extending `CooldownStore`, resolved like a service so it can inject its client.
 * @param options.cooldownStoreFailure - What a call with a cooldown gets when the store throws, rejects or
 *   does not answer in time: `'deny'`, the default, refuses it with `CooldownStoreError`, which the fallback
 *   answers privately; `'allow'` runs it uncounted. Either way the failure is logged once per outage.
 * @param options.cooldownStoreTimeoutMs - How long a call waits for the cooldown store before it counts as
 *   a failure. Defaults to `1000`.
 * @param options.i18n - The translator `createTranslator` made, injected as `Translator` wherever a class
 *   asks for one.
 * @param options.presenter - The `ResponsePresenter` that styles loading and error views, resolved once
 *   from the container. Without one, MeoCord's own styling is used.
 * @param options.messages - How message commands start and match across the app: the `prefix`, a mention of the
 *   bot, `mention: 'only'`, the app's own param `types`, how usage replies look, and the built-in `help`; see {@link MessageCommandOptions}.
 * @param options.observers - `@Observer` classes told about every dispatched call once it has settled,
 *   with its outcome and duration, in the order listed. The call never waits for them.
 * @param options.warnUnanswered - Warns, once per handler, when a handler finishes without answering
 *   its interaction, or defers it and never follows up, which leaves the user waiting. On in
 *   development (`NODE_ENV` is `development`, as under `meocord start --dev`) and off otherwise.
 * @param options.theme - The app's theme: the roles it changes from MeoCord's defaults, and every role the app
 *   adds. It applies to every handler, beneath each `@UseTheme`; code reads it with `useTheme()`. Each token is
 *   checked here, so a bad one stops the bot before it logs in.
 * @param options.themeFor - Themes by where a call comes from: `guild` for a server's, over the handler's, and
 *   `user` for a user's, over the server's, in a server or a DM. Each returns part of a theme or `undefined`, at once
 *   or as a promise, and is looked up while `@Defer` acknowledges, before the guards. A result that is not a valid
 *   theme is left out, with a warning once per server or user; a resolver that fails or passes its timeout leaves
 *   its theme out of the call, logged once until it answers again.
 * @param options.themeCache - How long `themeFor`'s results are kept (`ttlSeconds`, 300 unless set) and how many
 *   (`maxGuilds`, 10,000, and `maxUsers`, 50,000), the oldest dropped first. Inject `ThemeCache` to clear one sooner.
 * @param options.themeForTimeoutMs - How long a call waits for a resolver, in milliseconds; 1,000 unless set.
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
 * @see {@link MeoCordFactory}
 * @see {@link MeoCordConfig}
 * @see {@link https://meocord.dev/docs/4.1/configuration | Configuration}
 */
export function MeoCord<const G extends readonly unknown[] = [], const I extends readonly unknown[] = [], const F extends readonly unknown[] = []>(options: {
  controllers: ServiceIdentifier[]
  clientOptions: ClientOptions
  activities?: ActivityOptions[]
  services?: ServiceIdentifier[]
  providers?: Provider[]
  guards?: { [K in keyof G]: CheckedEntry<G[K], new (...args: any[]) => GuardInterface> }
  interceptors?: { [K in keyof I]: CheckedEntry<I[K], new (...args: any[]) => InterceptorInterface> }
  filters?: { [K in keyof F]: CheckedEntry<F[K], new (...args: any[]) => ExceptionFilter<any>> }
  i18n?: Translator<any>
  cooldownStore?: new (...args: any[]) => CooldownStore
  cooldownStoreFailure?: CooldownStoreFailure
  cooldownStoreTimeoutMs?: number
  presenter?: new (...args: any[]) => ResponsePresenter
  messages?: MessageCommandOptions
  observers?: (new (...args: any[]) => DispatchObserver)[]
  warnUnanswered?: boolean
  theme?: RootTheme
  themeFor?: ThemeResolvers
  themeCache?: { ttlSeconds?: number; maxGuilds?: number; maxUsers?: number }
  themeForTimeoutMs?: number
}): (target: any) => void {
  return (target: any): void => {
    assertStageEntries('@MeoCord({ guards })', 'guard', target.name, options.guards ?? [])
    assertStageEntries('@MeoCord({ interceptors })', 'interceptor', target.name, options.interceptors ?? [])
    assertStageEntries('@MeoCord({ filters })', 'filter', target.name, options.filters ?? [])
    assertObservers(`@MeoCord({ observers }) on ${target.name}`, options.observers ?? [])
    // Checked where the app is declared, so a malformed provider fails at import rather than at start
    providerMap(options.providers ?? [], '@MeoCord({ providers })')
    assertMessageOptions(options.messages, options.i18n)
    assertCooldownPolicy(target.name, options)
    if (options.warnUnanswered !== undefined && typeof options.warnUnanswered !== 'boolean') {
      throw refuse(new TypeError(`@MeoCord({ warnUnanswered }) on ${target.name} takes true or false.`))
    }
    // Copied first, so what is checked is what the app runs with, whatever happens to the object afterwards
    assertThemeFor(target.name, options)
    const theme = options.theme === undefined ? undefined : copyLayer(options.theme)
    if (theme !== undefined) assertValidTheme(theme, `@MeoCord({ theme }) on ${target.name}`)
    makeInjectable(target)

    Reflect.defineMetadata(MetadataKey.AppOptions, theme === undefined ? options : { ...options, theme }, target)
  }
}

/** The longest delay setTimeout takes: 2^31 - 1 ms, about 24.8 days. */
const MAX_TIMEOUT_MS = 2_147_483_647

/** Refuses theme resolvers and cache options the runtime cannot follow, where the app is declared. */
function assertThemeFor(
  appName: string,
  { themeFor, themeCache, themeForTimeoutMs }: { themeFor?: unknown; themeCache?: unknown; themeForTimeoutMs?: unknown },
): void {
  if (themeFor !== undefined) {
    if (themeFor === null || typeof themeFor !== 'object') {
      throw refuse(new TypeError(`@MeoCord({ themeFor }) on ${appName} takes { guild?, user? }, each a function returning part of a theme.`))
    }
    for (const [key, resolver] of Object.entries(themeFor)) {
      if (key !== 'guild' && key !== 'user') throw refuse(new TypeError(`@MeoCord({ themeFor }) on ${appName} has no resolver '${key}': give guild or user.`))
      if (resolver !== undefined && typeof resolver !== 'function') {
        throw refuse(new TypeError(`@MeoCord({ themeFor }) on ${appName}: ${key} must be a function returning part of a theme.`))
      }
    }
  }
  const whole = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value > 0
  if (themeCache !== undefined) {
    if (themeCache === null || typeof themeCache !== 'object') {
      throw refuse(new TypeError(`@MeoCord({ themeCache }) on ${appName} takes { ttlSeconds?, maxGuilds?, maxUsers? }.`))
    }
    for (const [key, value] of Object.entries(themeCache)) {
      if (!['ttlSeconds', 'maxGuilds', 'maxUsers'].includes(key)) {
        throw refuse(new TypeError(`@MeoCord({ themeCache }) on ${appName} has no option '${key}': give ttlSeconds, maxGuilds or maxUsers.`))
      }
      if (value !== undefined && !(key === 'ttlSeconds' ? typeof value === 'number' && value > 0 && Number.isFinite(value) : whole(value))) {
        throw refuse(new TypeError(`@MeoCord({ themeCache }) on ${appName}: ${key} must be ${key === 'ttlSeconds' ? 'a number of seconds above 0' : 'a whole number above 0'} (got ${JSON.stringify(value)}).`))
      }
    }
  }
  // Above setTimeout's limit, Node waits 1 ms instead, so every lookup would time out at once
  if (
    themeForTimeoutMs !== undefined &&
    !(typeof themeForTimeoutMs === 'number' && Number.isFinite(themeForTimeoutMs) && themeForTimeoutMs > 0 && themeForTimeoutMs <= MAX_TIMEOUT_MS)
  ) {
    throw refuse(new TypeError(
      `@MeoCord({ themeForTimeoutMs }) on ${appName} must be a number of milliseconds above 0 and at most ${MAX_TIMEOUT_MS} (got ${JSON.stringify(themeForTimeoutMs)}).`,
    ))
  }
}

/** Refuses a cooldown policy the runner cannot follow, where the app is declared. */
function assertCooldownPolicy(
  appName: string,
  { cooldownStoreFailure, cooldownStoreTimeoutMs }: { cooldownStoreFailure?: unknown; cooldownStoreTimeoutMs?: unknown },
): void {
  if (cooldownStoreFailure !== undefined && cooldownStoreFailure !== 'deny' && cooldownStoreFailure !== 'allow') {
    throw refuse(new TypeError(`@MeoCord({ cooldownStoreFailure }) on ${appName} must be 'deny' or 'allow' (got ${JSON.stringify(cooldownStoreFailure)}).`))
  }
  if (
    cooldownStoreTimeoutMs !== undefined &&
    !(typeof cooldownStoreTimeoutMs === 'number' && Number.isFinite(cooldownStoreTimeoutMs) && cooldownStoreTimeoutMs > 0)
  ) {
    throw refuse(new TypeError(
      `@MeoCord({ cooldownStoreTimeoutMs }) on ${appName} must be a number of milliseconds above 0 (got ${JSON.stringify(cooldownStoreTimeoutMs)}).`,
    ))
  }
}
