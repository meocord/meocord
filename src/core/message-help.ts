import {
  type MessageCommandOptions,
  type MessageHelp,
  type MessageHelpEntry,
  type MessageHelpOptions,
  type MessageHelpParam,
  type MessageParamType,
  type MessageScope,
} from '@src/interface/index.js'
import { afterStart, commandWordsOf, fitsScope, type MessageRoute, type MessageStarts } from '@src/core/message-routes.js'
import { isGuildType, paramTypeLabel, primaryFirst, usageOf } from '@src/core/message-params.js'
import { splitWords } from '@src/core/message-words.js'
import { handlerStages } from '@src/core/handler-pipeline.js'

/** The word the built-in help answers to when `messages.help` names no other. */
const HELP_WORD = 'help'

/** The longest reply Discord takes, in characters. */
const MAX_REPLY_LENGTH = 2000

/** The words that ask for help, from `messages.help`: its command, then its aliases; none when help is off. */
export function helpWords(help: boolean | MessageHelpOptions | undefined): string[] {
  if (!help) return []
  if (help === true) return [HELP_WORD]
  return [help.command ?? HELP_WORD, ...(help.aliases ?? [])]
}

/**
 * Whether a route's handler may be listed where the caller did not name it: not hidden, and with no guards on its
 * controller or method, read as the pipeline collects them. Help and a parent's list of subcommands run no guards,
 * so they must not name what a guard may refuse.
 */
export const isListable = (route: MessageRoute): boolean =>
  !route.hidden && handlerStages(route.controllerClass.prototype as object, route.method).guards.length === 0

/**
 * A message asking the built-in help, after a prefix or mention: the start it used and what follows the help word.
 * A message with no start asks nothing, as chat is never taken for a command.
 */
export function matchHelpRequest(
  content: string,
  starts: MessageStarts,
  words: readonly string[],
  caseSensitive: boolean,
): { start: string; query: string } | undefined {
  if (words.length === 0) return undefined
  const text = content.trim()
  const rest = afterStart(text, starts.prefixes.filter(prefix => prefix !== ''), starts.mention, caseSensitive)
  if (!rest) return undefined
  const [first] = splitWords(rest)
  const key = (word: string) => (caseSensitive ? word : word.toLowerCase())
  if (!first || !words.some(word => key(word) === key(first.value))) return undefined
  return { start: text.slice(0, text.length - rest.length), query: rest.slice(first.value.length).trim() }
}

/** The start a caller would type a route with here: its own prefix, a mention, or the start the help message used. */
function displayStart(route: MessageRoute, start: string, starts: MessageStarts): string {
  if (route.mentionOnly && starts.inGuild !== false && starts.bot) return `<@${starts.bot}> `
  if (route.prefix === false) return ''
  if (route.prefix !== undefined) return route.prefix[0] ?? ''
  return start
}

/** Where a route works: its scope, narrowed to servers by a `member`, `role` or `channel` param or flag. */
function effectiveScope(route: MessageRoute): MessageScope {
  if (route.scope !== 'any') return route.scope
  const guildOnly =
    route.tokens.some(token => 'param' in token && token.type !== undefined && isGuildType(token.type)) ||
    route.flags.some(flag => flag.type !== undefined && isGuildType(flag.type))
  return guildOnly ? 'guild' : 'any'
}

/** A route's params and flags, each with what it takes in words. */
function paramsOf(route: MessageRoute, types: Record<string, MessageParamType> | undefined): MessageHelpParam[] {
  const params = route.tokens.flatMap((token): MessageHelpParam[] => {
    if (!('param' in token)) return []
    const label = paramTypeLabel(token.type, types)
    return [{ name: token.param, label: token.rest && token.type !== undefined ? helpText('listOf', { label }) : label, optional: token.optional }]
  })
  const flags = route.flags.map(
    (flag): MessageHelpParam => ({
      name: `--${flag.flag}`,
      label: flag.type === undefined ? helpText('flagOn') : paramTypeLabel(flag.type, types),
      optional: flag.type === undefined || flag.optional,
    }),
  )
  return [...params, ...flags]
}

/** Groups routes by the handler they run, in the order given. */
function byHandler(routes: readonly MessageRoute[]): MessageRoute[][] {
  const groups = new Map<unknown, Map<string, MessageRoute[]>>()
  for (const route of routes) {
    const methods = groups.get(route.controllerClass) ?? new Map<string, MessageRoute[]>()
    groups.set(route.controllerClass, methods)
    methods.set(route.method, [...(methods.get(route.method) ?? []), route])
  }
  return [...groups.values()].flatMap(methods => [...methods.values()])
}

/** A handler's entry, by its primary route, with its aliases as the caller types them. */
function entryOf(
  handlerRoutes: readonly MessageRoute[],
  all: readonly MessageRoute[],
  start: string,
  starts: MessageStarts,
  types: Record<string, MessageParamType> | undefined,
): MessageHelpEntry {
  const primary = [...handlerRoutes].sort(primaryFirst)[0]
  // Its aliases and its other spellings, each by the words that name it
  const own = commandWordsOf(primary.tokens).join(' ')
  const aliases = all
    .filter(route => route.controllerClass === primary.controllerClass && route.method === primary.method && route !== primary)
    .map(route => ({ route, words: commandWordsOf(route.tokens).join(' ') }))
    .filter(({ words }) => words !== '' && words !== own)
    .map(({ route, words }) => displayStart(route, start, starts) + words)
  return {
    usage: usageOf(primary, displayStart(primary, start, starts)),
    command: commandWordsOf(primary.tokens).join(' '),
    ...(primary.description !== undefined && { description: primary.description }),
    aliases: [...new Set(aliases)].sort(),
    scope: effectiveScope(primary),
    params: paramsOf(primary, types),
    handler: { controller: primary.controllerClass.name, method: primary.method },
  }
}

const sortedEntries = (entries: MessageHelpEntry[]) => entries.sort((a, b) => (a.usage < b.usage ? -1 : a.usage > b.usage ? 1 : 0))

/**
 * What help has to say for a message: every command the caller can use here, or the one `query` names, the
 * subcommands of the words it names, or that it names none. Hidden and guarded handlers are left out of lists, and
 * shown when named.
 */
export function computeMessageHelp(
  routes: readonly MessageRoute[],
  { start, query, starts, invocation }: { start: string; query: string; starts: MessageStarts; invocation: string },
  types: Record<string, MessageParamType> | undefined,
): MessageHelp {
  const fits = (route: MessageRoute) => fitsScope(effectiveScope(route), starts.inGuild)
  const entries = (handlers: MessageRoute[][]) => sortedEntries(handlers.map(group => entryOf(group, routes, start, starts, types)))

  if (!query) {
    const listed = byHandler(routes.filter(route => fits(route) && isListable(route)))
    if (listed.length > 0) return { kind: 'list', commands: entries(listed), invocation }
    const serverOnly = starts.inGuild === false && routes.some(route => isListable(route) && effectiveScope(route) === 'guild')
    return { kind: 'empty', reason: serverOnly ? 'server-only' : 'none', invocation }
  }

  const asked = splitWords(query).map(word => word.value)
  const same = (a: string, b: string, route: MessageRoute) => (route.caseSensitive ? a === b : a.toLowerCase() === b.toLowerCase())
  const named = (route: MessageRoute, whole: boolean) => {
    const words = commandWordsOf(route.tokens)
    return (whole ? words.length === asked.length : words.length > asked.length) && asked.every((word, i) => same(word, words[i], route))
  }

  const exact = routes.filter(route => named(route, true))
  const chosen = exact.some(fits) ? exact.filter(fits) : exact
  if (chosen.length > 0) {
    // By the handler's primary route, whichever of its patterns or aliases the query named
    const handlers = byHandler(chosen).map(group => routes.filter(route => route.controllerClass === group[0].controllerClass && route.method === group[0].method && !route.aliasOf).concat(group))
    return { kind: 'command', commands: entries(handlers), invocation }
  }

  const children = byHandler(routes.filter(route => named(route, false) && fits(route) && isListable(route)))
  if (children.length > 0) return { kind: 'parent', subcommands: entries(children), invocation }
  // A query typed as an example, such as `roll 20`, names the command its leading words do
  if (asked.length > 1) {
    const shorter = computeMessageHelp(routes, { start, query: asked.slice(0, -1).join(' '), starts, invocation }, types)
    if (shorter.kind === 'command') return shorter
  }
  return { kind: 'unknown', query, invocation }
}

/** How help was asked for, for the hint its reply gives: the start and the help word. */
export function helpInvocation(start: string, help: MessageCommandOptions['help']): string {
  return start + (helpWords(help)[0] ?? HELP_WORD)
}

/**
 * The built-in help's words, in English, each naming the values it takes as `{name}`. They are kept here, apart
 * from the renderer, so a translation of them replaces this table and nothing else.
 */
export const HELP_TEXT = {
  commandsHeading: 'Commands:',
  commandsHint: "Type {invocation} <command> for one command's usage.",
  describedCommand: '{usage} — {description}',
  usageHeading: 'Usage:',
  usageLine: 'Usage: {usage}',
  param: '{name}: {label}',
  optionalParam: '{name} (optional): {label}',
  paramSeparator: ' · ',
  aliases: 'Also: {aliases}',
  aliasSeparator: ', ',
  serverOnly: 'Works in servers only.',
  dmOnly: 'Works in direct messages only.',
  unknown: 'No command is called "{query}". Type {invocation} to list them.',
  emptyHere: 'There are no commands you can use here.',
  emptyServerOnly: 'These commands work in servers only.',
  listOf: '{label}, one or more',
  flagOn: 'on when given',
} as const

/** One of {@link HELP_TEXT}'s texts, with its `{name}` values filled in. */
function helpText(key: keyof typeof HELP_TEXT, values: Record<string, string> = {}): string {
  return HELP_TEXT[key].replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole)
}

/** The built-in help's reply, in the voice of the usage reply: plain text, a heading line, one line per command. */
export function renderMessageHelp(help: MessageHelp): string {
  switch (help.kind) {
    case 'list':
      return [
        helpText('commandsHeading'),
        ...help.commands.map(({ usage, description }) => (description ? helpText('describedCommand', { usage, description }) : usage)),
        helpText('commandsHint', { invocation: help.invocation }),
      ].join('\n')
    case 'command':
      return help.commands.map(commandBlock).join('\n\n')
    case 'parent':
      return help.subcommands.length === 1
        ? helpText('usageLine', { usage: help.subcommands[0].usage })
        : [helpText('usageHeading'), ...help.subcommands.map(entry => entry.usage)].join('\n')
    case 'unknown':
      return helpText('unknown', { query: help.query, invocation: help.invocation })
    case 'empty':
      return helpText(help.reason === 'server-only' ? 'emptyServerOnly' : 'emptyHere')
  }
}

/** One command's help: its usage, what it does, its params, its aliases, and where it works. */
function commandBlock(entry: MessageHelpEntry): string {
  const params = entry.params.map(({ name, label, optional }) => helpText(optional ? 'optionalParam' : 'param', { name, label }))
  const scope = entry.scope === 'guild' ? helpText('serverOnly') : entry.scope === 'dm' ? helpText('dmOnly') : undefined
  return [
    helpText('usageLine', { usage: entry.usage }),
    entry.description,
    params.length > 0 ? params.join(HELP_TEXT.paramSeparator) : undefined,
    entry.aliases.length > 0 ? helpText('aliases', { aliases: entry.aliases.join(HELP_TEXT.aliasSeparator) }) : undefined,
    scope,
  ]
    .filter((line): line is string => line !== undefined)
    .join('\n')
}

/** Splits a reply into Discord-sized messages at line breaks, a line longer than one message cut where it must be. */
export function splitReply(text: string): string[] {
  const chunks: string[] = []
  let current = ''
  for (const line of text.split('\n')) {
    for (let piece = line; ; piece = piece.slice(MAX_REPLY_LENGTH)) {
      const part = piece.slice(0, MAX_REPLY_LENGTH)
      const joined = current ? `${current}\n${part}` : part
      if (joined.length <= MAX_REPLY_LENGTH) current = joined
      else {
        chunks.push(current)
        current = part
      }
      if (piece.length <= MAX_REPLY_LENGTH) break
    }
  }
  if (current) chunks.push(current)
  return chunks
}
