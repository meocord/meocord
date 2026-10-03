import 'reflect-metadata'
import { type Client } from 'discord.js'
import { MeoCordTestingModule } from './meocord-testing-module.js'
import { createMockClient } from './mock-interaction.js'
import { createToken } from '@src/common/token.js'
import { Service } from '@src/decorator/service.decorator.js'
import { Controller } from '@src/decorator/controller-class.decorator.js'
import { Observer } from '@src/decorator/observer.decorator.js'
import { type OnReady, type OnShutdown, type ReadyInfo } from '@src/interface/index.js'

/** What the hooks did, in order. */
let calls: string[] = []

beforeEach(() => {
  calls = []
})

/** A connection pool made by a factory, as a test would provide a real one. */
interface Pool extends OnShutdown {
  ended: boolean
}
const POOL = createToken<Pool>('POOL')

function createPool(): Pool {
  const pool: Pool = {
    ended: false,
    onShutdown() {
      pool.ended = true
      calls.push('shutdown POOL')
    },
  }
  return pool
}

@Service()
class Database implements OnReady, OnShutdown {
  onReady() {
    calls.push('ready Database')
  }

  onShutdown() {
    calls.push('shutdown Database')
  }
}

@Service()
class Scheduler implements OnReady, OnShutdown {
  constructor(readonly database: Database) {}

  onReady(client: Client<true>, info: ReadyInfo) {
    calls.push(`ready Scheduler primary=${info.primary} client=${client === undefined ? 'none' : 'given'}`)
  }

  onShutdown() {
    calls.push('shutdown Scheduler')
  }
}

@Controller()
class ReminderController implements OnReady, OnShutdown {
  constructor(readonly scheduler: Scheduler) {}

  onReady() {
    calls.push('ready ReminderController')
  }

  onShutdown() {
    calls.push('shutdown ReminderController')
  }
}

@Observer()
class Metrics implements OnReady, OnShutdown {
  onSettled() {}

  onReady() {
    calls.push('ready Metrics')
  }

  onShutdown() {
    calls.push('shutdown Metrics')
  }
}

const compile = () =>
  MeoCordTestingModule.create({
    controllers: [ReminderController],
    providers: [
      { provide: POOL, useFactory: async () => createPool() },
    ],
    observers: [Metrics],
  }).compile()

describe('TestingModule lifecycle', () => {
  it('runs no onReady hook from init() alone', async () => {
    await compile().init()

    expect(calls).toEqual([])
  })

  it('runs every onReady hook once with init({ ready: true }), each after what it injects, the observers last', async () => {
    const module = compile()

    await module.init({ ready: true })
    await module.init({ ready: true })

    expect(calls).toEqual(['ready Database', 'ready Scheduler primary=true client=given', 'ready ReminderController', 'ready Metrics'])
  })

  it('hands onReady the client and primary it is given', async () => {
    const client = createMockClient()
    let received: [Client<true>, ReadyInfo] | undefined
    const scheduler = vi.spyOn(Scheduler.prototype, 'onReady').mockImplementation((...args) => {
      received = args
    })

    await compile().init({ ready: { client, primary: false } })

    expect(received).toEqual([client, { primary: false }])
    scheduler.mockRestore()
  })

  it('runs every onShutdown hook once on close(), in reverse order, a factory value included', async () => {
    const module = compile()
    await module.init({ ready: true })
    calls = []

    await module.close()
    await module.close()

    expect(calls).toEqual(['shutdown Metrics', 'shutdown ReminderController', 'shutdown Scheduler', 'shutdown Database', 'shutdown POOL'])
    expect(module.get(POOL).ended).toBe(true)
  })

  // init() makes the factory's pool, so close() must end it; nothing else was constructed to shut down
  it('shuts down what plain init() constructed, and constructs nothing to shut it down', async () => {
    const constructed = vi.fn()
    @Service()
    class Unused implements OnShutdown {
      constructor() {
        constructed()
      }

      onShutdown() {
        calls.push('shutdown Unused')
      }
    }
    const module = MeoCordTestingModule.create({
      controllers: [ReminderController],
      providers: [{ provide: POOL, useFactory: async () => createPool() }, { provide: Unused, useClass: Unused }],
    }).compile()
    await module.init()

    await module.close()

    expect(calls).toEqual(['shutdown POOL'])
    expect(module.get(POOL).ended).toBe(true)
    expect(constructed).not.toHaveBeenCalled()
  })

  it('shuts down, in reverse dependency order, what a test resolved with get()', async () => {
    const module = compile()
    module.get(Scheduler)

    await module.close()

    expect(calls).toEqual(['shutdown Scheduler', 'shutdown Database'])
  })

  it('shuts down nothing when nothing was constructed', async () => {
    await compile().close()

    expect(calls).toEqual([])
  })

  it('runs every onReady hook when one fails, then rejects with its error', async () => {
    const failure = new Error('database down')
    const database = vi.spyOn(Database.prototype, 'onReady').mockImplementation(() => {
      throw failure
    })

    await expect(compile().init({ ready: true })).rejects.toBe(failure)

    expect(calls).toEqual(['ready Scheduler primary=true client=given', 'ready ReminderController', 'ready Metrics'])
    database.mockRestore()
  })

  it('rejects with an AggregateError naming each hook when several fail, and still shuts down', async () => {
    const database = vi.spyOn(Database.prototype, 'onShutdown').mockRejectedValue(new Error('database'))
    const scheduler = vi.spyOn(Scheduler.prototype, 'onShutdown').mockRejectedValue(new Error('scheduler'))
    const module = compile()
    await module.init({ ready: true })
    calls = []

    const error = await module.close().catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(AggregateError)
    expect((error as AggregateError).message).toBe('2 onShutdown hooks threw: Scheduler, Database.')
    expect((error as AggregateError).errors.map(cause => (cause as Error).message)).toEqual(['scheduler', 'database'])
    expect(calls).toEqual(['shutdown Metrics', 'shutdown ReminderController', 'shutdown POOL'])
    database.mockRestore()
    scheduler.mockRestore()
  })
})
