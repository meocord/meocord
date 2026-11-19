import { stripVTControlCharacters } from 'node:util'
import { vi } from 'vitest'
import { Inject, Service } from '@src/decorator/index.js'
import { MeoCordTestingModule } from '@src/testing/index.js'

/** close()'s bound on the factory under way, and on the late value's onShutdown from its arrival. */
const SHUTDOWN_TIMEOUT_MS = 300
/** When close() is called, after init(). */
const CLOSE_AT_MS = 50
/** When the slow factory settles: after close() stopped waiting for it at 350 ms. */
const LATE_MS = 450
/** How long POOL's onShutdown takes where it outlasts the late value's arrival. */
const POOL_SHUTDOWN_MS = 200
/** When a factory settles inside close()'s wait. */
const IN_TIME_MS = 200

/** What happened, in order, each as `<ms since init()> <event>`. */
let events: string[]
let t0: number
const note = (event: string) => void events.push(`${Date.now() - t0} ${event}`)

beforeEach(() => {
  events = []
  for (const method of ['warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      note(`${method} ${stripVTControlCharacters(args.map(String).join(' ')).replace(/^.*?UTC[+-]\d\d:\d\d (?:\[\w+\] )+/, '').split('\n')[0]}`)
    })
  }
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** A factory that settles after `ms`, `never` for one that does not, with a value whose onShutdown does `onShutdown`. */
const slowValue = (ms: number | 'never', onShutdown?: () => unknown) => async () => {
  await new Promise(resolve => (ms === 'never' ? undefined : setTimeout(resolve, ms)))
  note('SLOW made')
  return onShutdown ? { onShutdown } : {}
}

@Service()
class Listed {
  constructor(@Inject('SLOW') readonly slow: object) {
    note('Listed made')
  }
  onShutdown() {
    note('Listed closed')
  }
}

@Service()
class Quiet {
  constructor(@Inject('SLOW') readonly slow: object) {
    note('Quiet made')
  }
}

/** A module whose SLOW provider injects POOL, shut down by `poolShutdown`, and is made by `slow`, then AFTER, Listed and Quiet. */
function moduleWith(slow: () => Promise<unknown>, poolShutdown: () => unknown = () => note('POOL closed')) {
  return MeoCordTestingModule.create({
    providers: [
      { provide: 'POOL', useFactory: async () => ({ onReady: () => note('POOL ready'), onShutdown: poolShutdown }) },
      { provide: 'SLOW', inject: ['POOL'], useFactory: slow },
      { provide: 'AFTER', inject: ['SLOW'], useFactory: async () => (note('AFTER made'), { onShutdown: () => note('AFTER closed') }) },
      { provide: Listed, useClass: Listed },
      { provide: Quiet, useClass: Quiet },
    ],
    services: [Listed, Quiet],
    shutdownTimeout: SHUTDOWN_TIMEOUT_MS,
  } as never).compile()
}

/** The module the running test made, for a hook to reach. */
let current: ReturnType<typeof moduleWith>

/** Calls init(), with `ready` if given, then close() at 50 ms, and runs the clock out. */
async function closeWhileMaking(slow: () => Promise<unknown>, ready = false, poolShutdown?: () => unknown) {
  vi.useFakeTimers()
  t0 = Date.now()
  const module = (current = moduleWith(slow, poolShutdown))
  const inited = module.init({ ready }).then(
    () => note('init resolved'),
    (error: Error) => note(`init rejected: ${error.message}`),
  )
  await vi.advanceTimersByTimeAsync(CLOSE_AT_MS)
  const closed = module.close().then(
    () => note('close resolved'),
    (error: Error) => note(`close rejected: ${error.message}`),
  )
  await vi.advanceTimersByTimeAsync(2000)
  await closed
  return { module, inited }
}

const GAVE_UP = `350 warn init() still waits for the factory providing 'SLOW' after ${SHUTDOWN_TIMEOUT_MS} ms; close() shuts down without it.`

describe('close() during init()', () => {
  it('stops waiting for a factory that never settles at shutdownTimeout, naming it, and shuts down the rest', async () => {
    await closeWhileMaking(slowValue('never', () => note('SLOW closed')))

    expect(events).toEqual([GAVE_UP, '350 POOL closed', '350 close resolved'])
  })

  it('shuts down the value of a factory that settles after it stopped waiting, as it arrives, then init() resolves', async () => {
    const { inited } = await closeWhileMaking(slowValue(LATE_MS, () => note('SLOW closed')))
    await inited

    expect(events).toEqual([GAVE_UP, '350 POOL closed', '350 close resolved', '450 SLOW made', '450 SLOW closed', '450 init resolved'])
  })

  it('shuts down a late value that has an onReady hook, as close() shuts down any value it made', async () => {
    const { inited } = await closeWhileMaking(async () => {
      await new Promise(resolve => setTimeout(resolve, LATE_MS))
      note('SLOW made')
      return { onReady: () => note('SLOW ready'), onShutdown: () => note('SLOW closed') }
    })
    await inited

    expect(events.slice(3)).toEqual(['450 SLOW made', '450 SLOW closed', '450 init resolved'])
  })

  it('shuts down a late value only once close() is done with the hooks of what it injects', async () => {
    const { inited } = await closeWhileMaking(slowValue(LATE_MS, () => note('SLOW closed')), false, async () => {
      note('POOL closing')
      await new Promise(resolve => setTimeout(resolve, POOL_SHUTDOWN_MS))
      note('POOL closed')
    })
    await inited

    expect(events).toEqual([
      GAVE_UP,
      '350 POOL closing',
      '450 SLOW made',
      '550 POOL closed',
      '550 close resolved',
      '550 SLOW closed',
      '550 init resolved',
    ])
  })

  it("logs a failure of the late value's onShutdown, and init() still resolves", async () => {
    const { inited } = await closeWhileMaking(
      slowValue(LATE_MS, () => {
        throw new Error('pool gone')
      }),
    )
    await inited

    expect(events.slice(3)).toEqual(['450 SLOW made', "450 error onShutdown failed in 'SLOW': Error: pool gone", '450 init resolved'])
  })

  it("stops waiting for the late value's onShutdown shutdownTimeout after it arrived, with the warning", async () => {
    const { inited } = await closeWhileMaking(slowValue(LATE_MS, () => new Promise(() => undefined)))
    await inited

    expect(events.slice(3)).toEqual([
      '450 SLOW made',
      `750 warn onShutdown hooks did not finish within ${SHUTDOWN_TIMEOUT_MS} ms; shutting down anyway.`,
      '750 init resolved',
    ])
  })

  it("resolves at once when the late value's onShutdown calls close()", async () => {
    const { inited } = await closeWhileMaking(
      slowValue(LATE_MS, async () => {
        await current.close()
        note('SLOW closed')
      }),
    )
    await inited

    expect(events.slice(3)).toEqual(['450 SLOW made', '450 SLOW closed', '450 init resolved'])
  })

  it('closes a factory that settles inside the wait in dependency order, and makes nothing after it', async () => {
    const { inited } = await closeWhileMaking(slowValue(IN_TIME_MS, () => note('SLOW closed')))
    await inited

    expect(events).toEqual(['200 SLOW made', '200 init resolved', '200 SLOW closed', '200 POOL closed', '200 close resolved'])
  })

  it('runs no onReady hook of init({ ready: true }) once close() has begun', async () => {
    const { inited } = await closeWhileMaking(slowValue(IN_TIME_MS, () => note('SLOW closed')), true)
    await inited

    expect(events).toEqual(['200 SLOW made', '200 init resolved', '200 SLOW closed', '200 POOL closed', '200 close resolved'])
  })

  it('warns once, naming it, when a get() after it makes a listed service init() did not make', async () => {
    const { module, inited } = await closeWhileMaking(slowValue(IN_TIME_MS, () => note('SLOW closed')))
    await inited

    expect(module.get(Listed)).toBeInstanceOf(Listed)
    expect(module.get(Listed)).toBeInstanceOf(Listed)
    expect(events.slice(5)).toEqual([
      '2050 Listed made',
      '2050 warn get(Listed) after close() makes Listed now; the testing module is closed, so nothing shuts it down. Close it after the last call, in afterEach.',
    ])
  })

  it('makes a listed service without an onShutdown after it without a warning', async () => {
    const { module, inited } = await closeWhileMaking(slowValue(IN_TIME_MS, () => note('SLOW closed')))
    await inited

    expect(module.get(Quiet)).toBeInstanceOf(Quiet)
    expect(events.slice(5)).toEqual(['2050 Quiet made'])
  })

  it('names the factory init() did not reach when get() reads its value', async () => {
    const { module, inited } = await closeWhileMaking(slowValue(IN_TIME_MS, () => note('SLOW closed')))
    await inited

    expect(() => module.get('AFTER')).toThrow("close() ended init() before it made 'AFTER'; its factory doesn't run after close().")
  })

  it('reads a value it shut down without a warning', async () => {
    const { module, inited } = await closeWhileMaking(slowValue(IN_TIME_MS, () => note('SLOW closed')))
    await inited

    expect(module.get<object>('POOL')).toEqual({ onReady: expect.any(Function), onShutdown: expect.any(Function) })
    expect(events.slice(5)).toEqual([])
  })
})

