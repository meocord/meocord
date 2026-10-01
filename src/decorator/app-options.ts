import { type ServiceIdentifier } from 'inversify'
import { type ActivityOptions, type ClientOptions } from 'discord.js'
import {
  type DispatchObserver,
  type ExceptionFilter,
  type GuardInterface,
  type InterceptorInterface,
  type MessageCommandOptions,
  type ResponsePresenter,
} from '@src/interface/index.js'
import { type Provider } from '@src/interface/provider.interface.js'
import { type RootTheme, type ThemeResolvers } from '@src/interface/theme.interface.js'
import { type Translator } from '@src/common/translator.js'
import { type CooldownStore } from '@src/common/cooldown-store.js'
import { type CooldownStoreFailure } from '@src/core/cooldown-runner.js'
import { type CheckedEntry } from '@src/decorator/stage-entry.js'

/**
 * What `@MeoCord` takes: the app's controllers, services and client options, and what applies to every handler.
 *
 * Use it to name the options outside the decorator, such as a base shared by two app classes. Each stage list is
 * checked against the classes it holds as `@MeoCord` checks it. A base typed as plain `MeoCordOptions` takes any
 * `params` on a `{ provide, params }` entry; give the entries as its type argument, `MeoCordOptions<[…]>`, or write
 * them inline in `@MeoCord`, to have their params checked too.
 *
 * @remarks
 * These are the app's own options, read when the app is created. What the process needs before the app class is
 * read, the token, the build, sharding and the shutdown timeout, belongs in `meocord.config.ts`.
 *
 * @typeParam G - The guard entries, each checked against the class it provides.
 * @typeParam I - The interceptor entries, each checked against the class it provides.
 * @typeParam F - The filter entries, each checked against the class it provides.
 *
 * @example
 * ```ts
 * const shared: MeoCordOptions = {
 *   controllers: [],
 *   clientOptions: { intents: [GatewayIntentBits.Guilds] },
 *   guards: [StaffGuard],
 *   filters: [CooldownFilter],
 * }
 *
 * @MeoCord(shared)
 * class App {}
 * ```
 *
 * @group Configuration
 * @category App options
 * @see {@link MeoCord}
 * @see {@link MeoCordConfig}
 */
export interface MeoCordOptions<
  G extends readonly unknown[] = readonly unknown[],
  I extends readonly unknown[] = readonly unknown[],
  F extends readonly unknown[] = readonly unknown[],
> {
  /** Controllers to register. */
  controllers: ServiceIdentifier[]

  /**
   * Options for the discord.js `Client`, such as its intents and partials. The shards it runs as are set in
   * `meocord.config.ts`, under `sharding`.
   *
   * @see {@link MeoCordConfig}
   */
  clientOptions: ClientOptions

  /**
   * Activities the bot rotates through, in order: the first is shown once the bot is ready, and the next every 10
   * seconds, starting again after the last. Without them MeoCord leaves the bot's presence as the app sets it.
   */
  activities?: ActivityOptions[]

  /** Services to register that no controller depends on. */
  services?: ServiceIdentifier[]

  /**
   * Values classes inject by token with `@Inject`: `{ provide, useValue }`, `{ provide, useClass }`, or
   * `{ provide, useFactory, inject? }`, whose factory may return a promise, awaited before login. A token is a class,
   * a string, a symbol or a `createToken` token. Provided values run their `onReady` and `onShutdown` hooks, in
   * dependency order with the services.
   */
  providers?: Provider[]

  /**
   * Guards run before every dispatched handler, ahead of the controller's and the method's own guards: guard classes,
   * or `{ provide, params? }`. A controller method called directly runs only its own guards.
   */
  guards?: { [K in keyof G]: CheckedEntry<G[K], new (...args: any[]) => GuardInterface> }

  /**
   * Interceptors run around every dispatched handler except autocomplete, outside the controller's and the method's
   * own. A controller method called directly runs none.
   */
  interceptors?: { [K in keyof I]: CheckedEntry<I[K], new (...args: any[]) => InterceptorInterface> }

  /**
   * Exception filters tried after the method's and the controller's, and for errors outside any handler, such as
   * `CommandNotFoundError`.
   */
  filters?: { [K in keyof F]: CheckedEntry<F[K], new (...args: any[]) => ExceptionFilter<any>> }

  /** The translator `createTranslator` made, injected as `Translator` wherever a class asks for one. */
  i18n?: Translator<any>

  /**
   * Where `@Cooldown` counts calls, in place of this process's memory: a class extending `CooldownStore`, resolved
   * like a service so it can inject its client.
   */
  cooldownStore?: new (...args: any[]) => CooldownStore

  /**
   * What a call with a cooldown gets when the store throws, rejects or does not answer in time: `'deny'`, the default,
   * refuses it with `CooldownStoreError`, which the fallback answers privately; `'allow'` runs it uncounted. Either
   * way the failure is logged once per outage, which ends when the store answers 30 seconds or more after its last
   * failure. Under `'deny'`, a call the store counts after the timeout is given back through its verdict's `release`,
   * so the refused caller loses no use; under `'allow'` that late count is the call's own.
   *
   * @defaultValue `'deny'`
   */
  cooldownStoreFailure?: CooldownStoreFailure

  /**
   * How long a call waits for the cooldown store before it counts as a failure, in milliseconds, at most `2147483647`.
   *
   * @defaultValue `1000`
   */
  cooldownStoreTimeoutMs?: number

  /**
   * The `ResponsePresenter` that styles loading and error views, and, with its `messageError`, a message command's
   * error replies, resolved once from the container. Without one, MeoCord's own styling is used.
   */
  presenter?: new (...args: any[]) => ResponsePresenter

  /**
   * How message commands start and match across the app: the `prefix`, a mention of the bot, `mention: 'only'`, the
   * app's own param `types`, how usage replies look, and the built-in `help`.
   */
  messages?: MessageCommandOptions

  /**
   * `@Observer` classes told about every dispatched call once it has settled, with its outcome and duration, in the
   * order listed. The call never waits for them.
   */
  observers?: (new (...args: any[]) => DispatchObserver)[]

  /**
   * Warns, once per handler, when a handler, or an interceptor that returns without running it, finishes without
   * answering its interaction, or defers it and never follows up, which leaves the user waiting.
   *
   * @defaultValue on in development (`NODE_ENV` is `development`, as under `meocord start --dev`), off otherwise
   */
  warnUnanswered?: boolean

  /**
   * The app's theme: the roles it changes from MeoCord's defaults, and every role the app adds. It applies to every
   * handler, beneath each `@UseTheme`; code reads it with `useTheme()`. Each token is checked as the decorator
   * applies, so a bad one stops the bot before it logs in.
   */
  theme?: RootTheme

  /**
   * Themes by where a call comes from: `guild` for a server's, over the handler's, and `user` for a user's, over the
   * server's, in a server or a DM. Each returns part of a theme or `undefined`, at once or as a promise, and is looked
   * up while `@Defer` acknowledges, before the guards. A result that is not a valid theme is left out, with a warning
   * once per server or user; a resolver that fails or passes its timeout leaves its theme out of the call, logged once
   * until it answers again.
   */
  themeFor?: ThemeResolvers

  /**
   * How long `themeFor`'s results are kept (`ttlSeconds`, 300 unless set) and how many (`maxGuilds`, 10,000, and
   * `maxUsers`, 50,000), the oldest dropped first. Inject `ThemeCache` to clear one sooner.
   */
  themeCache?: { ttlSeconds?: number; maxGuilds?: number; maxUsers?: number }

  /**
   * How long a call waits for a `themeFor` resolver, in milliseconds.
   *
   * @defaultValue `1000`
   */
  themeForTimeoutMs?: number
}
