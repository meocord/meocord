import { ButtonStyle, Colors } from 'discord.js'
import { type ReservedThemeRole } from '@src/interface/index.js'
import { refuse } from '@src/util/refusal.util.js'
import { escapeForLog, quoteForLog } from '@src/util/user-text.util.js'

/**
 * The role names MeoCord keeps for roles it may add to `colors`, `emojis` and `buttons`: the runtime copy of
 * `ReservedThemeRole`, which refuses them in TypeScript at the root theme, so that a JavaScript app is told too. A type
 * test keeps the two equal.
 */
export const RESERVED_THEME_ROLES = [
  'accent',
  'muted',
  'subtle',
  'secondary',
  'tertiary',
  'attention',
  'severe',
  'error',
  'done',
  'brand',
  'link',
  'premium',
] as const satisfies readonly ReservedThemeRole[]

const reserved = new Set<string>(RESERVED_THEME_ROLES)

const COLOUR = "a 6-digit hex string such as '#7680F4', a number from 0 to 0xFFFFFF, an [r, g, b] tuple of 0–255, or a discord.js colour name"
const EMOJI = 'a unicode emoji, or a custom one written <:name:id> or <a:name:id>'
const BUTTON = 'ButtonStyle.Primary, Secondary, Success or Danger'

/** A custom emoji as Discord writes one in text: its name, 2 to 32 word characters, and its id. */
const CUSTOM_EMOJI = /^<a?:\w{2,32}:\d{17,20}>$/

/**
 * One unicode emoji: a flag of two regional indicators, a subdivision flag (a black flag, tag characters and a cancel
 * tag, as England's), a keycap, or a pictograph with an optional presentation selector or skin tone, joined to others by
 * zero-width joiners into one sequence.
 */
const UNICODE_EMOJI =
  /^(?:\p{Regional_Indicator}{2}|\u{1F3F4}[\u{E0020}-\u{E007E}]+\u{E007F}|[#*0-9]️?⃣|\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?(?:‍\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?)*)$/u

const byte = (value: unknown) => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 255

/** Whether discord.js resolves the value to a colour Discord takes. Stricter on tuples, whose channels it only sums. */
function isColour(value: unknown): boolean {
  if (typeof value === 'string') return /^#?[\da-f]{6}$/i.test(value) || value === 'Random' || value === 'Default' || Object.hasOwn(Colors, value)
  if (typeof value === 'number') return Number.isInteger(value) && value >= 0 && value <= 0xffffff
  return Array.isArray(value) && value.length === 3 && value.every(byte)
}

const isEmoji = (value: unknown) => typeof value === 'string' && (CUSTOM_EMOJI.test(value) || UNICODE_EMOJI.test(value))

const THEMED_BUTTON_STYLES: readonly unknown[] = [ButtonStyle.Primary, ButtonStyle.Secondary, ButtonStyle.Success, ButtonStyle.Danger]
const isButtonStyle = (value: unknown) => THEMED_BUTTON_STYLES.includes(value)

/** A string as a problem shows it: in single quotes for a theme in the app's code, or as a log line quotes outside text. */
type Quote = (text: string) => string
const asWritten: Quote = text => `'${text}'`

const describe = (value: unknown, quote: Quote = asWritten): string =>
  typeof value === 'string'
    ? quote(value)
    : Array.isArray(value)
      ? `[${value.map(item => (typeof item === 'string' ? quote(item) : String(item))).join(', ')}]`
      : value === null
        ? 'null'
        : typeof value === 'object'
          ? 'an object'
          : String(value)

const describeGroup = (value: unknown, quote: Quote = asWritten): string => (Array.isArray(value) ? 'an array' : describe(value, quote))

/** Whether a value is a plain object, as an object literal or `JSON.parse` makes: one a theme merges key by key. */
const isPlainObject = (value: unknown): boolean => {
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const PLAIN = "give a plain object, such as { ...value }, or a row's toObject(), since anything else would replace the whole"

/** What a non-plain object is: by its class, or as one without a plain prototype when it has none named. */
const describeInstance = (value: object): string => {
  const name = (value as { constructor?: { name?: unknown } }).constructor?.name
  return typeof name === 'string' && name ? `a ${name}` : 'an object without a plain prototype'
}

/** How each of MeoCord's groups checks a token, and what it asks for instead. */
const GROUPS: Record<'colors' | 'emojis' | 'buttons', { check: (value: unknown) => boolean; what: string; instead: string }> = {
  colors: { check: isColour, what: 'a colour', instead: COLOUR },
  emojis: { check: isEmoji, what: 'an emoji', instead: EMOJI },
  buttons: { check: isButtonStyle, what: 'a button style a theme can map to', instead: BUTTON },
}

/**
 * What is wrong with a theme or part of one, a line per problem naming its key path: in MeoCord's groups, whatever
 * roles an app added, a colour discord.js cannot resolve, an emoji Discord would refuse, a button style other than
 * Discord's four coloured ones, or a reserved role name. A group of the app's own is its to check.
 * @param where - Where it was set, such as `themeFor.guild for guild 123`, to begin each line with.
 * @param options.forLog - Shows values and role names as a log line shows text from outside the code, for a theme a
 *   `themeFor` resolver returned: escaped, and a value quoted and cut short.
 */
export function themeProblems(theme: unknown, where?: string, { forLog = false }: { forLog?: boolean } = {}): string[] {
  const at = where ? `${where}: ` : ''
  const quote: Quote = forLog ? quoteForLog : asWritten
  const name = forLog ? escapeForLog : (role: string) => role
  if (typeof theme !== 'object' || theme === null || Array.isArray(theme)) {
    return [`${at}theme must be an object of groups (got ${describeGroup(theme, quote)})`]
  }
  if (!isPlainObject(theme)) return [`${at}theme must be a plain object of groups (got ${describeInstance(theme)}): ${PLAIN} theme`]

  const problems: string[] = []
  for (const [group, { check, what, instead }] of Object.entries(GROUPS)) {
    if (!(group in theme)) continue
    const roles = (theme as Record<string, unknown>)[group]
    if (roles === undefined) continue
    if (typeof roles !== 'object' || roles === null || Array.isArray(roles)) {
      problems.push(`${at}theme.${group} must be an object of roles (got ${describeGroup(roles, quote)})`)
      continue
    }
    if (!isPlainObject(roles)) {
      problems.push(`${at}theme.${group} must be a plain object of roles (got ${describeInstance(roles)}): ${PLAIN} group`)
      continue
    }
    for (const [role, value] of Object.entries(roles)) {
      if (reserved.has(role)) problems.push(`${at}theme.${group}.${name(role)}: MeoCord reserves the role name ${name(role)} for a role it may add; rename yours`)
      else if (value !== undefined && !check(value)) problems.push(`${at}theme.${group}.${name(role)}: ${describe(value, quote)} is not ${what}: give ${instead}`)
    }
  }
  return problems
}

/**
 * Why `themeFor` cannot be called, or `undefined` when it can: `{ guild?, user? }` of functions, or a class with a
 * `guild()` or `user()` method. `where` begins each reason, and `takes` ends the one for a value of neither shape.
 */
export function themeForProblem(themeFor: unknown, where: string, takes: string): string | undefined {
  if (typeof themeFor === 'function') {
    const prototype = (themeFor as { prototype?: Record<string, unknown> }).prototype
    if (!prototype) return `${where} takes { guild?, user? }, each a function returning part of a theme, ${takes}`
    if (typeof prototype.guild !== 'function' && typeof prototype.user !== 'function') {
      // A class with no methods at all most likely wrote them as arrow-function properties, which only its instances have
      const methods = Object.getOwnPropertyNames(prototype).filter(name => name !== 'constructor' && typeof Object.getOwnPropertyDescriptor(prototype, name)?.value === 'function')
      const hint = methods.length === 0 ? ' Declare them as methods: arrow-function properties are not on the class.' : ''
      return `${where}: ${themeFor.name} has neither a guild() nor a user() method, so it gives no theme.${hint}`
    }
    return undefined
  }
  if (themeFor === null || typeof themeFor !== 'object') return `${where} takes { guild?, user? }, each a function returning part of a theme, ${takes}`
  for (const [key, resolver] of Object.entries(themeFor)) {
    if (key !== 'guild' && key !== 'user') return `${where} has no resolver '${key}': give guild or user.`
    if (resolver !== undefined && typeof resolver !== 'function') return `${where}: ${key} must be a function returning part of a theme.`
  }
  return undefined
}

/**
 * Throws when a theme has a problem, listing every one, so that a bad token stops the bot where it was set rather than
 * reaching Discord, which would refuse the message.
 *
 * @param theme - A theme as an app wrote it, or any part of one.
 * @param where - Where it was set, such as `App: @MeoCord({ theme })`, to begin the error with.
 */
export function assertValidTheme(theme: unknown, where: string): void {
  // Each problem without the place, which begins the error once
  const problems = themeProblems(theme)
  if (problems.length === 0) return
  throw refuse(new Error(`${where}: the theme has ${problems.length} problem${problems.length === 1 ? '' : 's'}:\n${problems.map(problem => `  ${problem}`).join('\n')}`))
}
