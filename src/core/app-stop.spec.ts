import { vi } from 'vitest'
import { Client } from 'discord.js'

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

import { Controller, MeoCord, Service } from '@src/decorator/index.js'
import { MeoCordFactory } from '@src/core/meocord-factory.js'

const shutdowns: string[] = []

@Controller()
class Ping {}

@Service()
class Scheduler {
  onReady() {}
  onShutdown() {
    shutdowns.push('Scheduler')
  }
}

@MeoCord({ controllers: [Ping], services: [Scheduler], clientOptions: { intents: [] } })
class App {}

/** Logs in at once, or holds the login open until `release` is called, as a slow gateway does. */
function login(mode: 'at once' | 'held') {
  let release!: () => void
  const held = new Promise<string>(resolve => (release = () => resolve('token')))
  const clients: Client[] = []
  vi.spyOn(Client.prototype, 'login').mockImplementation(function (this: Client) {
    clients.push(this)
    return mode === 'held' ? held : Promise.resolve('token')
  })
  const destroy = vi.spyOn(Client.prototype, 'destroy').mockResolvedValue(undefined)
  return { clients, destroy, release: () => release() }
}

/** Runs the ready hooks as the client's ready event does. */
async function ready(client: Client) {
  for (const listener of client.listeners('clientReady')) await (listener as (c: unknown) => Promise<void>)(client)
}

describe('app.stop()', () => {
  const exitCode = process.exitCode
  let exit: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    shutdowns.length = 0
    exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
  })
  afterEach(() => {
    process.exitCode = exitCode
    vi.restoreAllMocks()
    process.removeAllListeners('SIGINT')
    process.removeAllListeners('SIGTERM')
  })

  it('runs the shutdown hooks and closes the client, without ending the process', async () => {
    const { clients, destroy } = login('at once')
    const app = MeoCordFactory.create(App)
    await app.start()
    await ready(clients[0])

    await app.stop()

    expect(shutdowns).toEqual(['Scheduler'])
    expect(destroy).toHaveBeenCalledTimes(1)
    expect(exit).not.toHaveBeenCalled()
  })

  // The process then exits as a signal's shutdown would, 1 for a client that failed to close
  it.each([
    [undefined, 1],
    [0, 1],
    [2, 2],
  ])('sets an exit code of %s to %s when the client fails to close', async (before, after) => {
    const { clients, destroy } = login('at once')
    destroy.mockRejectedValue(new Error('socket stuck'))
    const app = MeoCordFactory.create(App)
    await app.start()
    await ready(clients[0])
    process.exitCode = before

    await expect(app.stop()).resolves.toBeUndefined()

    expect(process.exitCode).toBe(after)
  })

  it('stops once, however many times it is called', async () => {
    const { clients, destroy } = login('at once')
    const app = MeoCordFactory.create(App)
    await app.start()
    await ready(clients[0])

    await Promise.all([app.stop(), app.stop()])
    await app.stop()

    expect(shutdowns).toEqual(['Scheduler'])
    expect(destroy).toHaveBeenCalledTimes(1)
  })

  it('ends a login under way, so start() rejects without exiting', async () => {
    const { release } = login('held')
    const app = MeoCordFactory.create(App)

    const started = app.start()
    await vi.waitFor(() => expect(Client.prototype.login).toHaveBeenCalled())
    await app.stop()
    release()

    await expect(started).rejects.toThrow('The bot was stopped before it came online.')
    expect(exit).not.toHaveBeenCalled()
  })

  it('refuses to start an app that was stopped, saying how to start again', async () => {
    login('at once')
    const app = MeoCordFactory.create(App)
    await app.start()
    await app.stop()

    await expect(app.start()).rejects.toThrow('This app was stopped; use MeoCordFactory.create to make a new one.')
  })

  it("ends a start whose providers are still being made, so it never logs in", async () => {
    const { destroy } = login('at once')
    let release!: () => void
    const held = new Promise<void>(resolve => (release = resolve))
    @MeoCord({
      controllers: [Ping],
      providers: [{ provide: 'db', useFactory: async () => (await held, { connected: true }) }],
      clientOptions: { intents: [] },
    })
    class SlowApp {}
    const app = MeoCordFactory.create(SlowApp)

    const started = app.start()
    await new Promise(resolve => setTimeout(resolve, 20))
    await app.stop()
    release()

    await expect(started).rejects.toThrow('The bot was stopped before it came online.')
    expect(Client.prototype.login).not.toHaveBeenCalled()
    expect(destroy).toHaveBeenCalledTimes(1)
  })

  // Between the providers being made and the login beginning, there is a turn of the event loop a stop can take
  it('ends a start that a stop overtakes after its providers are made, before it logs in', async () => {
    const { destroy } = login('at once')
    const app = MeoCordFactory.create(App)

    const started = app.start()
    await Promise.resolve()
    await Promise.resolve()
    await app.stop()

    await expect(started).rejects.toThrow('The bot was stopped before it came online.')
    expect(Client.prototype.login).not.toHaveBeenCalled()
    expect(destroy).toHaveBeenCalledTimes(1)
  })

  it('stops rotating the activities, so no timer of the app is left', async () => {
    const { clients } = login('at once')
    @MeoCord({ controllers: [Ping], activities: [{ name: 'with yarn' }], clientOptions: { intents: [] } })
    class Rotating {}
    const app = MeoCordFactory.create(Rotating)
    await app.start()
    vi.useFakeTimers()
    try {
      const setActivity = vi.fn()
      Object.defineProperty(clients[0], 'user', { value: { setActivity }, configurable: true })
      await ready(clients[0])
      vi.advanceTimersByTime(10_000)
      const rotated = setActivity.mock.calls.length

      await app.stop()
      vi.advanceTimersByTime(60_000)

      expect(rotated).toBeGreaterThan(0)
      expect(setActivity).toHaveBeenCalledTimes(rotated)
    } finally {
      vi.useRealTimers()
    }
  })
})
