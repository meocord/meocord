import { vi } from 'vitest'
import { type Client } from 'discord.js'
import type * as AppModule from '@src/core/meocord.app.js'
import type * as FactoryModule from '@src/core/meocord-factory.js'
import type * as DecoratorModule from '@src/decorator/index.js'
import { forgetShutdownState } from '@src/core/meocord.app.js'

vi.mock('@src/common/index.js', async importOriginal => ({
  ...(await importOriginal<object>()),
  Logger: class {
    log = vi.fn()
    debug = vi.fn()
    info = vi.fn()
    verbose = vi.fn()
    warn = vi.fn()
    error = vi.fn()
  },
}))
vi.mock('@src/util/meocord-config-loader.util.js', () => ({ loadMeoCordConfig: () => ({ discordToken: 'token' }) }))
vi.mock('@src/util/platform.util.js', () => ({ assertBuiltForThisPlatform: () => {} }))

/** A copy of the modules of its own, as the other build is: a process can load both, as an app and a package it uses may. */
async function loadBuild() {
  vi.resetModules()
  const app: typeof AppModule = await import('@src/core/meocord.app.js')
  const factory: typeof FactoryModule = await import('@src/core/meocord-factory.js')
  const decorators: typeof DecoratorModule = await import('@src/decorator/index.js')
  return { ...app, ...factory, ...decorators }
}

async function startApp(build: Awaited<ReturnType<typeof loadBuild>>) {
  @build.MeoCord({ controllers: [], clientOptions: { intents: [] } })
  class App {}
  const app = build.MeoCordFactory.create(App)
  await app.start()
  return app
}

describe('a process that loads both builds', () => {
  const exitCode = process.exitCode
  let exit: ReturnType<typeof vi.spyOn>
  let destroyed: Client[]
  let signalListeners: NodeJS.SignalsListener[]

  beforeEach(async () => {
    forgetShutdownState()
    exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    const discord = await import('discord.js')
    vi.spyOn(discord.Client.prototype, 'login').mockResolvedValue('token')
    destroyed = []
    vi.spyOn(discord.Client.prototype, 'destroy').mockImplementation(function (this: Client) {
      destroyed.push(this)
      return Promise.resolve()
    })
    signalListeners = process.listeners('SIGINT') as NodeJS.SignalsListener[]
  })
  afterEach(() => {
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      for (const listener of process.listeners(signal)) {
        if (!signalListeners.includes(listener as NodeJS.SignalsListener)) process.off(signal, listener)
      }
    }
    process.exitCode = exitCode
    vi.restoreAllMocks()
  })

  it('listens for each signal once, however many apps either build starts', async () => {
    const first = await loadBuild()
    const second = await loadBuild()
    expect(second.MeoCordFactory).not.toBe(first.MeoCordFactory)

    await startApp(first)
    await startApp(second)
    await startApp(second)

    expect(process.listeners('SIGINT').length - signalListeners.length).toBe(1)
  })

  it('shuts down the apps of both builds on one Ctrl+C, and exits once', async () => {
    const first = await loadBuild()
    const second = await loadBuild()
    await startApp(first)
    await startApp(second)

    process.emit('SIGINT')
    await vi.waitFor(() => expect(exit).toHaveBeenCalled())

    expect(destroyed).toHaveLength(2)
    expect(exit.mock.calls).toEqual([[0]])
  })
})
