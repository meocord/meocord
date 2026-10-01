import 'reflect-metadata'
import { vi } from 'vitest'
import { ChatInputCommandInteraction, Client } from 'discord.js'
import { createToken } from '@src/common/token.js'
import { Logger } from '@src/common/logger.js'
import { CooldownStore, type CooldownLimit, type CooldownVerdict } from '@src/common/cooldown-store.js'
import { respond } from '@src/common/response/response-state.js'
import { Command, Controller, Cooldown, Inject, MeoCord, Observer, Service } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { type DispatchResult } from '@src/interface/index.js'
import { MeoCordTestingModule } from './meocord-testing-module.js'
import { createMockClient, createMockInteraction } from './mock-interaction.js'
import { getResponse } from './response.js'

interface Database {
  count(): Promise<number>
}
const DATABASE = createToken<Database>('Database')
const connect = vi.fn(async (): Promise<Database> => ({ count: async () => 42 }))

const made: string[] = []
const hooks: string[] = []

@Service()
class Notes {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  count(): Promise<number> {
    return this.db.count()
  }
}

// Listed in `services`: the bot makes it before logging in, whether anything injects it or not
@Service()
class Warmup {
  constructor() {
    made.push('Warmup')
  }
  onReady() {
    hooks.push('Warmup ready')
  }
  onShutdown() {
    hooks.push('Warmup shutdown')
  }
}

const consumed: string[] = []

@Service()
class RecordingStore extends CooldownStore {
  onReady() {
    hooks.push('store ready')
  }

  onShutdown() {
    hooks.push('store shutdown')
  }

  async consume(key: string, _limit: CooldownLimit): Promise<CooldownVerdict> {
    consumed.push(key)
    return { allowed: true, retryAfterMs: 0 }
  }
}

@Controller()
class NotesController {
  constructor(private readonly notes: Notes) {}

  @Command('notes', CommandType.SLASH)
  @Cooldown({ seconds: 5 })
  async show(interaction: ChatInputCommandInteraction) {
    await respond(interaction).send(`${await this.notes.count()} notes`)
  }
}

@MeoCord({
  controllers: [NotesController],
  services: [Warmup],
  providers: [{ provide: DATABASE, useFactory: connect }],
  cooldownStore: RecordingStore,
  clientOptions: { intents: [] },
})
class NotesApp {}

const slash = (commandName: string) => createMockInteraction(ChatInputCommandInteraction, { commandName })

beforeEach(() => {
  connect.mockClear()
  made.length = 0
  hooks.length = 0
  consumed.length = 0
})

describe('MeoCordTestingModule.fromApp', () => {
  it('builds the app as the bot does: its controllers, services, providers and cooldown store, none listed again', async () => {
    const module = await MeoCordTestingModule.fromApp(NotesApp).compile().init({ ready: true })
    const interaction = slash('notes')

    await module.dispatch(interaction)
    await module.close()

    expect(getResponse(interaction).calls[0].payload).toMatchObject({ content: '42 notes' })
    expect(connect).toHaveBeenCalledOnce()
    expect(consumed).toHaveLength(1)
    expect(made).toEqual(['Warmup'])
    // The store's hooks run as the bot runs them: ready first, shut down last
    expect(hooks).toEqual(['store ready', 'Warmup ready', 'Warmup shutdown', 'store shutdown'])
  })

  it('never runs a factory the test replaces', async () => {
    const module = await MeoCordTestingModule.fromApp(NotesApp, {
      providers: [{ provide: DATABASE, useValue: { count: async () => 3 } }],
    })
      .compile()
      .init()
    const interaction = slash('notes')

    await module.dispatch(interaction)

    expect(getResponse(interaction).calls[0].payload).toMatchObject({ content: '3 notes' })
    expect(connect).not.toHaveBeenCalled()
  })

  it('runs no factory and makes no service before init(), as the bot makes them only when it starts', () => {
    MeoCordTestingModule.fromApp(NotesApp).compile()

    expect(connect).not.toHaveBeenCalled()
    expect(made).toEqual([])
  })

  it('keeps the override methods, and a provided CooldownStore takes the place of the app’s', async () => {
    const peeked: string[] = []
    class OtherStore extends CooldownStore {
      async consume(key: string): Promise<CooldownVerdict> {
        peeked.push(key)
        return { allowed: true, retryAfterMs: 0 }
      }

      onReady() {
        hooks.push('provided store ready')
      }

      onShutdown() {
        hooks.push('provided store shutdown')
      }
    }
    const module = await MeoCordTestingModule.fromApp(NotesApp, { providers: [{ provide: CooldownStore, useValue: new OtherStore() }] })
      .overrideProvider(DATABASE)
      .useValue({ count: async () => 7 })
      .compile()
      .init({ ready: true })
    const interaction = slash('notes')

    await module.dispatch(interaction)
    await module.close()

    expect(getResponse(interaction).calls[0].payload).toMatchObject({ content: '7 notes' })
    expect(peeked).toHaveLength(1)
    expect(consumed).toEqual([])
    // The provided store takes the store's place in the hooks too, and the app's, never bound, has none
    expect(hooks).toEqual(['provided store ready', 'Warmup ready', 'Warmup shutdown', 'provided store shutdown'])
  })

  it('builds none of the app’s store, nor needs what it injects, when the test provides the CooldownStore', async () => {
    const REDIS = createToken<object>('Redis')
    @Service()
    class RedisStore extends CooldownStore {
      constructor(@Inject(REDIS) readonly redis: object) {
        super()
      }

      async consume(): Promise<CooldownVerdict> {
        throw new Error('the app’s store was asked')
      }
    }
    @MeoCord({ controllers: [NotesController], providers: [{ provide: DATABASE, useFactory: connect }], cooldownStore: RedisStore, clientOptions: { intents: [] } })
    class RedisApp {}
    class TestStore extends CooldownStore {
      async consume(key: string): Promise<CooldownVerdict> {
        consumed.push(key)
        return { allowed: true, retryAfterMs: 0 }
      }
    }

    const module = MeoCordTestingModule.fromApp(RedisApp, { providers: [{ provide: CooldownStore, useValue: new TestStore() }] }).compile()

    await expect(module.dispatch(slash('notes'))).resolves.toMatchObject({ ran: true })
    expect(consumed).toHaveLength(1)
  })

  it('adds a test’s own controllers and observers beside the app’s', async () => {
    const told: string[] = []
    @Observer()
    class Audit {
      onSettled(_context: unknown, { outcome }: DispatchResult) {
        told.push(outcome)
      }
    }
    @Controller()
    class PingController {
      @Command('ping', CommandType.SLASH)
      async ping(interaction: ChatInputCommandInteraction) {
        await respond(interaction).send('pong')
      }
    }
    const module = await MeoCordTestingModule.fromApp(NotesApp, {
      controllers: [PingController],
      observers: [Audit],
      providers: [{ provide: DATABASE, useValue: { count: async () => 0 } }],
    })
      .compile()
      .init()

    await module.dispatch(slash('ping'))
    await module.dispatch(slash('notes'))

    expect(told).toEqual(['ran', 'ran'])
  })

  it('refuses a class that is not a @MeoCord app', () => {
    class NotAnApp {}

    expect(() => MeoCordTestingModule.fromApp(NotAnApp)).toThrow('NotAnApp is not a @MeoCord app: fromApp takes the class @MeoCord decorates.')
  })
})

describe('MeoCordTestingModule.create({ app })', () => {
  const create = (providers: { provide: unknown; useValue: unknown }[] = []) =>
    MeoCordTestingModule.create({
      app: NotesApp,
      controllers: [NotesController],
      providers: [{ provide: DATABASE, useValue: { count: async () => 5 } }, ...providers] as never,
    }).compile()

  it("counts cooldowns in the app's cooldown store, as the bot does", async () => {
    const module = create()

    await module.dispatch(slash('notes'))
    await module.dispatch(slash('notes'))

    expect(consumed).toHaveLength(2)
  })

  it("lets a CooldownStore the test provides take the app's place", async () => {
    const taken: string[] = []
    class OtherStore extends CooldownStore {
      async consume(key: string): Promise<CooldownVerdict> {
        taken.push(key)
        return { allowed: true, retryAfterMs: 0 }
      }
    }
    const module = create([{ provide: CooldownStore, useValue: new OtherStore() }])

    await module.dispatch(slash('notes'))

    expect([taken.length, consumed.length]).toEqual([1, 0])
  })
})

// close() stops waiting after shutdownTimeout, as the bot's shutdown does, whatever holds it up
describe('closing a module whose shutdown never finishes', () => {
  @MeoCord({ controllers: [NotesController], cooldownStoreTimeoutMs: 20, clientOptions: { intents: [] } })
  class QuickApp {}

  class SilentStore extends CooldownStore {
    consume(): Promise<CooldownVerdict> {
      return new Promise(() => {})
    }
  }

  @Service()
  class Stuck {
    onShutdown(): Promise<void> {
      return new Promise(() => {})
    }
  }

  it.each([
    ['a store answer that never comes', { store: new SilentStore(), stuck: false }],
    ['an onShutdown that never settles', { store: undefined, stuck: true }],
  ])('settles within shutdownTimeout through %s', async (_case, { store, stuck }) => {
    const module = MeoCordTestingModule.create({
      app: QuickApp,
      controllers: [NotesController],
      providers: [
        { provide: DATABASE, useValue: { count: async () => 1 } },
        ...(store ? [{ provide: CooldownStore, useValue: store }] : []),
        ...(stuck ? [{ provide: Stuck, useClass: Stuck }] : []),
      ],
      shutdownTimeout: 50,
    }).compile()
    await module.init()
    if (store) await module.dispatch(slash('notes'))
    if (stuck) module.get(Stuck)

    const started = Date.now()
    await module.close()

    expect(Date.now() - started).toBeLessThan(1_000)
  })
})

// close() runs the bot's own shutdown sequence
describe('closing a module, as the bot shuts down', () => {
  const events: string[] = []
  let running = Promise.withResolvers<void>()
  let finish = Promise.withResolvers<void>()

  beforeEach(() => {
    events.length = 0
    running = Promise.withResolvers<void>()
    finish = Promise.withResolvers<void>()
  })

  @Service()
  class Queries {
    onShutdown() {
      events.push('queries shutdown')
    }
  }

  @Service()
  class QueryStore extends CooldownStore {
    constructor(readonly queries: Queries) {
      super()
    }

    onShutdown() {
      events.push('store shutdown')
    }

    async consume(): Promise<CooldownVerdict> {
      return { allowed: true, retryAfterMs: 0 }
    }
  }

  @Controller()
  class DailyController {
    @Command('daily', CommandType.SLASH)
    @Cooldown({ seconds: 5 })
    async claim() {
      events.push('call runs')
      running.resolve()
      await finish.promise
      events.push('call done')
    }
  }

  @MeoCord({ controllers: [DailyController], cooldownStore: QueryStore, clientOptions: { intents: [] } })
  class DailyApp {}

  it('lets the calls under way finish, then shuts the store down before what it injects', async () => {
    const module = MeoCordTestingModule.fromApp(DailyApp).compile()
    const dispatched = module.dispatch(slash('daily'))
    await running.promise

    const closed = module.close()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(events).toEqual(['call runs'])

    finish.resolve()
    await Promise.all([dispatched, closed])

    expect(events).toEqual(['call runs', 'call done', 'store shutdown', 'queries shutdown'])
  })

  it('waits for the sequence at most the shutdownTimeout fromApp is given, and says so', async () => {
    @Service()
    class Stuck {
      onShutdown(): Promise<void> {
        return new Promise(() => {})
      }
    }
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {})
    const module = MeoCordTestingModule.fromApp(DailyApp, { providers: [{ provide: Stuck, useClass: Stuck }], shutdownTimeout: 50 }).compile()
    module.get(Stuck)

    const started = Date.now()
    await module.close()

    expect(Date.now() - started).toBeLessThan(1_000)
    expect(warn).toHaveBeenCalledWith('onShutdown hooks did not finish within 50 ms; shutting down anyway.')
    warn.mockRestore()
  })

  // Node fires a longer timer at once, so close() would give up on the hooks immediately
  it.each([
    [-1, '-1'],
    [2_147_478_648, '2147478648'],
    [Infinity, 'Infinity'],
    ['50', '"50"'],
  ])('refuses a shutdownTimeout of %s, in the words the config uses', (shutdownTimeout, shown) => {
    expect(() => MeoCordTestingModule.fromApp(DailyApp, { shutdownTimeout: shutdownTimeout as number }).compile()).toThrow(
      new TypeError(`shutdownTimeout must be a number of milliseconds 0 or more, at most 2147478647 (got ${shown}).`),
    )
  })
})

describe('a class that injects the Discord Client', () => {
  @Service()
  class Presence {
    constructor(readonly client: Client) {}
  }

  @Controller()
  class StatusController {
    constructor(readonly presence: Presence) {}
  }

  @MeoCord({ controllers: [StatusController], clientOptions: { intents: [] } })
  class StatusApp {}

  it('is refused where it is resolved, naming it and saying how to give one', () => {
    const module = MeoCordTestingModule.fromApp(StatusApp).compile()

    expect(() => module.get(StatusController)).toThrow(
      'Presence injects the Discord Client, which a testing module does not make: give one in its providers, such as { provide: Client, useValue: createMockClient() }.',
    )
  })

  it('is refused the same way in a module built from its classes', () => {
    const module = MeoCordTestingModule.create({ controllers: [StatusController] }).compile()

    expect(() => module.get(Presence)).toThrow('Presence injects the Discord Client, which a testing module does not make')
  })

  it('gets the Client a test provides', () => {
    const client = createMockClient()
    const module = MeoCordTestingModule.fromApp(StatusApp, { providers: [{ provide: Client, useValue: client }] }).compile()

    expect(module.get(StatusController).presence.client).toBe(client)
  })
})
