import { stripVTControlCharacters } from 'node:util'
import { type Client } from 'discord.js'
import { vi } from 'vitest'
import type * as AppModule from '@src/core/meocord.app.js'
import type * as FactoryModule from '@src/core/meocord-factory.js'
import type * as DecoratorModule from '@src/decorator/index.js'
import { forgetProcessState } from '@src/core/process-state.js'

const { config } = vi.hoisted(() => ({ config: { discordToken: 'token' } as { discordToken: string; shutdownTimeout?: number } }))
vi.mock('@src/util/meocord-config-loader.util.js', () => ({ loadMeoCordConfig: () => config }))
vi.mock('@src/util/platform.util.js', () => ({ assertBuiltForThisPlatform: () => {} }))

/** The stop's bound on the factory under way, and on the late value's onShutdown from its arrival. */
const SHUTDOWN_TIMEOUT_MS = 300
/** When the stop begins, after start(). */
const STOP_AT_MS = 50
/** When the slow factory settles: after the stop gave up on it at 350 ms. */
const LATE_MS = 450
/** How long POOL's onShutdown takes where it outlasts the late value's arrival. */
const POOL_SHUTDOWN_MS = 200
/** When a factory settles inside the stop's wait. */
const IN_TIME_MS = 200

/** Fresh modules per test, as a new process has: the running apps and the shutdown are process-wide. */
async function load() {
  vi.resetModules()
  forgetProcessState()
  const discord = await import('discord.js')
  const app: typeof AppModule = await import('@src/core/meocord.app.js')
  const factory: typeof FactoryModule = await import('@src/core/meocord-factory.js')
  const decorators: typeof DecoratorModule = await import('@src/decorator/index.js')
  return { discord, ...app, ...factory, ...decorators }
}

/** What happened, in order, each as `<ms since start()> <event>`. */
let events: string[]
let t0: number
const note = (event: string) => void events.push(`${Date.now() - t0} ${event}`)

beforeEach(() => {
  events = []
  config.shutdownTimeout = SHUTDOWN_TIMEOUT_MS
  for (const method of ['warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      note(`${method} ${stripVTControlCharacters(args.map(String).join(' ')).replace(/^.*?UTC[+-]\d\d:\d\d (?:\[\w+\] )+/, '').split('\n')[0]}`)
    })
  }
  for (const method of ['log', 'debug', 'info'] as const) vi.spyOn(console, method).mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  forgetProcessState()
  process.exitCode = undefined
})

type Factory = (pool: unknown) => Promise<unknown>

/** The app the running test made, for a hook to reach. */
let current: { stop(): Promise<void> }

/**
 * Starts an app whose SLOW provider injects POOL, shut down by `poolShutdown`, and is made by `slow`, stops it at 50 ms,
 * and runs the clock out.
 */
async function stopWhileMaking(slow: Factory, poolShutdown: () => unknown = () => note('POOL closed')) {
  const loaded = await load()
  vi.spyOn(loaded.discord.Client.prototype, 'login').mockResolvedValue('token')
  vi.spyOn(loaded.discord.Client.prototype, 'destroy').mockImplementation(async function (this: Client) {
    note('client destroyed')
  })
  vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
  const providers = [
    { provide: 'POOL', useFactory: async () => ({ onShutdown: poolShutdown }) },
    { provide: 'SLOW', inject: ['POOL'], useFactory: slow },
  ]
  @loaded.MeoCord({ controllers: [], providers, clientOptions: { intents: [], allowedMentions: { parse: [] } } } as never)
  class App {}
  vi.useFakeTimers()
  t0 = Date.now()
  const app = (current = loaded.MeoCordFactory.create(App))
  const started = app.start().then(
    () => note('start resolved'),
    (error: Error) => note(`start rejected: ${error.message}`),
  )
  await vi.advanceTimersByTimeAsync(STOP_AT_MS)
  const stopped = app.stop().then(() => note('stop resolved'))
  await vi.advanceTimersByTimeAsync(2000)
  await stopped
  await started
  return events
}

/** A factory that settles after `ms` with a value whose onShutdown does `onShutdown`. */
const slowValue =
  (ms: number, onShutdown?: () => unknown): Factory =>
  async () => {
    await new Promise(resolve => setTimeout(resolve, ms))
    note('SLOW made')
    return onShutdown ? { onShutdown } : {}
  }

const GAVE_UP = `350 warn The startup still waits for the factory providing 'SLOW' after ${SHUTDOWN_TIMEOUT_MS} ms; shutting down without it.`
const STOPPED = 'start rejected: The bot was stopped before it came online.'

describe('a provider whose factory settles after the stop gave up on it', () => {
  it('has its value shut down as it arrives, after the stop resolved and before start() rejects', async () => {
    expect(await stopWhileMaking(slowValue(LATE_MS, () => note('SLOW closed')))).toEqual([
      GAVE_UP,
      '350 POOL closed',
      '350 client destroyed',
      '350 stop resolved',
      '450 SLOW made',
      '450 SLOW closed',
      `450 ${STOPPED}`,
    ])
  })

  it('shuts down a late value only once the stop is done with the hooks of what it injects', async () => {
    const events = await stopWhileMaking(slowValue(LATE_MS, () => note('SLOW closed')), async () => {
      note('POOL closing')
      await new Promise(resolve => setTimeout(resolve, POOL_SHUTDOWN_MS))
      note('POOL closed')
    })

    expect(events).toEqual([
      GAVE_UP,
      '350 POOL closing',
      '450 SLOW made',
      '550 POOL closed',
      '550 SLOW closed',
      '550 client destroyed',
      '550 stop resolved',
      `550 ${STOPPED}`,
    ])
  })

  it("logs a failure of the value's onShutdown as any hook's, and start() still rejects as stopped", async () => {
    const events = await stopWhileMaking(
      slowValue(LATE_MS, () => {
        throw new Error('pool gone')
      }),
    )

    expect(events.slice(4)).toEqual(['450 SLOW made', "450 error onShutdown failed in 'SLOW': Error: pool gone", `450 ${STOPPED}`])
  })

  it("stops waiting for the value's onShutdown shutdownTimeout after it arrived, with the warning, then rejects start()", async () => {
    const events = await stopWhileMaking(slowValue(LATE_MS, () => new Promise(() => undefined)))

    expect(events.slice(4)).toEqual([
      '450 SLOW made',
      `750 warn onShutdown hooks did not finish within ${SHUTDOWN_TIMEOUT_MS} ms; shutting down anyway.`,
      `750 ${STOPPED}`,
    ])
  })

  it("resolves at once when the late value's onShutdown calls stop()", async () => {
    const events = await stopWhileMaking(
      slowValue(LATE_MS, async () => {
        await current.stop()
        note('SLOW closed')
      }),
    )

    expect(events.slice(4)).toEqual(['450 SLOW made', '450 SLOW closed', `450 ${STOPPED}`])
  })

  it('runs no onShutdown of a late value whose onReady never ran, as the stop gives none to such a value', async () => {
    const events = await stopWhileMaking(async () => {
      await new Promise(resolve => setTimeout(resolve, LATE_MS))
      note('SLOW made')
      return { onReady: () => note('SLOW ready'), onShutdown: () => note('SLOW closed') }
    })

    expect(events.slice(4)).toEqual(['450 SLOW made', `450 ${STOPPED}`])
  })

  it('does nothing more for a value without an onShutdown', async () => {
    expect((await stopWhileMaking(slowValue(LATE_MS))).slice(4)).toEqual(['450 SLOW made', `450 ${STOPPED}`])
  })

  it('does nothing more for a factory that rejects', async () => {
    const events = await stopWhileMaking(async () => {
      await new Promise(resolve => setTimeout(resolve, LATE_MS))
      throw new Error('no pool')
    })

    expect(events.slice(4)).toEqual([
      "450 error The factory providing 'SLOW' failed: no pool. The bot cannot start without it.",
      "450 start rejected: The factory providing 'SLOW' failed: no pool",
    ])
  })
})

describe('a provider whose factory settles inside the stop\'s wait', () => {
  it('is shut down by the stop, before what it injects', async () => {
    expect(await stopWhileMaking(slowValue(IN_TIME_MS, () => note('SLOW closed')))).toEqual([
      '200 SLOW made',
      '200 SLOW closed',
      '200 POOL closed',
      '200 client destroyed',
      `200 ${STOPPED}`,
      '200 stop resolved',
    ])
  })
})
