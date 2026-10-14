import { Controller, MessageHandler } from '@src/decorator/index.js'
import { buildMessageRoutes, matchMessageRoute, type MessageRoute, type MessageStarts } from '@src/core/message-routes.js'

/*
 * The compiled index must pick what a scan of the ranked routes picks: the first route, in rank order,
 * that the message matches after that route's start. The scan below is that definition, written out
 * plainly, and random route sets and messages are checked against it.
 */

function afterStart(text: string, prefixes: readonly string[], mention: string | undefined, caseSensitive: boolean) {
  const all = [
    ...prefixes.map(start => ({ start, exact: caseSensitive })),
    ...(mention ? [`<@${mention}>`, `<@!${mention}>`].map(start => ({ start, exact: true })) : []),
  ].sort((a, b) => b.start.length - a.start.length)
  for (const { start, exact } of all) {
    const head = text.slice(0, start.length)
    if (exact ? head !== start : head.toLowerCase() !== start.toLowerCase()) continue
    const rest = text.slice(start.length).trimStart()
    if (rest) return rest
  }
  return undefined
}

function splitWords(text: string) {
  const quotes = new Map([
    ['"', ['"', '”']],
    ['“', ['”', '"']],
  ])
  const words: { value: string; start: number }[] = []
  let i = 0
  while (i < text.length) {
    if (/\s/.test(text[i])) {
      i++
      continue
    }
    const start = i
    const closers = quotes.get(text[i])
    if (closers) {
      let end = i + 1
      while (end < text.length && !(closers.includes(text[end]) && (end + 1 === text.length || /\s/.test(text[end + 1])))) end++
      if (end < text.length) {
        words.push({ value: text.slice(i + 1, end), start })
        i = end + 1
        continue
      }
    }
    while (i < text.length && !/\s/.test(text[i])) i++
    words.push({ value: text.slice(start, i), start })
  }
  return words
}

const fits = (type: string, word: string, exact: boolean) =>
  type === 'int' ? /^[+-]?\d+$/.test(word) : type.split('|').some(choice => (exact ? choice === word : choice.toLowerCase() === word.toLowerCase()))

function scanMatch(routes: readonly MessageRoute[], content: string, starts: MessageStarts) {
  const text = content.trim()
  for (const route of routes) {
    const rest = route.prefix === false ? text : afterStart(text, route.prefix ?? starts.prefixes, starts.mention, route.caseSensitive)
    if (!rest) continue
    const words = splitWords(rest)
    const params: Record<string, string> = {}
    let matched = true
    let done = false
    // Two or more trailing optionals take the words after the others, each only a word that fits it unless it is last
    const firstOptional = route.tokens.findIndex(token => 'param' in token && token.optional)
    const tailAt = firstOptional !== -1 && firstOptional < route.tokens.length - 1 ? firstOptional : route.tokens.length
    for (let i = 0; i < tailAt && !done; i++) {
      const token = route.tokens[i]
      const word = words[i]
      if ('literal' in token) {
        if (!word || (route.caseSensitive ? word.value !== token.literal : word.value.toLowerCase() !== token.literal.toLowerCase())) {
          matched = false
          done = true
        }
        continue
      }
      if (!word) {
        matched = token.optional
        done = true
        continue
      }
      if (token.rest) {
        params[token.param] = rest.slice(word.start).trimEnd()
        done = true
        continue
      }
      params[token.param] = word.value
    }
    let complete = done ? matched : words.length === route.tokens.length
    if (!done && tailAt < route.tokens.length) {
      let w = tailAt
      for (const [t, token] of route.tokens.slice(tailAt).entries()) {
        if (w >= words.length || !('param' in token)) break
        if (token.rest) {
          params[token.param] = rest.slice(words[w].start).trimEnd()
          w = words.length
          break
        }
        if (tailAt + t < route.tokens.length - 1 && !fits(token.type!, words[w].value, route.caseSensitive)) continue
        params[token.param] = words[w++].value
      }
      complete = words.length >= tailAt && w === words.length
    }
    if (complete) return { route, params }
  }
  return undefined
}

/** A small seeded generator (mulberry32), so a failure reproduces from its seed. */
function random(seed: number) {
  let state = seed >>> 0
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]
  return { next, pick }
}

const WORDS = ['roll', 'Roll', 'ban', 'set', 'a', 'x', 'Émile', 'dé']
const PREFIXES: (false | string[] | undefined)[] = [undefined, undefined, undefined, false, ['?'], ['$', '$$'], ['bot '], [''], ['?', '']]
const APP_STARTS: MessageStarts[] = [
  { prefixes: ['!'] },
  { prefixes: ['!', '?'], mention: '111' },
  { prefixes: [''] },
  { prefixes: [''], mention: '111' },
  { prefixes: ['bot '] },
]

function randomPattern(r: ReturnType<typeof random>): string {
  const length = 1 + Math.floor(r.next() * 4)
  const words: string[] = []
  if (r.next() < 0.25) {
    for (let i = 0; i < length - 1; i++) words.push(r.next() < 0.6 ? r.pick(WORDS) : `{p${i}}`)
    const typed = 1 + Math.floor(r.next() * 2)
    for (let i = 0; i < typed; i++) words.push(`{t${i}:${r.pick(['int', 'on|off', 'roll|ban'])}?}`)
    words.push(r.pick(['{last?}', '{last...?}', '{last:int?}']))
    return words.join(' ')
  }
  for (let i = 0; i < length; i++) {
    const last = i === length - 1
    const kind = r.next()
    if (kind < 0.55) words.push(r.pick(WORDS))
    else if (last && kind < 0.7) words.push(`{p${i}...}`)
    else if (last && kind < 0.8) words.push(`{p${i}?}`)
    else if (last && kind < 0.87) words.push(`{p${i}...?}`)
    else words.push(`{p${i}}`)
  }
  return words.join(' ')
}

function randomMessage(r: ReturnType<typeof random>): string {
  const start = r.pick(['', '', '!', '?', '$', '$$', '<@111> ', '<@!111>', 'BOT ', 'bot ', '  ! '])
  const length = Math.floor(r.next() * 5)
  const words: string[] = []
  for (let i = 0; i < length; i++) {
    const kind = r.next()
    if (kind < 0.5) words.push(r.pick(WORDS).replace(/^./, c => (r.next() < 0.3 ? c.toUpperCase() : c)))
    else if (kind < 0.62) words.push('"two words"')
    else if (kind < 0.68) words.push('“smart quotes”')
    else if (kind < 0.72) words.push('"open')
    else words.push(r.pick(['20', 'value', 'ROLL', '<@222>', 'on', 'OFF', '-3']))
  }
  return start + words.join(r.pick([' ', ' ', '  ', '\n', '\t']))
}

function routesFor(r: ReturnType<typeof random>): MessageRoute[] | undefined {
  @Controller()
  class Generated {}
  const count = 1 + Math.floor(r.next() * 12)
  for (let i = 0; i < count; i++) {
    const method = `h${i}`
    ;(Generated.prototype as Record<string, unknown>)[method] = () => undefined
    const prefix = r.pick(PREFIXES)
    MessageHandler(randomPattern(r), {
      ...(prefix !== undefined && { prefix }),
      ...(r.next() < 0.25 && { caseSensitive: true }),
    })(Generated.prototype, method, Object.getOwnPropertyDescriptor(Generated.prototype, method) as never)
  }
  try {
    return buildMessageRoutes([Generated])
  } catch {
    // Two generated patterns that match the same messages: a route set dispatch would refuse
    return undefined
  }
}

// The seeds run, SEEDS_PER_TEST to a test, so no one test holds the whole run and a failure names its seeds
const SEEDS = 600
const SEEDS_PER_TEST = 10
// Messages compared in each test, at the least: fewer means the generator mostly makes route sets dispatch refuses
const MIN_COMPARED_PER_TEST = 250
const seedRanges = Array.from({ length: SEEDS / SEEDS_PER_TEST }, (_, i) => ({ first: i * SEEDS_PER_TEST + 1, last: (i + 1) * SEEDS_PER_TEST }))

describe('the compiled message index', () => {
  it.for(seedRanges)('picks the route and params a scan of the ranked routes picks, on random routes and messages, seeds $first to $last', ({ first, last }) => {
    let compared = 0
    for (let seed = first; seed <= last; seed++) {
      const r = random(seed)
      const routes = routesFor(r)
      if (!routes) continue
      for (let m = 0; m < 40; m++) {
        const content = randomMessage(r)
        const starts = r.pick(APP_STARTS)
        const expected = scanMatch(routes, content, starts)
        const actual = matchMessageRoute(routes, content, starts)
        expect([seed, content, starts, actual && [actual.route.pattern, actual.params]]).toEqual([
          seed,
          content,
          starts,
          expected && [expected.route.pattern, expected.params],
        ])
        compared++
      }
    }
    expect(compared).toBeGreaterThanOrEqual(MIN_COMPARED_PER_TEST)
  })
})
