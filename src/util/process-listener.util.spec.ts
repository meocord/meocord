import { vi } from 'vitest'
import { appListenerCount, meocordListener, meocordListenerCount } from '@src/util/process-listener.util.js'

describe('process listener counts', () => {
  const saved = process.listeners('unhandledRejection')

  beforeEach(() => {
    process.removeAllListeners('unhandledRejection')
  })

  afterEach(() => {
    process.removeAllListeners('unhandledRejection')
    for (const listener of saved) process.on('unhandledRejection', listener)
  })

  it("counts the application's listeners apart from MeoCord's", () => {
    process.on('unhandledRejection', meocordListener(() => {}))
    process.on('unhandledRejection', () => {})

    expect(appListenerCount('unhandledRejection')).toBe(1)
    expect(meocordListenerCount('unhandledRejection')).toBe(1)
  })

  // As the ES module and CommonJS builds, or two installed versions, are in one process
  it("tells another copy's listeners for MeoCord's", async () => {
    vi.resetModules()
    const other = await import('@src/util/process-listener.util.js')
    process.on('unhandledRejection', other.meocordListener(() => {}))

    expect(appListenerCount('unhandledRejection')).toBe(0)
    expect(meocordListenerCount('unhandledRejection')).toBe(1)
  })
})
