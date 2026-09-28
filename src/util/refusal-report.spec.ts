import { markExplained } from '@src/common/explained-error.js'
import { refuse, reportRefusals } from '@src/util/refusal.util.js'

describe('reportRefusals', () => {
  const monitors = () => process.listeners('uncaughtExceptionMonitor')
  let before: ReturnType<typeof monitors>

  beforeEach(() => {
    before = monitors()
  })

  afterEach(() => {
    for (const listener of monitors()) if (!before.includes(listener)) process.off('uncaughtExceptionMonitor', listener)
  })

  function watch() {
    const log = vi.fn()
    const exit = vi.fn()
    reportRefusals(log, exit)
    const uncaught = (error: unknown) => process.emit('uncaughtExceptionMonitor', error as Error, 'unhandledRejection')
    return { log, exit, uncaught }
  }

  it('reports an uncaught refusal as its message, and exits 1', () => {
    const { log, exit, uncaught } = watch()

    const error = refuse(new Error('SampleController.handle: Invalid pattern "a-{id}"'))
    uncaught(error)

    // Thrown from this spec, which the report names as where in the source it came from
    expect(log).toHaveBeenCalledWith('SampleController.handle: Invalid pattern "a-{id}"\n    in src/util/refusal-report.spec.ts')
    expect(exit).toHaveBeenCalledWith(1)
  })

  it('exits 1 without reporting a refusal MeoCord has already explained', () => {
    const { log, exit, uncaught } = watch()
    const error = refuse(new Error('Two handlers take one command'))
    markExplained(error)

    uncaught(error)

    expect(log).not.toHaveBeenCalled()
    expect(exit).toHaveBeenCalledWith(1)
  })

  it('leaves any other error to the runtime', () => {
    const { log, exit, uncaught } = watch()

    uncaught(new Error('a bug in the bot'))

    expect(log).not.toHaveBeenCalled()
    expect(exit).not.toHaveBeenCalled()
  })
})

describe('refuse', () => {
  const BUNDLE_ENTRY = Symbol.for('meocord.bundleEntry')
  const listeners = () => process.listenerCount('uncaughtExceptionMonitor')
  let before: ReturnType<typeof process.listeners>

  beforeEach(() => {
    before = process.listeners('uncaughtExceptionMonitor')
    vi.resetModules()
  })

  afterEach(() => {
    Reflect.deleteProperty(globalThis, BUNDLE_ENTRY)
    for (const listener of process.listeners('uncaughtExceptionMonitor'))
      if (!before.includes(listener)) process.off('uncaughtExceptionMonitor', listener)
  })

  it('starts reporting refusals in a built application, once', async () => {
    Reflect.set(globalThis, BUNDLE_ENTRY, '/bots/shop/dist/main.js')
    const { refuse: fresh } = await import('@src/util/refusal.util.js')
    const count = listeners()

    fresh(new Error('one'))
    fresh(new Error('two'))

    expect(listeners()).toBe(count + 1)
  })

  it('leaves a test or a script to handle the error as it is', async () => {
    const { refuse: fresh } = await import('@src/util/refusal.util.js')
    const count = listeners()

    fresh(new Error('one'))

    expect(listeners()).toBe(count)
  })
})

describe('reportRefusals under Bun, which reports an unhandled rejection without the monitor', () => {
  let saved: { monitors: NodeJS.UncaughtExceptionListener[]; rejections: NodeJS.UnhandledRejectionListener[] }

  beforeEach(() => {
    // The test runner's own rejection listeners are set aside, so each case controls who listens
    saved = {
      monitors: process.listeners('uncaughtExceptionMonitor'),
      rejections: process.listeners('unhandledRejection'),
    }
    process.removeAllListeners('unhandledRejection')
  })

  afterEach(() => {
    for (const listener of process.listeners('uncaughtExceptionMonitor'))
      if (!saved.monitors.includes(listener)) process.off('uncaughtExceptionMonitor', listener)
    process.removeAllListeners('unhandledRejection')
    for (const listener of saved.rejections) process.on('unhandledRejection', listener)
  })

  function watch(bun: boolean) {
    const log = vi.fn()
    const exit = vi.fn()
    const reject = vi.fn()
    reportRefusals(log, exit, { bun, reject })
    const rejected = (reason: unknown) => process.emit('unhandledRejection', reason, Promise.resolve())
    return { log, exit, reject, rejected }
  }

  it('reports a rejected refusal as its message, and exits 1', () => {
    const { log, exit, reject, rejected } = watch(true)

    rejected(refuse(new Error('SampleMessageController.baka: {rest...} takes the rest of the message')))

    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^SampleMessageController\.baka: \{rest\.\.\.\}/))
    expect(exit).toHaveBeenCalledWith(1)
    expect(reject).not.toHaveBeenCalled()
  })

  it('rejects any other reason again with its listener gone, for Bun to report as it would have', () => {
    const { log, exit, reject, rejected } = watch(true)
    const reason = new Error('a bug in bootstrap')

    rejected(reason)

    expect(reject).toHaveBeenCalledWith(reason)
    expect(process.listenerCount('unhandledRejection')).toBe(0)
    expect(log).not.toHaveBeenCalled()
    expect(exit).not.toHaveBeenCalled()
  })

  it("leaves every rejection to the application's own listener, a refusal too, as Node does", () => {
    const own = vi.fn()
    process.on('unhandledRejection', own)
    const { log, exit, reject, rejected } = watch(true)

    rejected('a string reason')
    rejected(refuse(new Error('Shop.buy: refused')))

    expect(own).toHaveBeenCalledTimes(2)
    expect(reject).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
    expect(exit).not.toHaveBeenCalled()
    expect(process.listeners('unhandledRejection')).toHaveLength(2)
  })

  it('reports a refusal again once the application stops listening', () => {
    const own = vi.fn()
    process.on('unhandledRejection', own)
    const { log, exit, rejected } = watch(true)
    process.off('unhandledRejection', own)

    rejected(refuse(new Error('Shop.buy: refused')))

    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^Shop\.buy: refused/))
    expect(exit).toHaveBeenCalledWith(1)
  })

  it('adds no rejection listener under Node, whose monitor sees rejections too', () => {
    watch(false)

    expect(process.listenerCount('unhandledRejection')).toBe(0)
  })
})
