import 'reflect-metadata'
import { vi } from 'vitest'
import { ChatInputCommandInteraction, Client } from 'discord.js'
import { createToken } from '@src/common/token.js'
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
}

const consumed: string[] = []

@Service()
class RecordingStore extends CooldownStore {
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
  consumed.length = 0
})

describe('MeoCordTestingModule.fromApp', () => {
  it('builds the app as the bot does: its controllers, services, providers and cooldown store, none listed again', async () => {
    const module = await MeoCordTestingModule.fromApp(NotesApp).compile().init()
    const interaction = slash('notes')

    await module.dispatch(interaction)

    expect(getResponse(interaction).calls[0].payload).toMatchObject({ content: '42 notes' })
    expect(connect).toHaveBeenCalledOnce()
    expect(consumed).toHaveLength(1)
    expect(made).toEqual(['Warmup'])
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
    }
    const module = await MeoCordTestingModule.fromApp(NotesApp, { providers: [{ provide: CooldownStore, useValue: new OtherStore() }] })
      .overrideProvider(DATABASE)
      .useValue({ count: async () => 7 })
      .compile()
      .init()
    const interaction = slash('notes')

    await module.dispatch(interaction)

    expect(getResponse(interaction).calls[0].payload).toMatchObject({ content: '7 notes' })
    expect(peeked).toHaveLength(1)
    expect(consumed).toEqual([])
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
