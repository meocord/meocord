import { type Message } from 'discord.js'
import { MessageUsageError, type MessageUsageIssue } from '@src/common/errors.js'
import { type EntityRef, type MessageParamType } from '@src/interface/index.js'
import { type EntityKind, MessageEntityRef, resolveRefs } from '@src/core/message-entities.js'
import { type FlagToken, type MessageRoute, type PatternToken } from '@src/core/message-routes.js'
import { type GivenFlag, splitFlagWords, splitWords } from '@src/core/message-words.js'
import { type RunOptions } from '@src/core/handler-pipeline.js'
import { bool, choicesOf, duration, number } from '@src/core/scalar-types.js'

type ParamToken = Extract<PatternToken, { param: string }>

/** The ID a mention or a bare snowflake names, for the mention's kind. */
function idOf(word: string, mention: RegExp): string | undefined {
  return (mention.exec(word) ?? /^(\d{17,20})$/.exec(word))?.[1]
}

const USER_MENTION = /^<@!?(\d{17,20})>$/
const ROLE_MENTION = /^<@&(\d{17,20})>$/
const CHANNEL_MENTION = /^<#(\d{17,20})>$/

/** The scalar types, each turning a word into its value or `undefined`, and the Discord ones, which resolve below. */
export const BUILT_IN_TYPES = {
  string: (word: string) => word,
  int: (word: string) => number(word, true),
  number: (word: string) => number(word, false),
  bool,
  duration,
  member: undefined,
  user: undefined,
  role: undefined,
  channel: undefined,
} as const

/** What the usage and its issues call a value of each built-in type. */
const LABELS: Record<string, string> = {
  string: 'text',
  int: 'whole number',
  number: 'number',
  bool: 'yes or no answer',
  duration: 'length of time, such as 10m',
  member: 'member',
  user: 'user',
  role: 'role',
  channel: 'channel',
}

/** The types that exist only in a server. */
const GUILD_TYPES = new Set(['member', 'role', 'channel'])

/** Whether a param type is found only in a server. */
export const isGuildType = (type: string): boolean => GUILD_TYPES.has(type)


/** Whether a pattern's `{name:type}` names a type: built in, words to choose from, or one the app adds. */
export function isKnownParamType(type: string, types: Record<string, MessageParamType> | undefined): boolean {
  return type in BUILT_IN_TYPES || Boolean(choicesOf(type)) || Boolean(types && type in types)
}

/**
 * Whether a word has the form of a value of a built-in type, telling without the message whether an optional
 * param that another follows takes the word. Members, users, roles and channels take a mention or an ID.
 */
export function fitsParamType(type: string, word: string, caseSensitive: boolean): boolean {
  const choices = choicesOf(type)
  if (choices) return choices.some(choice => (caseSensitive ? choice === word : choice.toLowerCase() === word.toLowerCase()))
  switch (type) {
    case 'member':
    case 'user':
      return idOf(word, USER_MENTION) !== undefined
    case 'role':
      return idOf(word, ROLE_MENTION) !== undefined
    case 'channel':
      return idOf(word, CHANNEL_MENTION) !== undefined
    default:
      return (BUILT_IN_TYPES[type as keyof typeof BUILT_IN_TYPES] as (word: string) => unknown)(word) !== undefined
  }
}

/** How the usage shows one param: `<name>`, `[name]` when optional, with `…` for the rest of the message. */
function usageWord(token: ParamToken): string {
  const name = `${token.param}${token.rest ? '…' : ''}`
  return token.optional ? `[${name}]` : `<${name}>`
}

/** How the usage shows a flag: `[--bots]`, `--limit=<limit>`, or `[--from=<from>]` when optional. */
function flagUsage(flag: FlagToken): string {
  if (flag.type === undefined) return `[--${flag.flag}]`
  const shown = `--${flag.flag}=<${flag.flag}>`
  return flag.optional ? `[${shown}]` : shown
}

/** A route's usage as the user types it, after the start the message used, spacing included: `!ban <target> [reason…]`. */
export function usageOf(route: Pick<MessageRoute, 'tokens' | 'flags'>, start: string): string {
  return start + [...route.tokens.map(token => ('literal' in token ? token.literal : usageWord(token))), ...route.flags.map(flagUsage)].join(' ')
}

/** The issue for a word that is not a value of its param's type. */
function wrongType(item: Item, types: Record<string, MessageParamType> | undefined): MessageUsageIssue {
  const choices = choicesOf(item.type)
  const expected = choices ? `one of ${choices.join(', ')}` : `a valid ${types?.[item.type]?.label ?? LABELS[item.type] ?? item.type}`
  return { param: item.key, message: `${item.label}: "${item.word}" is not ${expected}` }
}

/**
 * Refuses a message sent where its command does not work: a `'guild'` command in a DM, or a `'dm'` one in a
 * server. A message with no prefix or mention is refused quietly, as it may be chat.
 *
 * @throws MessageUsageError saying where the command works.
 */
export function assertMessageScope(route: MessageRoute, message: Message, start: string): void {
  const inGuild = message.guildId !== null && message.guildId !== undefined
  if (route.scope === 'guild' && !inGuild) {
    throw new MessageUsageError(usageOf(route, start), [{ message: 'This command works in a server only.' }], { serverOnly: true, quiet: start === '' })
  }
  if (route.scope === 'dm' && inGuild) {
    throw new MessageUsageError(usageOf(route, start), [{ message: 'This command works in direct messages only.' }], { dmOnly: true, quiet: start === '' })
  }
}

/** One word to turn into a value, a param's, a flag's or a list item's, and where the value goes. */
interface Item {
  key: string
  /** How issues name it: the param's name, or the flag as typed, `--from`. */
  label: string
  type: string
  word: string
  /** Its place in a list. */
  index?: number
}

/** Where a ref sits in the params, and how an issue about it reads. */
interface RefSlot {
  key: string
  label: string
  word: string
  kind: EntityKind | 'own'
  /** For an app's own type, what its label calls a value. */
  noun?: string
  index?: number
  ref: EntityRef<unknown>
}

/** A message's typed params read before the guards: entities as refs, and where each ref sits. */
export interface ParsedMessageParams {
  params: Record<string, unknown>
  refs: RefSlot[]
  usage: string
  quiet: boolean
}

/** Whether a value an app's `parse` returned is a ref to resolve after the guards. */
const isRef = (value: unknown): value is EntityRef<unknown> =>
  typeof value === 'object' && value !== null && 'cached' in value && typeof (value as EntityRef<unknown>).resolve === 'function'

/**
 * The params a matched route's guards see, read from the words with no request to Discord: each typed
 * param's word turned into its value, each typed list's words into a list, its flags into `true`, `false` or
 * their values, and each member, user, role or channel into an {@link EntityRef}, filled from the cache.
 *
 * @throws MessageUsageError naming each word that is not a value of its type, each flag the command does not
 *   have or that lacks its value, or saying the command works only in a server, when a param's type needs one
 *   and the message was sent elsewhere.
 */
export async function parseMessageParams(
  route: MessageRoute,
  raw: Record<string, string>,
  message: Message,
  start: string,
  types: Record<string, MessageParamType> | undefined,
): Promise<ParsedMessageParams> {
  const usage = usageOf(route, start)
  const quiet = start === ''
  if (!hasTypedParams(route)) return { params: raw, refs: [], usage, quiet }

  const params: Record<string, unknown> = { ...raw }
  const issues: MessageUsageIssue[] = []
  const items: Item[] = []
  for (const token of route.tokens) {
    if (!('param' in token) || token.type === undefined || raw[token.param] === undefined) continue
    if (!token.rest) {
      items.push({ key: token.param, label: token.param, type: token.type, word: raw[token.param] })
      continue
    }
    const words = splitWords(raw[token.param])
    params[token.param] = new Array(words.length)
    words.forEach(({ value }, index) => items.push({ key: token.param, label: token.param, type: token.type!, word: value, index }))
  }
  const flagIssues = route.flags.length > 0 ? readFlags(route, message, start, params, items) : []

  const guild = message.guild
  const needsGuild = route.tokens.some(token => 'param' in token && token.type !== undefined && GUILD_TYPES.has(token.type))
  if (!guild && (needsGuild || items.some(item => GUILD_TYPES.has(item.type)))) {
    throw new MessageUsageError(usage, [{ message: 'This command works in a server only.' }], { serverOnly: true, quiet })
  }

  const put = (item: Item, value: unknown) => {
    if (item.index === undefined) params[item.key] = value
    else (params[item.key] as unknown[])[item.index] = value
  }
  const refs: RefSlot[] = []
  const refer = (item: Item, kind: RefSlot['kind'], ref: EntityRef<unknown>, noun?: string) => {
    refs.push({ key: item.key, label: item.label, word: item.word, kind, noun, index: item.index, ref })
    put(item, ref)
  }

  for (const item of items) {
    const { type, word } = item
    const choices = choicesOf(type)
    const own = types?.[type]
    let value: unknown
    if (choices) {
      value = route.caseSensitive ? choices.find(choice => choice === word) : choices.find(choice => choice.toLowerCase() === word.toLowerCase())
    } else if (own) {
      value = await own.parse(word, message)
      if (isRef(value)) {
        refer(item, 'own', value, own.label ?? type)
        continue
      }
    } else if (type === 'member' || type === 'user' || type === 'channel') {
      const id = idOf(word, type === 'channel' ? CHANNEL_MENTION : USER_MENTION)
      if (id) {
        refer(item, type, new MessageEntityRef(type, id, message.client, guild))
        continue
      }
    } else if (type === 'role') {
      // Roles are cached with the Guilds intent, so a role is known here or not at all
      const id = idOf(word, ROLE_MENTION)
      const role = id ? guild!.roles.cache.get(id) : guild!.roles.cache.find(candidate => candidate.name.toLowerCase() === word.toLowerCase())
      if (role) {
        refer(item, 'role', new MessageEntityRef('role', role.id, message.client, guild))
        continue
      }
    } else {
      value = (BUILT_IN_TYPES[type as keyof typeof BUILT_IN_TYPES] as (word: string) => unknown)(word)
    }
    if (value === undefined) issues.push(wrongType(item, types))
    else put(item, value)
  }

  issues.push(...flagIssues)
  if (issues.length > 0) throw new MessageUsageError(usage, issues, { quiet })
  return { params, refs, usage, quiet }
}

/**
 * The params the handler receives: each ref in the parsed params replaced by what it names. Nothing a
 * cache holds is fetched, and what is fetched goes out once however many refs, messages and guards ask at
 * the same time (see {@link resolveRefs}). Before the first request, `checkCooldowns` can refuse the call; it
 * is not called when everything is cached.
 *
 * @throws MessageUsageError naming each member, user or channel the message named that does not exist.
 */
export async function fetchMessageParams(parsed: ParsedMessageParams, checkCooldowns?: () => Promise<void>): Promise<Record<string, unknown>> {
  const { refs, usage, quiet } = parsed
  if (refs.length === 0) return parsed.params
  const entities = refs.flatMap(slot => (slot.ref instanceof MessageEntityRef ? [slot.ref] : []))
  if (checkCooldowns && refs.some(slot => slot.ref.cached === undefined)) await checkCooldowns()

  const found = await resolveRefs(entities)
  const params: Record<string, unknown> = { ...parsed.params }
  for (const [key, value] of Object.entries(params)) if (Array.isArray(value)) params[key] = [...value]
  const issues: MessageUsageIssue[] = []
  for (const slot of refs) {
    const value = slot.ref instanceof MessageEntityRef ? found.get(slot.ref) : await slot.ref.resolve()
    if (value === undefined) {
      issues.push(missingEntity(slot))
      continue
    }
    if (slot.index === undefined) params[slot.key] = value
    else (params[slot.key] as unknown[])[slot.index] = value
  }
  if (issues.length > 0) throw new MessageUsageError(usage, issues, { quiet })
  return params
}

/** The issue for a ref that names nothing: a member not in the server, a user, role or channel that does not exist. */
function missingEntity({ key, label, word, kind, noun, ref }: RefSlot): MessageUsageIssue {
  return { param: key, message: `${label}: ${nothingNamed(kind, word, ref.id, noun)}` }
}

/** What the issue says after the param's label, for each kind of ref; a new kind fails to compile until it has its own. */
function nothingNamed(kind: RefSlot['kind'], word: string, id: string, noun: string | undefined): string {
  switch (kind) {
    case 'member':
      return `<@${id}> is not a member of this server`
    case 'user':
      return `no user has the ID ${id}`
    case 'role':
      return `<@&${id}> is not a role in this server`
    case 'channel':
      return `"${word}" is not a channel`
    case 'own':
      return `"${word}" is not a valid ${noun}`
    default:
      return kind satisfies never
  }
}

/**
 * The params a matched route's handler receives, read and fetched in one step: {@link parseMessageParams},
 * then {@link fetchMessageParams}.
 */
export async function resolveMessageParams(
  route: MessageRoute,
  raw: Record<string, string>,
  message: Message,
  start: string,
  types: Record<string, MessageParamType> | undefined,
): Promise<Record<string, unknown>> {
  return fetchMessageParams(await parseMessageParams(route, raw, message, start, types))
}

/**
 * The two steps a matched message command's params take around its guards, for the pipeline: `parseArgs`
 * before them reads the words, refuses a message sent where the command does not work or missing params,
 * and gives entities as refs, with no request to Discord; `fetchArgs`, once the guards let the call through,
 * fetches what the refs name, checking the cooldowns first when there is anything to fetch.
 */
export function messageCommandHooks(
  route: MessageRoute,
  params: Record<string, string>,
  message: Message,
  start: string,
  given: number | undefined,
  types: Record<string, MessageParamType> | undefined,
): Pick<RunOptions, 'parseArgs' | 'fetchArgs'> {
  let parsed: ParsedMessageParams | undefined
  return {
    parseArgs: async args => {
      assertMessageScope(route, message, start)
      if (given !== undefined) throw new MessageUsageError(usageOf(route, start), missingParams(route, given))
      if (!hasTypedParams(route)) return args
      parsed = await parseMessageParams(route, params, message, start, types)
      return [args[0], parsed.params]
    },
    fetchArgs: async (args, admitted) => (parsed ? [args[0], await fetchMessageParams(parsed, () => admitted.checkCooldowns())] : args),
  }
}

/**
 * The usage error that answers a message naming only a command's leading words: the usage of each subcommand
 * it could reach, one line each, sorted so neither declaration order nor file layout decides the order.
 */
export function subcommandUsageError(listing: readonly { route: MessageRoute; start: string }[]): MessageUsageError {
  const lines = [...new Set(listing.map(({ route, start }) => usageOf(route, start)))].sort()
  return new MessageUsageError(lines.join('\n'), [])
}

/**
 * Reads a message's flags into params: a flag without a type as `true` or `false`, a typed one's value as a
 * word to resolve. The issues are the flags the command does not have, and a typed flag missing or given no
 * value. Given twice, a flag takes its last value.
 */
function readFlags(route: MessageRoute, message: Message, start: string, params: Record<string, unknown>, items: Item[]): MessageUsageIssue[] {
  const issues: MessageUsageIssue[] = []
  const key = (name: string) => (route.caseSensitive ? name : name.toLowerCase())
  const given = new Map<string, GivenFlag>()
  const text = (message.content ?? '').trim()
  for (const flag of splitFlagWords(text.slice(start.length)).flags) {
    const declared = route.flags.find(candidate => key(candidate.flag) === key(flag.name))
    if (declared) given.set(declared.flag, flag)
    else if (!issues.some(issue => issue.message.startsWith(`--${flag.name} `))) {
      issues.push({ message: `--${flag.name} is not an option of this command` })
    }
  }
  for (const flag of route.flags) {
    const label = `--${flag.flag}`
    const value = given.get(flag.flag)?.value
    delete params[flag.flag]
    if (flag.type === undefined) {
      const on = value === undefined ? given.has(flag.flag) : bool(value)
      if (on === undefined) issues.push({ param: flag.flag, message: `${label}: "${value}" is not yes or no` })
      else params[flag.flag] = on
    } else if (!given.has(flag.flag)) {
      if (!flag.optional) issues.push({ param: flag.flag, message: `${label} is missing` })
    } else if (!value) {
      issues.push({ param: flag.flag, message: `${label} needs a value, such as ${label}=<${flag.flag}>` })
    } else {
      items.push({ key: flag.flag, label, type: flag.type, word: value })
    }
  }
  return issues
}

/**
 * What is wrong with a command whose words a message named but whose pattern it does not fit, given how many
 * words followed the command words: each required param it left out, or words beyond what the pattern takes.
 */
export function missingParams(route: MessageRoute, given: number): MessageUsageIssue[] {
  const firstParam = route.tokens.findIndex(token => !('literal' in token))
  const after = firstParam === -1 ? [] : route.tokens.slice(firstParam)
  const missing = after
    .slice(given)
    .filter((token): token is ParamToken => 'param' in token && !token.optional)
    .map(token => ({ param: token.param, message: `${token.param} is missing` }))
  if (missing.length > 0) return missing
  return [{ message: 'The command has more words than it takes' }]
}

/** Whether a route's params need resolving: it declares a type for one, or has flags. */
export const hasTypedParams = (route: MessageRoute): boolean =>
  route.flags.length > 0 || route.tokens.some(token => 'param' in token && token.type !== undefined)

