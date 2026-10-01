import { type Message } from 'discord.js'
import { getMessageHandlers } from '@src/decorator/controller.decorator.js'
import { type ControllerClass } from '@src/core/component-routes.js'
import { routeSpecificity } from '@src/core/route-specificity.js'
import { BUILT_IN_TYPES, fitsParamType, isGuildType, isKnownParamType } from '@src/core/message-params.js'
import { type MessageCommandOptions, type MessagePrefix, type MessageScope } from '@src/interface/index.js'
import { type GivenFlag, isSpace, restFrom, splitFlagWords, splitWords } from '@src/core/message-words.js'
import { refuse } from '@src/util/refusal.util.js'

/** One word of a message pattern: a literal word, or a param with the type it declares, if any. */
export type PatternToken = { literal: string } | { param: string; rest: boolean; optional: boolean; type?: string }

type ParamToken = Extract<PatternToken, { param: string }>

/**
 * A flag of a message pattern, `{--name}`, given anywhere in a message as `--name`: without a type it is
 * `true` or `false`; with one, `{--name:type}`, it takes a value, `--name=value`, and is required unless `?`.
 */
export interface FlagToken {
  flag: string
  type?: string
  optional: boolean
}

/** A `@MessageHandler` pattern read into its words and flags, with its rank. */
export interface MessagePattern {
  tokens: PatternToken[]
  flags: FlagToken[]
  specificity: number
}

/** A patterned `@MessageHandler`, as dispatch ranks and matches it. */
export interface MessageRoute {
  controllerClass: ControllerClass
  method: string
  pattern: string
  tokens: PatternToken[]
  specificity: number
  /** The handler's own prefixes, `false` for none, or `undefined` for the app's. */
  prefix: false | readonly string[] | undefined
  /** Whether a mention of the bot alone starts it in a server, as the handler's `mention: 'only'` asks; in a DM it starts as usual. */
  mentionOnly: boolean
  caseSensitive: boolean
  scope: MessageScope
  /** Its flags, which a message may give anywhere, apart from its words. */
  flags: FlagToken[]
  /** The handler's own pattern, when this route is one of its aliases. */
  aliasOf?: string
  /** What the command does, from the handler's `description`. */
  description?: string
  /** Whether the handler asked to be left out of help and of a parent's list of subcommands. */
  hidden: boolean
}

/** What a message may start with to reach a route that uses the app's prefixes. */
export interface MessageStarts {
  /** The app's prefixes; `''` stands for none. */
  prefixes: readonly string[]
  /** The bot's user id, when a mention of it counts as a start. */
  mention?: string
  /** The bot's user id, for the routes a mention alone starts, whatever the app accepts. */
  bot?: string
  /** Whether the message was sent in a server, for the routes whose scope it fits; unset fits every scope. */
  inGuild?: boolean
}

/** Whether a route's scope lets it run where the message was sent. */
export const fitsScope = (scope: MessageScope, inGuild: boolean | undefined) => inGuild === undefined || scope === 'any' || (scope === 'guild') === inGuild

const PARAM = /^\{(\w+)(?::([\w-]+(?:\|[\w-]+)*))?(\.\.\.)?(\?)?\}$/
const FLAG = /^\{--(\w+)(?::([\w-]+(?:\|[\w-]+)*))?(\?)?\}$/

/**
 * Reads a pattern into its words and flags. Throws for a param that is not a whole word, a name given
 * twice, a rest param that is not last, a word after an optional param that is not optional too, an untyped
 * optional before another, which would take every word, and an untyped flag marked optional.
 */
export function parseMessagePattern(pattern: string): MessagePattern {
  // Flags sit anywhere in a message, so they are read apart from the words, which keep their order
  const flags: FlagToken[] = []
  const names = new Set<string>()
  const claim = (name: string) => {
    if (names.has(name)) throw new Error(`{${name}} appears twice; give each param and flag its own name.`)
    names.add(name)
  }
  const words = pattern
    .trim()
    .split(/\s+/)
    .filter(word => {
      const flag = FLAG.exec(word)
      if (!flag) return true
      const [, name, type, optional] = flag
      // A message's `--2fa` is a word: a flag it can give starts with a letter
      if (!/^[A-Za-z]/.test(name)) throw new Error(`${word}: a flag's name starts with a letter, as a message could not give it otherwise.`)
      claim(name)
      if (optional && !type) throw new Error(`${word}: a flag without a type is optional already; write {--${name}}.`)
      flags.push({ flag: name, optional: Boolean(optional), ...(type && { type }) })
      return false
    })
  const tokens: PatternToken[] = []
  if (words.length === 0) throw new Error('a pattern needs a word besides its flags, such as the command.')

  words.forEach((word, index) => {
    const match = PARAM.exec(word)
    if (!match) {
      if (/[{}]/.test(word)) {
        throw new Error(
          `"${word}" is not a param: a param is a whole word, such as {name}, {name:type}, {name...}, {name?} or a flag, {--name}.`,
        )
      }
      tokens.push({ literal: word })
      return
    }
    const [, name, type, rest, optional] = match
    claim(name)
    const last = index === words.length - 1
    if (rest && !last) throw new Error(`{${name}...} takes the rest of the message, so it must be last.`)
    tokens.push({ param: name, rest: Boolean(rest), optional: Boolean(optional), ...(type && { type }) })
  })

  tokens.forEach((token, index) => {
    const next = tokens[index + 1]
    if (!('param' in token) || !token.optional || !next) return
    if (!('param' in next) || !next.optional) {
      throw new Error(`{${token.param}?} is optional, so only optional params may follow it; "${'param' in next ? `{${next.param}}` : next.literal}" is not.`)
    }
    if (token.type === undefined || token.type === 'string') {
      throw new Error(
        `{${token.param}${token.type ? ':string' : ''}?} comes before another optional param, so it needs a type that tells its words ` +
          `from the next param's, such as {${token.param}:int?}: as text, it would take every word.`,
      )
    }
  })

  const params = tokens.filter(token => 'param' in token)
  const specificity = routeSpecificity({
    literals: tokens.length - params.length,
    params: params.length,
    rest: params.some(token => token.rest),
    optional: params.some(token => token.optional),
  })
  return { tokens, flags, specificity }
}

/** A prefix setting as a list, where `''` stands for none. */
function prefixList(prefix: MessagePrefix | undefined): readonly string[] {
  const list = typeof prefix === 'string' ? [prefix] : (prefix ?? [])
  return list.length > 0 ? list : ['']
}

/** Where two routes of equal rank part: the one with a literal word where the other has a param comes first. */
function compareShapes(a: PatternToken[], b: PatternToken[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const aLiteral = 'literal' in a[i]
    if (aLiteral !== 'literal' in b[i]) return aLiteral ? -1 : 1
  }
  return 0
}

/**
 * Where two routes of equal rank and shape part: one with its own start (its prefixes, none, or a mention alone) comes
 * before one that takes the app's, so a start an app's prefix function also gives runs the handler that named it.
 */
const takesAppStart = (route: MessageRoute) => route.prefix === undefined && !route.mentionOnly

/** A mention of the bot, as a start of a message beside the prefixes. */
const MENTION_START = Symbol('mention')
/** The prefixes an app's prefix function returns, known only once a message arrives. */
const APP_FUNCTION_START = Symbol('app prefix function')

/**
 * The starts a route takes in a server or a DM: its own prefixes or the app's, `''` for the message as it is, and a
 * mention of the bot where one starts it. An app's prefix function stands as one start of its own, which only another
 * route using it shares.
 */
function startsOf(route: MessageRoute, place: 'guild' | 'dm', options: MessageCommandOptions): Set<string | symbol> {
  if (place === 'guild' && (route.mentionOnly || (route.prefix === undefined && options.mention === 'only'))) return new Set([MENTION_START])
  if (route.prefix === false) return new Set([''])
  const mention = options.mention ? [MENTION_START] : []
  if (route.prefix !== undefined) return new Set([...route.prefix, ...mention])
  if (typeof options.prefix === 'function') return new Set([APP_FUNCTION_START, ...mention])
  return new Set([...prefixList(options.prefix), ...mention])
}

/** Whether two routes accept some of the same messages: a start they share, and words that match alike. */
function sameMessages(a: MessageRoute, b: MessageRoute, options: MessageCommandOptions): boolean {
  // A case-insensitive word matches every message the case-sensitive one does
  const exact = a.caseSensitive && b.caseSensitive
  const key = (start: string | symbol) => (typeof start === 'string' && !exact ? start.toLowerCase() : start)
  const runsIn = (route: MessageRoute, place: 'guild' | 'dm') => route.scope === 'any' || route.scope === place
  const startAlike = (['guild', 'dm'] as const).some(place => {
    if (!runsIn(a, place) || !runsIn(b, place)) return false
    const theirs = new Set([...startsOf(b, place, options)].map(key))
    return [...startsOf(a, place, options)].some(start => theirs.has(key(start)))
  })
  if (!startAlike || a.tokens.length !== b.tokens.length) return false
  return a.tokens.every((token, i) => {
    const other = b.tokens[i]
    if ('literal' in token) {
      return 'literal' in other && (exact ? token.literal === other.literal : token.literal.toLowerCase() === other.literal.toLowerCase())
    }
    return 'param' in other && token.rest === other.rest && token.optional === other.optional
  })
}

/**
 * Every patterned message handler of the given controllers, most specific first, read from metadata
 * alone. Throws for a pattern that cannot be read and for two that match the same messages.
 */
export function buildMessageRoutes(controllerClasses: readonly ControllerClass[], options: MessageCommandOptions = {}): MessageRoute[] {
  const routes: MessageRoute[] = []
  for (const controllerClass of controllerClasses) {
    for (const { pattern, method, options: own } of getMessageHandlers(controllerClass.prototype)) {
      if (pattern === undefined) continue
      let parsed: MessagePattern
      let aliases: string[]
      try {
        parsed = parseMessagePattern(pattern)
        const typedNames = [
          ...parsed.tokens.flatMap(token => ('param' in token && token.type ? [{ shown: `{${token.param}:${token.type}}`, type: token.type }] : [])),
          ...parsed.flags.flatMap(flag => (flag.type ? [{ shown: `{--${flag.flag}:${flag.type}}`, type: flag.type }] : [])),
        ]
        for (const { shown, type } of typedNames) {
          if (!isKnownParamType(type, options.types)) {
            throw new Error(
              `${shown} names no type. The types are ${Object.keys(BUILT_IN_TYPES).join(', ')}, ` +
                `words to choose from such as {mode:on|off}, and those @MeoCord({ messages: { types } }) adds.`,
            )
          }
        }
        // Which optional takes a word is decided by the word alone, which an app's parse(word, message) cannot tell
        const appTyped = parsed.tokens
          .slice(0, -1)
          .find((token): token is ParamToken => 'param' in token && token.optional && !isBuiltInType(token.type ?? 'string'))
        if (appTyped) {
          throw new Error(
            `{${appTyped.param}:${appTyped.type}?} comes before another optional param, which only a built-in type or words to choose ` +
              `from can: make it required, or put it last.`,
          )
        }
        assertScope(own.scope, parsed)
        assertMention(own)
        if (own.hidden !== undefined && typeof own.hidden !== 'boolean') throw new Error(`hidden is true or false, not ${JSON.stringify(own.hidden)}.`)
        aliases = aliasPatterns(pattern, parsed.tokens, own.aliases)
      } catch (error) {
        throw refuse(new Error(`${controllerClass.name}.${method}: @MessageHandler('${pattern}'): ${(error as Error).message}`))
      }
      const shared = {
        controllerClass,
        method,
        prefix: own.prefix === undefined || own.prefix === false ? own.prefix : prefixList(own.prefix),
        mentionOnly: own.mention === 'only',
        caseSensitive: own.caseSensitive ?? options.caseSensitive ?? false,
        scope: own.scope ?? 'any',
        description: own.description,
        hidden: own.hidden ?? false,
      }
      routes.push({ ...shared, pattern, ...parsed })
      for (const alias of aliases) routes.push({ ...shared, pattern: alias, ...parseMessagePattern(alias), aliasOf: pattern })
    }
  }

  routes.sort((a, b) => b.specificity - a.specificity || compareShapes(a.tokens, b.tokens) || Number(takesAppStart(a)) - Number(takesAppStart(b)))

  for (let i = 0; i < routes.length; i++) {
    for (let j = i + 1; j < routes.length; j++) {
      const [a, b] = [routes[i], routes[j]]
      if (!sameMessages(a, b, options)) continue
      // One handler under two spellings, such as 'hello' and 'Hello', is one route, its pattern's over an alias's
      if (a.controllerClass === b.controllerClass && a.method === b.method) {
        if (a.aliasOf && !b.aliasOf) routes[i] = b
        routes.splice(j--, 1)
        continue
      }
      throw refuse(new Error(
        `${a.controllerClass.name}.${a.method}: ${describeRoute(a)} and ${describeRoute(b)} in ${b.controllerClass.name}.${b.method} ` +
          `match the same messages, so only one of them could ever answer those. Change one pattern, or give one its own prefix.`,
      ))
    }
  }
  return routes
}

/** A route's pattern as an error names it, saying whose alias it is. */
const describeRoute = (route: MessageRoute) => (route.aliasOf ? `"${route.pattern}", an alias of "${route.aliasOf}",` : `"${route.pattern}"`)

/** A pattern's command words: the literal words it begins with. */
export function commandWordsOf(tokens: readonly PatternToken[]): string[] {
  const words: string[] = []
  for (const token of tokens) {
    if (!('literal' in token)) break
    words.push(token.literal)
  }
  return words
}

/** The pattern each alias stands for: the alias's words, then the pattern's after its command words. */
function aliasPatterns(pattern: string, tokens: readonly PatternToken[], aliases: readonly string[] | undefined): string[] {
  if (aliases === undefined) return []
  if (!Array.isArray(aliases)) throw new Error('aliases takes a list of command words, such as { aliases: [\'b\'] }.')
  const command = commandWordsOf(tokens)
  if (command.length === 0) throw new Error('aliases stand for the command words a pattern begins with, and this one begins with a param.')
  // The pattern's words after its command words, its flags kept wherever they are written
  let skipped = 0
  const after = pattern
    .trim()
    .split(/\s+/)
    .filter(word => FLAG.test(word) || ++skipped > command.length)
  return aliases.map(alias => {
    if (typeof alias !== 'string' || !alias.trim() || /[{}]/.test(alias)) {
      throw new Error(`${JSON.stringify(alias)} is not an alias: an alias is one or more command words, with no params.`)
    }
    return [alias.trim(), ...after].join(' ')
  })
}

/** Refuses a scope that is not one, and a command for direct messages with a param or flag only a server has. */
function assertScope(scope: unknown, { tokens, flags }: MessagePattern): void {
  if (scope === undefined) return
  if (scope !== 'guild' && scope !== 'dm' && scope !== 'any') throw new Error(`scope is 'guild', 'dm' or 'any', not ${JSON.stringify(scope)}.`)
  if (scope !== 'dm') return
  const param = tokens.find((token): token is ParamToken => 'param' in token && token.type !== undefined && isGuildType(token.type))
  const flag = flags.find(candidate => candidate.type !== undefined && isGuildType(candidate.type))
  const shown = param ? `{${param.param}:${param.type}}` : flag && `{--${flag.flag}:${flag.type}}`
  if (shown) throw new Error(`scope is 'dm', but ${shown} is found only in a server.`)
}

/** Refuses a handler's `mention` other than `'only'`. */
function assertMention({ mention }: { mention?: unknown }): void {
  if (mention !== undefined && mention !== 'only') {
    throw new Error(`mention is 'only', not ${JSON.stringify(mention)}; the app's mention option covers the rest.`)
  }
}

/**
 * The prefixes the app's options give where the message was sent: none at all in a server when a mention alone
 * starts its commands, while a DM, addressed to the bot already, starts as usual. Unknown counts as a server.
 */
function appPrefixes(options: MessageCommandOptions, prefix: MessagePrefix | undefined, inGuild: boolean | undefined): readonly string[] {
  return options.mention === 'only' && inGuild !== false ? [] : prefixList(prefix)
}

/**
 * The prefixes a prefix function gives for a message. Finding none, an empty list or nothing at all, means no prefix
 * starts a command there: only an explicit `''` takes the message as it is.
 */
function functionPrefixes(options: MessageCommandOptions, found: MessagePrefix | null | undefined, inGuild: boolean | undefined): readonly string[] {
  if (found === undefined || found === null || (Array.isArray(found) && found.length === 0)) return []
  return appPrefixes(options, found, inGuild)
}

/** Whether a route uses the app's prefixes, so they have to be known before it can match. */
export function usesAppPrefix(routes: readonly MessageRoute[]): boolean {
  return routes.some(route => route.prefix === undefined)
}

/**
 * The starts a message has for these routes: as {@link messageStarts} gives them, except that the app's
 * prefixes are read only when a route uses them, so an app whose handlers all have their own prefixes never
 * calls its prefix function. A mention of the bot, and where the message was sent, count either way.
 */
export async function messageStartsFor(
  routes: readonly MessageRoute[],
  options: MessageCommandOptions,
  message: Message,
  botId: string | undefined,
): Promise<MessageStarts> {
  if (usesAppPrefix(routes)) return messageStarts(options, message, botId)
  return { prefixes: [], mention: options.mention ? botId : undefined, bot: botId, inGuild: message.guildId !== null && message.guildId !== undefined }
}

/**
 * The starts the app accepts for this message: its prefixes, read from the function when it is one,
 * and a mention of the bot when `mention` is on.
 */
export async function messageStarts(options: MessageCommandOptions, message: Message, botId: string | undefined): Promise<MessageStarts> {
  const inGuild = message.guildId !== null && message.guildId !== undefined
  const prefixes =
    typeof options.prefix === 'function' ? functionPrefixes(options, await options.prefix(message), inGuild) : appPrefixes(options, options.prefix, inGuild)
  return { prefixes, mention: options.mention ? botId : undefined, bot: botId, inGuild }
}

/**
 * The same, for a caller that cannot run a prefix function: `prefix` stands in for what it returns.
 * @throws TypeError when the app's prefix is a function and no `prefix` is given.
 */
export function staticMessageStarts(
  app: { name: string },
  options: MessageCommandOptions,
  { prefix, botId, dm }: { prefix?: MessagePrefix; botId?: string; dm?: boolean },
): MessageStarts {
  if (typeof options.prefix === 'function' && prefix === undefined) {
    throw new TypeError(`${app.name} reads its prefixes from a function; pass the prefix this message has, as { content, prefix }.`)
  }
  // Where the message was sent is known only for a DM; otherwise every scope fits, and a mention alone starts
  // what it starts in a server
  const inGuild = dm ? false : undefined
  return {
    prefixes:
      typeof options.prefix === 'function' ? functionPrefixes(options, prefix, inGuild) : appPrefixes(options, prefix ?? options.prefix, inGuild),
    mention: options.mention ? botId : undefined,
    bot: botId,
    ...(dm && { inGuild: false }),
  }
}

/** The text after the longest start the message begins with, or `undefined` when it begins with none. */
export function afterStart(text: string, prefixes: readonly string[], mention: string | undefined, caseSensitive: boolean): string | undefined {
  const starts = [
    ...prefixes.map(prefix => ({ start: prefix, exact: caseSensitive })),
    ...(mention ? [`<@${mention}>`, `<@!${mention}>`].map(start => ({ start, exact: true })) : []),
  ].sort((a, b) => b.start.length - a.start.length)

  for (const { start, exact } of starts) {
    const head = text.slice(0, start.length)
    if (exact ? head !== start : head.toLowerCase() !== start.toLowerCase()) continue
    const rest = text.slice(start.length).trimStart()
    if (rest) return rest
  }
  return undefined
}

/** One step of a compiled pattern: literal words by key, one param edge, and the routes ending here. */
interface TrieNode {
  words: Map<string, TrieNode>
  param?: TrieNode
  /** Routes, by rank, whose words end here. */
  ends: number[]
  /** Routes, by rank, whose rest param starts here and takes one word or more. */
  rests: number[]
  /** Routes, by rank, whose two or more trailing optional params start here, and those params. */
  tails: { rank: number; tokens: ParamToken[] }[]
}

/** Routes that share how a message starts for them, and their words compiled into one trie. */
interface RouteGroup {
  /** The route's own prefixes, `false` for none, or `undefined` for the app's. */
  prefix: false | readonly string[] | undefined
  caseSensitive: boolean
  /** Whether a mention alone starts its routes in a server. */
  mentionOnly: boolean
  root: TrieNode
  /** The routes with flags, matched against a message's words once its flags are taken out. */
  flagged?: TrieNode
  /**
   * The routes with flags that begin with a param, for a message whose first word is a flag: flags count only
   * after a command's first word, and a route without command words takes them anywhere.
   */
  flaggedAfterFlag?: TrieNode
  /** Routes by rank, under the first of their command words, the literal words their patterns begin with. */
  commands: Map<string, number[]>
}

/** Routes compiled once for dispatch: grouped by how a message starts for them, each group a trie of words. */
interface MessageIndex {
  groups: RouteGroup[]
  /** Whether some route can match a message with no prefix, so no message can be turned away by its first character. */
  acceptsAnyStart: boolean
  /** Whether some route uses the app's prefixes, which each message brings. */
  usesAppStarts: boolean
  /** The characters the routes' own prefixes begin with, in either case. */
  ownFirsts: Set<string>
  /** Whether some route starts with a mention alone, whatever mention the app accepts. */
  mentionOnly: boolean
}

/** Whether a param type is built in or words to choose from, whose words the word alone tells apart. */
const isBuiltInType = (type: string) => type in BUILT_IN_TYPES || type.includes('|')

const trieNode = (): TrieNode => ({ words: new Map(), ends: [], rests: [], tails: [] })

/** Where a route's trailing optional params start, when it has two or more; which of them a word goes to depends on the word. */
function tailStart(tokens: PatternToken[]): number {
  const first = tokens.findIndex(token => 'param' in token && token.optional)
  return first !== -1 && first < tokens.length - 1 ? first : -1
}

/**
 * Gives a message's last words, from `from`, to a route's trailing optional params, left to right: one that
 * another follows takes a word only if the word fits its type, and is left out otherwise. The last takes
 * any word, and a rest the words that remain. `undefined` when words are left over.
 */
function assignTail(
  tail: ParamToken[],
  words: { value: string; start: number }[],
  from: number,
  text: string,
  cuts: readonly number[],
  caseSensitive: boolean,
): Record<string, string> | undefined {
  const params: Record<string, string> = {}
  let w = from
  for (let t = 0; t < tail.length && w < words.length; t++) {
    const token = tail[t]
    if (token.rest) {
      params[token.param] = restFrom(text, words[w].start, cuts)
      return params
    }
    if (t < tail.length - 1 && !fitsParamType(token.type!, words[w].value, caseSensitive)) continue
    params[token.param] = words[w++].value
  }
  return w === words.length ? params : undefined
}
/** The flags and flag places of a message read without them: one shared empty list, never written to. */
const NONE: never[] = []

const wordKey = (word: string, caseSensitive: boolean) => (caseSensitive ? word : word.toLowerCase())

/** Compiles ranked routes into tries, one per group; a route keeps its rank, its position in `routes`. */
function compileIndex(routes: readonly MessageRoute[]): MessageIndex {
  const groups = new Map<string, RouteGroup>()
  routes.forEach((route, rank) => {
    const startKey = route.prefix === undefined ? 'app' : route.prefix === false ? 'none' : JSON.stringify(route.prefix)
    const key = `${startKey}|${route.caseSensitive}|${route.mentionOnly}`
    let group = groups.get(key)
    if (!group) {
      groups.set(
        key,
        (group = { prefix: route.prefix, caseSensitive: route.caseSensitive, mentionOnly: route.mentionOnly, root: trieNode(), commands: new Map() }),
      )
    }
    const [first] = route.tokens
    if ('literal' in first) {
      const command = wordKey(first.literal, route.caseSensitive)
      group.commands.set(command, [...(group.commands.get(command) ?? []), rank])
    }

    let node = route.flags.length > 0 ? (group.flagged ??= trieNode()) : group.root
    const tail = tailStart(route.tokens)
    for (const [i, token] of route.tokens.entries()) {
      if (i === tail) {
        node.tails.push({ rank, tokens: route.tokens.slice(tail) as ParamToken[] })
        return
      }
      if ('literal' in token) {
        const key = wordKey(token.literal, route.caseSensitive)
        let next = node.words.get(key)
        if (!next) node.words.set(key, (next = trieNode()))
        node = next
        continue
      }
      // An optional param may be left out: the route also ends before it
      if (token.optional) node.ends.push(rank)
      if (token.rest) {
        node.rests.push(rank)
        return
      }
      node = node.param ??= trieNode()
    }
    node.ends.push(rank)
  })
  const all = [...groups.values()]
  for (const group of all) {
    const flagged = group.flagged
    if (flagged) group.flaggedAfterFlag = { ...flagged, words: new Map() }
  }
  const ownPrefixes = all.flatMap(group => (Array.isArray(group.prefix) ? group.prefix : []))
  return {
    groups: all,
    acceptsAnyStart:
      all.some(group => group.prefix === false) ||
      // Lowercasing a character outside ASCII can change its length, so such a prefix turns nothing away
      ownPrefixes.some(prefix => prefix === '' || prefix.charCodeAt(0) > 127),
    usesAppStarts: all.some(group => group.prefix === undefined),
    mentionOnly: all.some(group => group.mentionOnly),
    // An empty prefix has no first character; it makes the index accept any start instead
    ownFirsts: new Set(ownPrefixes.filter(Boolean).flatMap(prefix => [prefix[0], prefix[0].toLowerCase(), prefix[0].toUpperCase()])),
  }
}

/**
 * The key of the text's first word as typed, read up to the first space with no split; `undefined` when the
 * text opens with a quote, whose word only a split reads.
 */
function firstWordKey(text: string, caseSensitive: boolean): string | undefined {
  if (text[0] === '"' || text[0] === '“') return undefined
  // Lowercasing allocates, so a word with no capital, as most are, is used as it is
  let upper = false
  let end = 0
  for (; end < text.length && !isSpace(text, end); end++) {
    const code = text.charCodeAt(end)
    if ((code >= 65 && code <= 90) || code > 127) upper = true
  }
  const word = end === text.length ? text : text.slice(0, end)
  return upper && !caseSensitive ? word.toLowerCase() : word
}

/** Whether words beginning with `first` may reach a route from `node`, so they are worth splitting and walking. */
function mayEnter(node: TrieNode | undefined, first: string | undefined): node is TrieNode {
  if (!node) return false
  if (first === undefined || node.param || node.rests.length > 0 || node.tails.length > 0 || node.ends.length > 0) return true
  return node.words.has(first)
}

/** The ranks of every route the words reach from `node`. Each node sits at one word depth, so each is visited once. */
function reach(
  node: TrieNode,
  words: { value: string; start: number }[],
  i: number,
  text: string,
  cuts: readonly number[],
  caseSensitive: boolean,
  found: number[],
): void {
  for (const tail of node.tails) if (assignTail(tail.tokens, words, i, text, cuts, caseSensitive)) found.push(tail.rank)
  if (i === words.length) {
    for (const rank of node.ends) found.push(rank)
    return
  }
  for (const rank of node.rests) found.push(rank)
  const next = node.words.get(wordKey(words[i].value, caseSensitive))
  if (next) reach(next, words, i + 1, text, cuts, caseSensitive, found)
  if (node.param) reach(node.param, words, i + 1, text, cuts, caseSensitive, found)
}

/** The params a route's words capture, given words its pattern is known to match. */
function paramsOf(route: MessageRoute, words: { value: string; start: number }[], text: string, cuts: readonly number[]): Record<string, string> {
  const tail = tailStart(route.tokens)
  const params: Record<string, string> =
    tail === -1 ? {} : assignTail(route.tokens.slice(tail) as ParamToken[], words, tail, text, cuts, route.caseSensitive)!
  for (let i = 0; i < (tail === -1 ? route.tokens.length : tail) && i < words.length; i++) {
    const token = route.tokens[i]
    if ('literal' in token) continue
    if (token.rest) {
      params[token.param] = restFrom(text, words[i].start, cuts)
      break
    }
    params[token.param] = words[i].value
  }
  return params
}

/**
 * The text after the start a message used for the group's routes, or `undefined` when it used none: a mention
 * alone for routes a mention alone starts in a server, else the group's prefixes or the app's, or none at all.
 */
function restFor(group: RouteGroup, text: string, starts: MessageStarts): string | undefined {
  if (group.mentionOnly && starts.inGuild !== false) return afterStart(text, [], starts.bot ?? starts.mention, group.caseSensitive)
  if (group.prefix === false) return text
  return afterStart(text, group.prefix ?? starts.prefixes, starts.mention, group.caseSensitive)
}

/** Whether a message beginning with `first` can reach some route: a check of first characters, with no allocation. */
function mayStart(index: MessageIndex, starts: MessageStarts, first: string): boolean {
  if (index.acceptsAnyStart || index.ownFirsts.has(first)) return true
  if ((starts.mention || (index.mentionOnly && starts.bot)) && first === '<') return true
  if (!index.usesAppStarts) return false
  for (const prefix of starts.prefixes) {
    if (prefix === '' || prefix.charCodeAt(0) > 127) return true
    const head = prefix[0]
    if (head === first || head.toLowerCase() === first.toLowerCase()) return true
  }
  return false
}

const indexes = new WeakMap<readonly MessageRoute[], MessageIndex>()

/**
 * The route dispatch runs for a message's content: the first, in rank order, that the content matches
 * after the route's start, with the captured params. The routes are compiled into tries once, so a message
 * costs one pass over its words whatever the number of routes, and one whose first character no start
 * begins with costs a lookup.
 */
export function matchMessageRoute(
  routes: readonly MessageRoute[],
  content: string,
  starts: MessageStarts,
): { route: MessageRoute; params: Record<string, string>; start: string } | undefined {
  let index = indexes.get(routes)
  if (!index) indexes.set(routes, (index = compileIndex(routes)))

  // Most messages are chatter: one that no start begins with is turned away before anything is copied or split
  let first = 0
  while (first < content.length && isSpace(content, first)) first++
  if (first === content.length || !mayStart(index, starts, content[first])) return undefined
  const text = content.trim()

  // Each distinct text after a start is split into words once
  const split = new Map<string, { value: string; start: number }[]>()
  const wordsOf = (rest: string) => {
    let words = split.get(rest)
    if (!words) split.set(rest, (words = splitWords(rest)))
    return words
  }
  // One shape for every candidate, so the engine keeps this code monomorphic. A route whose scope does not fit
  // runs only when none that fits matches, so dispatch can say where it works
  interface Candidate { rank: number; words: { value: string; start: number }[]; rest: string; flags: readonly GivenFlag[]; cuts: readonly number[] }
  let best: Candidate | undefined
  let outside: Candidate | undefined
  for (const group of index.groups) {
    const rest = restFor(group, text, starts)
    if (!rest) continue
    // A trie is split for and walked only when its first word could lead somewhere, so an unknown command costs
    // no split, and a message naming a command with flags is not split a second time for the routes without
    const first = firstWordKey(rest, group.caseSensitive)
    const found: number[] = []
    if (mayEnter(group.root, first)) {
      const words = wordsOf(rest)
      reach(group.root, words, 0, rest, NONE, group.caseSensitive, found)
      for (const rank of found) {
        if (fitsScope(routes[rank].scope, starts.inGuild)) {
          if (!best || rank < best.rank) best = { rank, words, rest, flags: NONE, cuts: NONE }
        } else if (!outside || rank < outside.rank) outside = { rank, words, rest, flags: NONE, cuts: NONE }
      }
    }
    const flagged = group.flagged
    if (!mayEnter(flagged, first)) continue
    // One pass takes out the flags, keeping each word's place in the text, and the rest is cut only for the route chosen
    const scanned = rest.includes('--') ? splitFlagWords(rest) : { words: wordsOf(rest), flags: NONE, cuts: NONE }
    found.length = 0
    const from = scanned.words[0]?.start === 0 ? flagged : group.flaggedAfterFlag!
    reach(from, scanned.words, 0, rest, scanned.cuts, group.caseSensitive, found)
    for (const rank of found) {
      const candidate = { rank, words: scanned.words, rest, flags: scanned.flags, cuts: scanned.cuts }
      if (fitsScope(routes[rank].scope, starts.inGuild)) {
        if (!best || rank < best.rank) best = candidate
      } else if (!outside || rank < outside.rank) outside = candidate
    }
  }
  const chosen = best ?? outside
  if (!chosen) return undefined
  const route = routes[chosen.rank]
  const params = paramsOf(route, chosen.words, chosen.rest, chosen.cuts)
  for (const { name, value } of chosen.flags) {
    const declared = route.flags.find(flag => wordKey(flag.flag, route.caseSensitive) === wordKey(name, route.caseSensitive))
    if (declared) params[declared.flag] = value ?? ''
  }
  return { route, params, start: text.slice(0, text.length - chosen.rest.length) }
}

/**
 * The command a message names when no pattern matches it: the best-ranked route whose command words the
 * message begins with, after a prefix or mention it used. A message with no prefix or mention names none, so
 * ordinary chat is never taken for a command. Only the routes that share the message's first word are read.
 */
export function matchMessageCommand(
  routes: readonly MessageRoute[],
  content: string,
  starts: MessageStarts,
): { route: MessageRoute; start: string; given: number } | undefined {
  let index = indexes.get(routes)
  if (!index) indexes.set(routes, (index = compileIndex(routes)))
  let first = 0
  while (first < content.length && isSpace(content, first)) first++
  if (first === content.length || !mayStart(index, starts, content[first])) return undefined
  const text = content.trim()

  // The command's usage comes from a route whose scope fits, else from one whose reply says where it works
  let best: { rank: number; start: string; given: number } | undefined
  let outside: { rank: number; start: string; given: number } | undefined
  for (const group of index.groups) {
    if (group.prefix === false && !(group.mentionOnly && starts.inGuild !== false)) continue
    const rest = restFor(group, text, starts)
    if (!rest || rest.length === text.length) continue
    // A message whose first word names no command is not split, unless it is quoted; a flag names none
    const first = firstWordKey(rest, group.caseSensitive)
    if (first !== undefined && !group.commands.has(first)) continue
    const plain = splitWords(rest)
    // A route with flags counts the words left once the message's flags are taken out
    const positional = mayEnter(group.flagged, first) && rest.includes('--') ? splitFlagWords(rest).words : plain
    const candidates = group.commands.get(wordKey(plain[0]?.value ?? '', group.caseSensitive)) ?? []
    for (const rank of candidates) {
      if (best && rank >= best.rank) break
      const words = routes[rank].flags.length > 0 ? positional : plain
      const command = commandWordsOf(routes[rank].tokens)
      if (command.every((word, i) => words[i] && wordKey(words[i].value, group.caseSensitive) === wordKey(word, group.caseSensitive))) {
        const named = { rank, start: text.slice(0, text.length - rest.length), given: words.length - command.length }
        if (fitsScope(routes[rank].scope, starts.inGuild)) {
          best = named
          break
        }
        if (!outside || rank < outside.rank) outside = named
      }
    }
  }
  const chosen = best ?? outside
  return chosen && { route: routes[chosen.rank], start: chosen.start, given: chosen.given }
}

/**
 * The subcommands a message names the parent of, when no pattern matches it and it names no command: the routes
 * whose command words begin with the most of the message's words, short of all of them, as `!config` or
 * `!config nope` does for `config set …` and `config get …`. Only routes `listable` accepts, that the message
 * started as they start and whose scope fits, count, so a parent whose subcommands are all left out names none.
 * A message with no prefix or mention names none, as chat is never taken for a command.
 */
export function matchMessageSubcommands(
  routes: readonly MessageRoute[],
  content: string,
  starts: MessageStarts,
  listable: (route: MessageRoute) => boolean,
): { route: MessageRoute; start: string }[] | undefined {
  let index = indexes.get(routes)
  if (!index) indexes.set(routes, (index = compileIndex(routes)))
  let first = 0
  while (first < content.length && isSpace(content, first)) first++
  if (first === content.length || !mayStart(index, starts, content[first])) return undefined
  const text = content.trim()

  let depth = 0
  let found: { route: MessageRoute; start: string }[] = []
  for (const group of index.groups) {
    if (group.prefix === false && !(group.mentionOnly && starts.inGuild !== false)) continue
    const rest = restFor(group, text, starts)
    if (!rest || rest.length === text.length) continue
    const firstWord = firstWordKey(rest, group.caseSensitive)
    if (firstWord === undefined || !group.commands.has(firstWord)) continue
    const words = splitWords(rest)
    const start = text.slice(0, text.length - rest.length)
    for (const rank of group.commands.get(firstWord)!) {
      const route = routes[rank]
      if (!fitsScope(route.scope, starts.inGuild) || !listable(route)) continue
      const command = commandWordsOf(route.tokens)
      let shared = 0
      while (shared < command.length && words[shared] && wordKey(words[shared].value, group.caseSensitive) === wordKey(command[shared], group.caseSensitive)) shared++
      // A route whose every command word the message gives is a command it names, not a parent of
      if (shared === command.length || shared < depth) continue
      if (shared > depth) {
        depth = shared
        found = []
      }
      found.push({ route, start })
    }
  }
  return found.length > 0 ? found : undefined
}

/**
 * What a test calling a handler with a message alone passes as its params, as dispatch would build
 * them: `undefined` for a listener, which takes none; `{}` for a message without content; otherwise
 * what the handler's pattern captures, with the route and the start the message used. A message that
 * names the command after a prefix or mention without fitting its pattern gives the route, the start and
 * `given`, the words after the command words. Either only when dispatch would give the message to this
 * handler among `controllers`; any other gives why it does not reach the handler.
 */
export async function messageParamsFor(
  controllerClass: ControllerClass,
  methodName: string,
  message: Message,
  options: MessageCommandOptions,
  controllers: readonly ControllerClass[] = [controllerClass],
): Promise<{ params: Record<string, string>; route?: MessageRoute; start?: string; given?: number } | { mismatch: string } | undefined> {
  // The handler's pattern and its aliases, ranked as dispatch ranks them
  const routes = buildMessageRoutes([controllerClass], options).filter(candidate => candidate.method === methodName)
  if (routes.length === 0) return undefined
  if (typeof message.content !== 'string') return { params: {} }

  const botId = message.client?.user?.id
  const all = buildMessageRoutes(controllers, options)
  const starts = await messageStartsFor(all, options, message, typeof botId === 'string' ? botId : undefined)
  // The handler dispatch gives the message to, among every handler of the module: the best match, else the command it names
  const target = matchMessageRoute(all, message.content, starts) ?? matchMessageCommand(all, message.content, starts)
  if (target && (target.route.controllerClass !== controllerClass || target.route.method !== methodName)) {
    const other = `${target.route.controllerClass.name}.${target.route.method}`
    return { mismatch: `message '${message.content}' does not reach ${controllerClass.name}.${methodName}: dispatch runs ${other}.` }
  }
  if (target && 'params' in target) return { params: target.params, route: target.route, start: target.start }
  if (target) return { params: {}, route: target.route, start: target.start, given: target.given }
  const pattern = routes.find(route => !route.aliasOf)?.pattern ?? routes[0].pattern
  return { mismatch: `message '${message.content}' does not match ${controllerClass.name}.${methodName}'s pattern '${pattern}'.` }
}
