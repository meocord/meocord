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
import { type RootTheme, type ThemeResolver, type ThemeResolvers } from '@src/interface/theme.interface.js'
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
  /** Controllers to register: their classes. */
  controllers: (abstract new (...args: any[]) => any)[]

  /**
   * Options for the discord.js `Client`, such as its intents and partials. The shards it runs as are set in
   * `meocord.config.ts`, under `sharding`.
   *
   * `allowedMentions` is the default every message the client sends falls back to, `respond()`'s and the app's own
   * `message.reply` and `channel.send` alike: `{ parse: [] }` stops replies pinging whoever their text mentions, and a
   * reply that should ping passes its own, such as `{ users: [id] }`. Left unset, MeoCord warns at startup, since the
   * next major version (5.0) makes `{ parse: [] }` the default (https://github.com/meocord/meocord/issues/501).
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
   * or `{ provide, params? }`. They also run before the built-in help and a parent command's list of subcommands
   * answer a message. A controller method called directly runs only its own guards.
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
   * refuses it with `CooldownStoreError`, which the fallback answers privately (a message command's only with
   * `messages.dmOnError`); `'allow'` runs it uncounted. Either
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
   * The form of the views MeoCord answers an interaction with in a message it starts: `'embed'`, or `'v2'` for a
   * Components V2 container sent with `IsComponentsV2`.
   *
   * @remarks
   * It covers the answers of commands, components and modals: the private reply to an interaction not yet answered,
   * error follow-ups, the private follow-up that replaces a public deferral, and the edit of a deferred reply nothing
   * has been sent into yet. A message that already exists keeps its own form, since Discord can make a message
   * Components V2 but never turn it back: the loading view `@Defer` adds to a component's message, its restore, and an
   * error added to a private component message stay as that message is. A component on a Components V2 message is
   * answered with containers either way. A message command's replies, `messageError` and the direct messages
   * included, stay embeds. The presenter draws as before; `context.mode` tells it which form the view takes.
   *
   * A Components V2 answer carries only components, so a later `respond(interaction).send()` or `edit()` to it
   * drops `content` and `embeds`, with a warning.
   *
   * @defaultValue `'embed'`
   *
   * @example
   * ```ts
   * @MeoCord({ controllers: [PingController], viewMode: 'v2' })
   * class App {}
   * ```
   */
  viewMode?: 'embed' | 'v2'

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
   * Warns about work slow enough to cost the member something: an `@Autocomplete` handler that takes 2 seconds or
   * more to answer, once per handler, or misses Discord's 3 seconds, so the member sees no suggestions; and an
   * `onReady` that has run for 10 seconds, naming the hooks it holds back. A slow message handler is warned about too,
   * unless `messages.slowHandlerWarning` says otherwise. An autocomplete handler that returns without answering is told
   * whatever this says, and its menu closed with no choices.
   *
   * @defaultValue `true` in a running bot, `false` in a `MeoCordTestingModule` unless set to `true`, since a test's
   * fake clock can pass these times inside a handler
   */
  warnSlow?: boolean

  /**
   * Holds each call until the `onReady` hooks of the classes it uses have settled: its handler's class, the guards,
   * interceptors, filters and pipes that run for it, global ones included (an autocomplete waits for its interceptors
   * too, though they don't run for it), the presenter, the `themeFor` class, and what each of them injects. The call
   * waits after `@Defer` acknowledges it and before its guards run. No server's or user's theme is looked up before the
   * `themeFor` class's own hooks have settled, in a call, in a function `bindTheme` wraps, or in an answer outside any
   * call. A call or a lookup for an interaction follows what Discord has been told of it: once Discord has an
   * acknowledgement or an answer, it waits as long as the hooks run; while one is on its way, it waits for the outcome
   * without warning; told nothing, as without `@Defer`, it waits until 2 seconds after the interaction was created (or
   * 2 seconds from the first wait for it, with no creation time or one ahead of the clock), then goes ahead with a
   * warning naming the hook, at once if those have passed. That moment is the interaction's first-answer deadline,
   * which bounds its wait for its themes too (see `themeForTimeoutMs`). A call and the lookups for its interaction
   * waiting at once go ahead together on one decision, the call's warning naming the hook. An autocomplete waits the same way for 1
   * second. A message, a reaction, an event and a bound function called with no interaction wait as long as the hooks
   * run. `@Defer({ mode: 'auto' })`'s acknowledgement counts as on its way from the call's start until it is sent or an
   * answer's Discord call replaces it; an answer still waiting for its theme doesn't hold it back, and is sent after
   * it, the acknowledgement as private as that answer. A hook that throws counts as settled. The hooks still run one at
   * a time, so a call also waits for a slower hook ordered before its own.
   *
   * A stop (`app.stop()`, a signal's shutdown, or a testing module's `close()`) ends the waits where it stops waiting
   * for the calls under way, before the `onShutdown` hooks run, and decides each held call by the end of the event
   * loop iteration's timers and I/O, before its immediates. A call whose hooks have settled by then, by another timer
   * due in the same timers phase included, or whose bound is due, goes ahead and runs first; any other never starts,
   * nor does one held for a hook the stop keeps from running, which ends as soon as that is known. Such a call's
   * observers get `onSettled` with the outcome `'error'` and an error saying the bot stopped before it started. The
   * `onShutdown` hooks wait for that, and for an answer the call made, no longer than the calls' share of
   * `shutdownTimeout`, so they always have their own, and the stop resolves after them. A call whose answer to Discord,
   * or in a testing module an observer's `onStart`, is still running then tells its observers when that settles, which
   * can be after the stop. Nothing more is sent to Discord for such a call, with two exceptions: an answer an observer
   * began in `onStart` goes out in the handler's theme, and a deferred reply `@Defer` already made for a command, with
   * nothing sent into it, is deleted, so the user isn't left on "thinking…". An answer asked for after that is refused,
   * so the reply is never both edited and deleted. The replies are deleted at once, and the `onShutdown` hooks wait for
   * them up to 1 second of their own share, never more than half of it; deletions that fail are named in one warning. A
   * component's deferred update shows nothing and is left as it is. The bot names each such call in a warning of its
   * own. A testing module's `dispatch()` and `invoke()` resolve with `ran: false` and that error, and `emit()` doesn't
   * count it. A theme lookup still waiting then goes on in the handler's theme, without asking the
   * resolver.
   *
   * A `MeoCordTestingModule` takes it from here too: its calls wait only for the hooks `init({ ready: true })` runs,
   * and under strict mocks, which run them in the bot's order, for the same hooks as the bot's calls. A mock
   * interaction was created when it was made, or at its id's time when the test gives one, so a bound counts from
   * there.
   *
   * @defaultValue `false`: calls are handled while the hooks run
   */
  waitForReady?: boolean

  /**
   * Answers a guard's `false` on an interaction as if the guard had thrown `GuardDeniedError`: a command, context menu,
   * component or modal is told privately "You can't use this.", `meocord.guard.denied` in the user's language. The
   * denial takes a thrown one's path, so a filter catching `GuardDeniedError` sees it, observers get its `deniedBy`, and
   * a call with `@Defer` is answered into its deferral. Autocomplete still closes its menu, an event handler still
   * skips the event, and a message command stays silent; a guard that throws its own `GuardDeniedError` keeps its words.
   *
   * @defaultValue `false`
   */
  answerDenied?: boolean

  /**
   * Whether the global guards and interceptors that declare no `types` also run before `@On` and `@Once` handlers.
   * With `false`, they skip gateway events and still run for every other call: commands, components, modals, message
   * commands, reactions and autocomplete. A stage that declares `types` keeps exactly what it declares, `'event'`
   * included. The guards and interceptors a controller or a handler names are unaffected, and so are the global
   * exception filters, which keep handling an event handler's errors. Left unset, the bot warns at startup, once for
   * each such stage, when the app has event handlers; setting it either way silences that.
   *
   * @defaultValue `true`; `false` in the next major version (5.0), as
   * {@link https://github.com/meocord/meocord/issues/502 | meocord#502} plans
   */
  globalStagesOnEvents?: boolean

  /**
   * The app's theme: the roles it changes from MeoCord's defaults, and every role the app adds. It applies to every
   * handler, beneath each `@UseTheme`; code reads it with `useTheme()`. Each token is checked as the decorator
   * applies, so a bad one stops the bot before it logs in.
   */
  theme?: RootTheme

  /**
   * Themes by where a call comes from: `guild` for a server's, over the handler's, and `user` for a user's, over the
   * server's, in a server or a DM. Each returns part of a theme or `undefined`, at once or as a promise, and is looked
   * up while `@Defer` acknowledges, before the guards. A result that is not a valid theme, as is one that cannot be
   * read, such as an object with a cycle or a getter that throws, is left out, with a warning once per server or user;
   * a resolver that fails or passes its timeout leaves its theme out of the call, logged once until it answers again.
   * A class implementing {@link ThemeResolver} does the same with the app's services, resolved from its container.
   * A call from an interaction Discord has been told nothing of waits for them only until its first-answer deadline,
   * as `themeForTimeoutMs` says.
   */
  themeFor?: ThemeResolvers | (new (...args: any[]) => ThemeResolver)

  /**
   * How long `themeFor`'s results are kept (`ttlSeconds`, 300 unless set) and how many (`maxGuilds`, 10,000, and
   * `maxUsers`, 50,000), the oldest dropped first. Inject `ThemeCache` to clear one sooner.
   */
  themeCache?: { ttlSeconds?: number; maxGuilds?: number; maxUsers?: number }

  /**
   * How long a lookup through a `themeFor` resolver may take, in milliseconds. Past it, the resolver counts as failing:
   * its theme is left out, logged once, and asked for again after a backoff.
   *
   * A call from an interaction Discord has been told nothing of also has a first-answer deadline: 2 seconds after the
   * interaction was created, 1 second for an autocomplete, or after the call came when the creation time is missing or
   * ahead of the clock. It covers the wait for the `onReady` hooks under `waitForReady` and the wait for the themes
   * together, so the first answer can reach Discord within its 3 seconds. Once the deadline has passed, the call goes
   * on in its handler's theme and keeps it to its end, with one warning per lookup in flight. The lookup itself goes on
   * within this timeout and its result is kept for later calls; the cut is not a failure and starts no backoff.
   *
   * The deadline doesn't hold while Discord is being told: a call with `@Defer` waits for the whole lookup once its
   * acknowledgement has gone through. If the acknowledgement fails after the deadline, the call goes on at once, so a
   * `@Defer({ mode: 'auto' })` acknowledgement failing at its latest, 2.5 seconds after creation, leaves the first
   * answer that much later. A message, a reaction and an event have no deadline and wait for the whole lookup.
   *
   * Under `waitForReady`, a lookup the hooks held until the deadline starts then, so the call it was for goes on
   * without it, however fast the resolver answers. When a bot's stop or a testing module's close ends its shutdown,
   * the lookups still in flight end with it: a call still waiting on one goes on in its handler's theme, and whatever
   * the lookup gives later is not logged, counted or kept. After that, no resolver is asked: a function `bindTheme`
   * wraps, an answer outside any call and a testing module's `dispatch()` after `close()` answer in the handler's
   * theme, or the app's outside a call. A start that fails and is retried looks themes up as before.
   *
   * @defaultValue `1000`
   */
  themeForTimeoutMs?: number
}
