/**
 * Measures what theming adds to one handler call: an app theme, a `@UseTheme` scope, a handler reading the theme, and
 * server and user themes resolved, against a plain call in the same run. Prints one JSON line of nanoseconds;
 * `scripts/bench-theme.ts` runs it under Bun and Node and checks the budgets.
 */
import 'reflect-metadata'
import { Container } from 'inversify'
import { Controller } from '../../src/decorator/controller-class.decorator.js'
import { UseTheme } from '../../src/decorator/theme.decorator.js'
import { bindGlobalStages, prepareHandlerStages, runHandler } from '../../src/core/handler-pipeline.js'
import { claimAmbientAppTheme, releaseAmbientAppTheme } from '../../src/core/theme-runtime.js'
import { useTheme } from '../../src/core/theme-scope.js'

export const CASES = ['app', 'scoped', 'read', 'resolved'] as const
export type Case = (typeof CASES)[number]
export interface Measured {
  plainNs: number
  results: Record<Case, number>
}

/** Written by the handlers, so the runtime cannot drop their work as unused. */
export let sink = 0

@Controller()
class Plain {
  run() {
    sink++
  }
}

@Controller()
class AppThemed {
  run() {
    sink++
  }
}

@Controller()
@UseTheme({ colors: { primary: '#000001' } })
class Scoped {
  run() {
    sink++
  }
}

@Controller()
@UseTheme({ colors: { primary: '#000002' } })
class Reads {
  run() {
    const theme = useTheme()
    sink += String(theme.colors.primary).length + theme.emojis.loading.length
  }
}

interface Target {
  container: Container
  instance: Record<string, (...args: unknown[]) => unknown>
  args: unknown[]
}

function containerFor(cls: new () => unknown, stages: object = {}, args: unknown[] = [{}]): Target {
  const container = new Container()
  bindGlobalStages(container, { guards: [], interceptors: [], filters: [], ...stages })
  prepareHandlerStages(container, [cls])
  return { container, instance: new cls() as Record<string, (...args: unknown[]) => unknown>, args }
}

/** Each target's fastest of several rounds, in nanoseconds per call, the targets taking turns within each round. */
async function time<K extends string>(targets: Record<K, Target>, iterations: number): Promise<Record<K, number>> {
  const fastest = {} as Record<K, number>
  const entries = Object.entries(targets) as [K, Target][]
  for (let round = 0; round < 9; round++) {
    for (const [name, target] of entries) {
      // Only while its own calls are timed: while an app owns the theme read outside calls, every other app scopes
      if (name === 'app') claimAmbientAppTheme(target.container)
      const started = process.hrtime.bigint()
      for (let i = 0; i < iterations; i++) await runHandler(target.container, target.instance, 'run', target.args, { type: 'event' })
      const ns = Number(process.hrtime.bigint() - started) / iterations
      if (name === 'app') releaseAmbientAppTheme(target.container)
      // The first round warms every target up
      if (round > 0) fastest[name] = Math.min(fastest[name] ?? Infinity, ns)
    }
  }
  return fastest
}

@Controller()
class Resolved {
  run() {
    sink += String(useTheme().colors.primary).length
  }
}

export async function run(): Promise<Measured> {
  // `app` is timed as the bot's own app, whose theme is read outside a call, so its calls need no scope
  const { plain, ...results } = await time(
    {
      plain: containerFor(Plain),
      app: containerFor(AppThemed, { theme: { colors: { primary: '#000003' } } }),
      scoped: containerFor(Scoped),
      read: containerFor(Reads),
      // A server's and a user's themes, both found in their caches, as they are after the first call
      resolved: containerFor(
        Resolved,
        { themeFor: { resolvers: { guild: () => ({ colors: { primary: '#000004' } }), user: () => ({ colors: { info: '#000005' } }) } } },
        [{ guildId: '100000000000000001', user: { id: '200000000000000001' } }],
      ),
    },
    30_000,
  )
  return { plainNs: plain, results }
}

if (import.meta.main ?? process.argv[1]?.endsWith('theme-bench.mjs')) {
  run().then(measured => console.log(JSON.stringify(measured)))
}
