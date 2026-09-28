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
