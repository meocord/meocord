import { type ButtonStyle, type ColorResolvable } from 'discord.js'

/**
 * A button style a theme role maps to: one of Discord's four coloured styles.
 *
 * Link and premium buttons have no role.
 *
 * @group Types
 */
export type ThemeButtonStyle = ButtonStyle.Primary | ButtonStyle.Secondary | ButtonStyle.Success | ButtonStyle.Danger

/**
 * The colours a theme names by role.
 *
 * Embeds, containers' accent and MeoCord's own views take theirs from here. Augment it to add roles of the app's own;
 * see {@link MeoCordTheme}.
 *
 * @group Types
 */
export interface ThemeColors {
  /** The app's own colour, for what is neither good nor bad news. */
  primary: ColorResolvable
  /** A quiet colour, for what needs no attention. */
  neutral: ColorResolvable
  /** Something went as asked. */
  success: ColorResolvable
  /** Something needs the user's attention, or was refused because of what they did. */
  warning: ColorResolvable
  /** Something failed, a fault in the bot rather than the user. */
  danger: ColorResolvable
  /** Information, with no action needed. */
  info: ColorResolvable
}

/**
 * The emojis a theme names by role.
 *
 * Each is a unicode emoji, or a custom one written `<:name:id>` or `<a:name:id>`. Augment it to add roles of the app's
 * own; see {@link MeoCordTheme}.
 *
 * @group Types
 */
export interface ThemeEmojis {
  /** Shown while a deferred call is still working. */
  loading: string
  /** Something went as asked. */
  success: string
  /** Something needs the user's attention, or was refused because of what they did. */
  warning: string
  /** Something failed, a fault in the bot rather than the user. */
  danger: string
  /** Information, with no action needed. */
  info: string
}

/**
 * The button style each role maps to, for the app's own buttons.
 *
 * Warning and info have no Discord style of their own. Augment it to add roles of the app's own; see
 * {@link MeoCordTheme}.
 *
 * @group Types
 */
export interface ThemeButtons {
  /** The action the app most expects, such as Submit. */
  primary: ThemeButtonStyle
  /** A secondary action, such as Cancel or Back. */
  neutral: ThemeButtonStyle
  /** An action that confirms or approves, such as Approve. */
  success: ThemeButtonStyle
  /** An action that removes or refuses, such as Delete or Reject. */
  danger: ThemeButtonStyle
}

/**
 * A theme: design tokens by role, in three groups.
 *
 * MeoCord gives each of its roles a default, so an app sets only what it changes. What code reads is the resolved
 * theme, `DeepReadonly<MeoCordTheme>`, with every role present.
 *
 * @remarks
 * An app adds tokens of its own by augmenting these interfaces from a module, a file with an import, since a `declare
 * module` in a file without one replaces `meocord/interface` rather than extending it. A new role goes in its group's
 * interface and a new group here; each group is an interface of its own because a property declared twice must keep
 * one type. The app's own tokens have no default, so its root theme sets them.
 *
 * @example
 * ```ts
 * // src/types/theme.d.ts
 * import { type ColorResolvable } from 'discord.js'
 * import 'meocord/interface'
 *
 * declare module 'meocord/interface' {
 *   interface ThemeColors {
 *     vip: ColorResolvable
 *   }
 *   interface MeoCordTheme {
 *     charts: { axis: ColorResolvable; series: ColorResolvable[] }
 *   }
 * }
 * ```
 *
 * @group Types
 */
export interface MeoCordTheme {
  /** Colours by role. */
  colors: ThemeColors
  /** Emojis by role. */
  emojis: ThemeEmojis
  /** Button styles by role. */
  buttons: ThemeButtons
}

/** Values a theme holds whole: an array or tuple is one token, never merged or made partial element by element. */
type ThemeLeaf = string | number | bigint | boolean | symbol | null | undefined | readonly unknown[] | ((...args: never[]) => unknown)

/**
 * `T` with every property optional, at every depth; arrays and tuples stay whole.
 *
 * It is the shape of a theme an app, a server or a user gives: only the tokens that change.
 *
 * @group Types
 * @see {@link DeepReadonly}
 */
export type DeepPartial<T> = T extends ThemeLeaf ? T : { [K in keyof T]?: DeepPartial<T[K]> }

/**
 * `T` with every property readonly, at every depth; an array becomes a readonly one of readonly elements.
 *
 * It is the shape of the theme a call reads, which no handler can change.
 *
 * @group Types
 * @see {@link DeepPartial}
 */
export type DeepReadonly<T> = T extends readonly unknown[]
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T extends ThemeLeaf
    ? T
    : { readonly [K in keyof T]: DeepReadonly<T[K]> }

/**
 * Part of a theme, as a scope sets it: any role, of MeoCord's or the app's, and nothing unknown.
 *
 * @group Configuration
 * @category App options
 */
export type ThemeOverride = DeepPartial<MeoCordTheme>

/** The roles MeoCord gives a default for, by group. */
interface DefaultedRoles {
  colors: 'primary' | 'neutral' | 'success' | 'warning' | 'danger' | 'info'
  emojis: 'loading' | 'success' | 'warning' | 'danger' | 'info'
  buttons: 'primary' | 'neutral' | 'success' | 'danger'
}

/**
 * Names MeoCord keeps for roles it may add to any group.
 *
 * They keep a role an app adds today from colliding with one MeoCord adds later. An app that takes one is told so by
 * {@link RootTheme}.
 *
 * @group Types
 */
export type ReservedThemeRole =
  | 'accent'
  | 'muted'
  | 'subtle'
  | 'secondary'
  | 'tertiary'
  | 'attention'
  | 'severe'
  | 'error'
  | 'done'
  | 'brand'
  | 'link'
  | 'premium'

type Flat<T> = { [K in keyof T]: T[K] }

/** A group at the root: the app's own roles required, MeoCord's optional. */
type RootGroup<G, Defaulted extends PropertyKey> = Flat<
  { [K in keyof G as K extends Defaulted ? never : K]: G[K] } & { [K in keyof G & Defaulted]?: G[K] }
>

/** MeoCord's groups the app has added a role to, which the root theme must then give. */
type GroupsWithAppRoles = {
  [K in keyof MeoCordTheme & keyof DefaultedRoles]: [Exclude<keyof MeoCordTheme[K], DefaultedRoles[K]>] extends [never] ? never : K
}[keyof MeoCordTheme & keyof DefaultedRoles]

type UncheckedRootTheme = Flat<
  { [K in keyof MeoCordTheme as K extends keyof DefaultedRoles ? never : K]: MeoCordTheme[K] } & {
    [K in GroupsWithAppRoles]: RootGroup<MeoCordTheme[K], DefaultedRoles[K]>
  } & { [K in Exclude<keyof MeoCordTheme & keyof DefaultedRoles, GroupsWithAppRoles>]?: RootGroup<MeoCordTheme[K], DefaultedRoles[K]> }
>

/** Every reserved role an app has added, as `group.role`. */
type ReservedTaken = {
  [K in keyof DefaultedRoles & keyof MeoCordTheme]: `${K}.${Extract<keyof MeoCordTheme[K], ReservedThemeRole> & string}`
}[keyof DefaultedRoles & keyof MeoCordTheme]

/**
 * The app's theme, as `@MeoCord({ theme })` takes it.
 *
 * Every token the app added is required, since MeoCord has no default for it, and MeoCord's own roles are optional.
 * When the app has added a role MeoCord reserves ({@link ReservedThemeRole}), it is instead a type naming each one, so
 * the root theme fails to compile with the roles to rename.
 *
 * @group Configuration
 * @category App options
 */
export type RootTheme = [ReservedTaken] extends [never]
  ? UncheckedRootTheme
  : { 'MeoCord reserves these theme roles; rename yours': ReservedTaken }

/**
 * What a per-server theme resolver is given: the server a call came from.
 *
 * @group Types
 */
export interface GuildThemeTarget {
  /** The server the call came from. */
  guild: { id: string }
}

/**
 * What a per-user theme resolver is given: the user a call came from.
 *
 * @group Types
 */
export interface UserThemeTarget {
  /** The user who made the call. */
  user: { id: string }
}

/**
 * Themes that depend on where a call comes from, as `@MeoCord({ themeFor })` takes them, or a class implementing
 * {@link ThemeResolver}.
 *
 * Each resolver returns part of a theme, or `undefined` or `null` for none, at once or as a promise. A server's theme
 * goes over the handler's, and a user's over the server's.
 *
 * @remarks
 * Each result is cached, so a resolver runs once per server or user until the cache expires; `ThemeCache` clears it
 * sooner.
 *
 * @group Configuration
 * @category App options
 * @see {@link ThemeResolver}
 */
export interface ThemeResolvers {
  /** The theme for calls from a server; not asked for a call from a DM. */
  guild?: (target: GuildThemeTarget) => ThemeOverride | null | undefined | Promise<ThemeOverride | null | undefined>
  /** The theme for calls from a user, in a server or a DM. */
  user?: (target: UserThemeTarget) => ThemeOverride | null | undefined | Promise<ThemeOverride | null | undefined>
}

/**
 * A class, decorated with `@Service()`, that looks themes up with the app's services, as `@MeoCord({ themeFor })`
 * takes it in place of {@link ThemeResolvers}.
 *
 * Its methods are the resolvers: `guild()` for a server's theme and `user()` for a user's, each optional. The class is
 * resolved from the app's container, so its constructor injects the app's services and providers, and it runs
 * `OnReady` and `OnShutdown` as a service does. Without a decorator, TypeScript records none of its constructor's
 * types, and a constructor that injects is refused.
 *
 * @remarks
 * Its results are cached, timed out and logged as the functions' are; inject `ThemeCache` to clear one when the choice
 * behind it changes.
 *
 * @example
 * ```ts
 * @Service()
 * export class PrefsService {
 *   private readonly choices = new Map<string, ThemeOverride>()
 *
 *   constructor(private readonly themes: ThemeCache) {}
 *
 *   async themeOf(userId: string): Promise<ThemeOverride | undefined> {
 *     return this.choices.get(userId)
 *   }
 *
 *   async choose(userId: string, theme: ThemeOverride) {
 *     this.choices.set(userId, theme)
 *     // The user's next call looks their theme up again
 *     this.themes.invalidateUser(userId)
 *   }
 * }
 *
 * @Service()
 * export class UserThemes implements ThemeResolver {
 *   constructor(private readonly prefs: PrefsService) {}
 *
 *   user({ user }: UserThemeTarget) {
 *     return this.prefs.themeOf(user.id)
 *   }
 * }
 *
 * @MeoCord({ controllers: [], clientOptions: { intents: [] }, themeFor: UserThemes })
 * export class App {}
 * ```
 *
 * @group Configuration
 * @category App options
 */
export interface ThemeResolver {
  /** The theme for calls from a server; not asked for a call from a DM. */
  guild?(target: GuildThemeTarget): ThemeOverride | null | undefined | Promise<ThemeOverride | null | undefined>
  /** The theme for calls from a user, in a server or a DM. */
  user?(target: UserThemeTarget): ThemeOverride | null | undefined | Promise<ThemeOverride | null | undefined>
}
