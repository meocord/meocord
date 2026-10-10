/**
 * Measures what matching one message costs dispatch, for message patterns in the shapes bots use, at 10,
 * 100 and 1000 routes, and what a fixed reference workload costs on the same machine in the same run.
 * Prints one JSON line of nanoseconds. It runs under whichever runtime starts it;
 * `scripts/bench-messages.ts` runs it under Bun and Node and checks the budgets.
 */
import 'reflect-metadata'
import { MessageHandler } from '../../src/decorator/controller.decorator.js'
import { buildMessageRoutes, matchMessageCommand, matchMessageRoute, type MessageRoute } from '../../src/core/message-routes.js'

export const ROUTE_COUNTS = [10, 100, 1000] as const
export const CASES = ['chatter', 'unknown', 'matching'] as const
export type Case = (typeof CASES)[number]
export type Results = Record<(typeof ROUTE_COUNTS)[number], Record<Case, number>>
/** Nanoseconds per message for each route count and case, and per call of the reference workload. */
export interface Measured {
  referenceNs: number
  results: Results
}

/** A command word, sometimes a subcommand, then params, rests, optionals and flags. */
function patternFor(i: number): string {
  switch (i % 5) {
    case 0:
      return `cmd${i} {a}`
    case 1:
      return `cmd${i} {a} {b...}`
    case 2:
      return `cmd${i} sub {x} {y?}`
    case 3:
      return `grp${i % 37} cmd${i} {z} {rest...?}`
    default:
      return `cmd${i} {a} {b} {c} {--all} {--limit:int?}`
  }
}

function routesFor(count: number) {
  const controllers: (new () => unknown)[] = []
  for (let start = 0; start < count; start += 50) {
    const controller = class {}
    Object.defineProperty(controller, 'name', { value: `Commands${start}` })
    for (let i = start; i < Math.min(start + 50, count); i++) {
      const method = `command${i}`
      ;(controller.prototype as Record<string, unknown>)[method] = () => undefined
      MessageHandler(patternFor(i))(controller.prototype, method, Object.getOwnPropertyDescriptor(controller.prototype, method) as never)
    }
    controllers.push(controller)
  }
  return buildMessageRoutes(controllers)
}

const KNOWN_WORDS = new Map(['help', 'ping', 'roll', 'ban', 'kick', 'mute', 'play', 'skip'].map((word, i) => [word, i]))

/**
 * The reference workload: the kind of work matching does, splitting a message into words and looking each up,
 * written plainly and apart from the matcher, so a change to the matcher cannot move it. Budgets are multiples
 * of what it costs on the machine running the check.
 */
function reference(content: string): number {
  let found = 0
  let i = 0
  while (i < content.length) {
    while (i < content.length && content.charCodeAt(i) === 32) i++
    const start = i
    while (i < content.length && content.charCodeAt(i) !== 32) i++
    if (i > start) found += KNOWN_WORDS.get(content.slice(start, i).toLowerCase()) ?? i - start
  }
  return found
}

const STARTS = { prefixes: ['!'] }
/** As dispatch does: the route a message matches, or else the command it names, for its usage. */
function match(routes: readonly MessageRoute[], content: string) {
  return matchMessageRoute(routes, content, STARTS) ?? matchMessageCommand(routes, content, STARTS)
}

/** Written from every timed call's result and exported, so the runtime cannot drop the work as unused. */
export let sink = 0

/** Nanoseconds per call of the reference workload over `calls` calls. */
function timeReference(inputs: readonly string[], calls: number): number {
  let found = 0
  const started = process.hrtime.bigint()
  for (let i = 0; i < calls; i++) found += reference(inputs[i % inputs.length])
  const ns = Number(process.hrtime.bigint() - started) / calls
  sink += found
  return ns
}

/** Nanoseconds per message matched against `routes` over `calls` calls. */
function timeMatch(routes: readonly MessageRoute[], inputs: readonly string[], calls: number): number {
  let found = 0
  const started = process.hrtime.bigint()
  for (let i = 0; i < calls; i++) if (match(routes, inputs[i % inputs.length]) !== undefined) found++
  const ns = Number(process.hrtime.bigint() - started) / calls
  sink += found
  return ns
}

/**
 * Rounds run first to warm everything up, then rounds that are counted. Every round times every route count
 * and case once, in a rotating order, through the same code, so the engine's compiling and the machine's load
 * reach each figure alike. Each figure is the median of its counted rounds.
 */
const WARM_ROUNDS = 3
const ROUNDS = 15

const median = (samples: number[]) => samples.toSorted((a, b) => a - b)[samples.length >> 1]

export function run(): Measured {
  const chatter = ['hey what is up everyone lol', 'did anyone see the game last night?', 'ok', 'brb getting food 🍕']
  const unknown = ['!unknowncmd foo bar', '!help me please']
  const references = [...chatter, ...unknown, '!roll 20 for luck', '!ban someone for spam']
  // Each route count and case with its messages and calls per round; chatter, the cheapest, takes the most calls
  const cells = ROUTE_COUNTS.flatMap(count => {
    const routes = routesFor(count)
    const hit = Math.floor(count / 2) + 1
    const matching = [`!cmd${hit} alpha beta gamma`, `!CMD${hit} "two words" beta gamma`, '!cmd4 alpha --all beta --limit=5 gamma']
    for (const message of matching) {
      if (!matchMessageRoute(routes, message, STARTS)) throw new Error(`The benchmark's message ${message} reaches no route at ${count} routes.`)
    }
    const inputs = { chatter, unknown, matching }
    return CASES.map(c => ({ count, c, routes, inputs: inputs[c], calls: c === 'chatter' ? 80_000 : 40_000, samples: [] as number[] }))
  })
  const referenceSamples: number[] = []
  for (let round = 0; round < WARM_ROUNDS + ROUNDS; round++) {
    const counted = round >= WARM_ROUNDS
    const ns = timeReference(references, 80_000)
    if (counted) referenceSamples.push(ns)
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[(i + round) % cells.length]
      const ns = timeMatch(cell.routes, cell.inputs, cell.calls)
      if (counted) cell.samples.push(ns)
    }
  }
  const results = Object.fromEntries(ROUTE_COUNTS.map(count => [count, {}])) as Results
  for (const { count, c, samples } of cells) results[count][c] = median(samples)
  return { referenceNs: median(referenceSamples), results }
}

if (import.meta.main ?? process.argv[1]?.endsWith('message-bench.mjs')) console.log(JSON.stringify(run()))
