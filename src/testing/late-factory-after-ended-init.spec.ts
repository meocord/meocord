import { ChatInputCommandInteraction, type GuildMember } from 'discord.js'
import { vi } from 'vitest'
import { Logger } from '@src/common/index.js'
import { Command, Controller, Inject, On, Service } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { createMock, createMockInteraction, MeoCordTestingModule, type TestingModule } from '@src/testing/index.js'

/** close()'s wait for the factory under way; short, as LATE settles only once close() has stopped waiting. */
const SHUTDOWN_TIMEOUT_MS = 50
/** What a call or a get() that needs AFTER fails with once a close() ended init() before LATE, and so AFTER, was made. */
const NOT_MADE = "close() ended init() before it made 'AFTER'; its factory doesn't run after close()."
/** The end of the warning for a unit made after close(), which nothing shuts down. */
const NOTHING_SHUTS = '; the testing module is closed, so nothing shuts it down. Close it after the last call, in afterEach.'

/** What happened, in order: the factories, constructors and handlers, and the module's warnings. */
let events: string[]

beforeEach(() => {
  events = []
  vi.spyOn(Logger.prototype, 'warn').mockImplementation((...args: unknown[]) => void events.push(`warn: ${String(args[0])}`))
  // dispatch logs a call that failed before it rejects with its error
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

@Service()
class Store {
  constructor() {
    events.push('Store made')
  }
  onShutdown() {
    events.push('Store closed')
  }
}

@Controller()
class Thanks {
  constructor(@Inject('AFTER') readonly after: object) {}
  @Command('thanks', CommandType.SLASH)
  thanks() {
    events.push('thanks runs')
  }
  @On('guildMemberUpdate')
  thank() {
    events.push('thank runs')
  }
}

@Controller()
class Keeper {
  constructor(@Inject(Store) readonly store: Store) {}
  @Command('keep', CommandType.SLASH)
  keep() {
    events.push('keep runs')
  }
}

@Controller()
class Closing {
  @Command('closing', CommandType.SLASH)
  closing() {
    events.push('closing runs')
  }
  onShutdown() {
    events.push('Closing closed')
  }
}

/** A controller with an onShutdown, made by its first call. */
@Controller()
class Desk {
  constructor() {
    events.push('Desk made')
  }
  @Command('desk', CommandType.SLASH)
  desk() {
    events.push('desk runs')
  }
  @On('guildMemberAdd')
  welcome() {
    events.push('welcome runs')
  }
  onShutdown() {
    events.push('Desk closed')
  }
}

/** A module whose LATE factory settles when the test says, and whose AFTER factory, sync or not, is made from LATE. */
function moduleWithLateFactory(after: 'sync' | 'async' = 'sync') {
  const late = Promise.withResolvers<void>()
  const lateStarted = Promise.withResolvers<void>()
  const made = () => (events.push('AFTER factory runs'), { onShutdown: () => void events.push('AFTER closed') })
  const module = MeoCordTestingModule.create({
    controllers: [Thanks, Keeper, Closing],
    services: [Store],
    providers: [
      { provide: 'LATE', useFactory: () => (lateStarted.resolve(), late.promise.then(() => ({ onShutdown: () => void events.push('LATE closed') }))) },
      { provide: 'AFTER', inject: ['LATE'], useFactory: after === 'sync' ? made : async () => made() },
    ],
    shutdownTimeout: SHUTDOWN_TIMEOUT_MS,
  } as never).compile()
  return { module, settleFactory: () => late.resolve(), lateStarted: lateStarted.promise }
}

/** init(), then a close() that ends it while it waits for LATE, which settles once close() has stopped waiting. */
async function endedInit(after: 'sync' | 'async' = 'sync') {
  const built = moduleWithLateFactory(after)
  const init = built.module.init()
  await built.lateStarted
  await built.module.close()
  built.settleFactory()
  await init
  events.length = 0
  return built.module
}

const command = (commandName: string) => createMockInteraction(ChatInputCommandInteraction, { commandName })
const warnings = () => events.filter(event => event.startsWith('warn: ') && !event.includes('This testing module is closed'))

describe('a factory the init() a close() ended did not reach', () => {
  for (const after of ['sync', 'async'] as const) {
    it(`fails a dispatch that needs its value, naming it, and does not run (${after} factory)`, async () => {
      const module = await endedInit(after)

      const error = await module.dispatch(command('thanks')).then(
        () => undefined,
        (reason: unknown) => reason,
      )

      // The module's own error, not one the container wraps
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).constructor).toBe(Error)
      expect((error as Error).message).toBe(NOT_MADE)
      expect(events).not.toContain('AFTER factory runs')
      expect(events).not.toContain('thanks runs')
    })
  }

  it('fails an invoke that needs its value', async () => {
    const module = await endedInit()

    await expect(module.invoke(Thanks, 'thanks', command('thanks'))).rejects.toThrow(NOT_MADE)
    expect(events).not.toContain('AFTER factory runs')
  })

  it('fails an emit whose handler needs its value, as a handler that throws', async () => {
    const module = await endedInit()

    await expect(module.emit('guildMemberUpdate', createMock<GuildMember>(), createMock<GuildMember>())).rejects.toThrow(NOT_MADE)
    expect(events).not.toContain('AFTER factory runs')
    expect(events).not.toContain('thank runs')
  })

  it('fails a get() of it, sync factory or not', async () => {
    const module = await endedInit()

    expect(() => module.get('AFTER')).toThrow(NOT_MADE)
    expect(events).not.toContain('AFTER factory runs')
  })
})

describe('a unit with an onShutdown made after close()', () => {
  it('a service the ended init() did not make: the call makes it, runs, and warns once, naming it', async () => {
    const module = await endedInit()

    await module.dispatch(command('keep'))
    await module.dispatch(command('keep'))

    expect(events.filter(event => event === 'keep runs')).toHaveLength(2)
    expect(warnings()).toEqual([`warn: Store is made after close()${NOTHING_SHUTS}`])
  })

  // The warning follows any close(), not only one that ended init(), as get()'s does
  it('a controller after an init() and a close() that ended nothing: the call warns, naming it', async () => {
    const { module, settleFactory } = moduleWithLateFactory()
    settleFactory()
    await module.init()
    await module.close()
    events.length = 0

    const { ran } = await module.dispatch(command('closing'))

    expect(ran).toBe(true)
    expect(warnings()).toEqual([`warn: Closing is made after close()${NOTHING_SHUTS}`])
  })

  // close() shuts the value it stopped waiting for down once it arrives, so it is no call's to warn about
  it('the value the ended init() was waiting for, arriving after close(), warns nothing', async () => {
    const { module, settleFactory, lateStarted } = moduleWithLateFactory()
    const init = module.init()
    await lateStarted
    await module.close()
    settleFactory()
    await init

    expect(events).toContain('LATE closed')
    expect(warnings().filter(event => !event.includes('still waits for'))).toEqual([])
  })

  // close() waits for the ready pass before it lists its units, so one the pass makes is on the list, fake timers or not
  it('a unit the ready pass makes after an onReady timer closed the module warns nothing, under fake timers', async () => {
    vi.useFakeTimers()
    const gate = Promise.withResolvers<void>()
    const box: { module?: TestingModule; closed?: Promise<void> } = {}
    @Service()
    class Early {
      onReady() {
        setTimeout(() => (box.closed = box.module!.close()), 10)
      }
      onShutdown() {}
    }
    @Service()
    class Pool {
      constructor(@Inject(Early) readonly early: Early) {}
      async onReady() {
        await gate.promise
      }
      onShutdown() {}
    }
    @Service()
    class Later {
      constructor(@Inject(Pool) readonly pool: Pool) {
        events.push('Later made')
      }
      onReady() {}
      onShutdown() {
        events.push('Later closed')
      }
    }
    @Controller()
    class Uses {
      constructor(@Inject(Later) readonly later: Later) {}
    }
    box.module = MeoCordTestingModule.create({ controllers: [Uses] }).compile()
    const initialised = box.module.init({ ready: true })
    await vi.advanceTimersByTimeAsync(10)
    expect(box.closed).toBeDefined()
    gate.resolve()
    await Promise.all([initialised, box.closed])

    expect(events).toEqual(['Later made', 'Later closed'])
    expect(warnings()).toEqual([])
  })

  // close() lists what it shuts down only once it gets there; a unit made before that is on the list
  for (const kind of ['dispatch', 'invoke', 'emit', 'get'] as const) {
    it(`a ${kind} made just before close() makes a unit close() shuts down, and warns nothing`, async () => {
      const module = MeoCordTestingModule.create({ controllers: [Desk] }).compile()
      await module.init()
      const call =
        kind === 'dispatch'
          ? module.dispatch(command('desk'))
          : kind === 'invoke'
            ? module.invoke(Desk, 'desk', command('desk'))
            : kind === 'emit'
              ? module.emit('guildMemberAdd', createMock<GuildMember>())
              : undefined
      const closing = module.close()
      if (kind === 'get') module.get(Desk)
      await call
      await closing

      expect(events).toContain('Desk made')
      expect(events).toContain('Desk closed')
      expect(warnings()).toEqual([])
    })
  }

  // Nothing shuts down what an init() after close() makes, so it warns as a call's unit does
  it('an init({ ready: true }) after close() warns for each unit with an onShutdown it makes', async () => {
    const module = MeoCordTestingModule.create({
      controllers: [Desk],
      providers: [{ provide: 'SLOW', useFactory: async () => ({ onShutdown: () => void events.push('SLOW closed') }) }],
    } as never).compile()
    await module.close()

    await module.init({ ready: true })

    expect(warnings()).toEqual([`warn: 'SLOW' is made after close()${NOTHING_SHUTS}`, `warn: Desk is made after close()${NOTHING_SHUTS}`])
    expect(events).not.toContain('SLOW closed')
    expect(events).not.toContain('Desk closed')
  })

  it('a get() that makes it keeps its own wording', async () => {
    const module = await endedInit()

    module.get(Store)

    expect(warnings()).toEqual([`warn: get(Store) after close() makes Store now${NOTHING_SHUTS}`])
  })

  it('a unit with no onShutdown, or one made before close(), warns nothing', async () => {
    const { module, settleFactory } = moduleWithLateFactory()
    settleFactory()
    await module.init()
    await module.dispatch(command('closing'))
    await module.close()
    events.length = 0

    await module.dispatch(command('thanks'))
    await module.dispatch(command('closing'))

    expect(events.filter(event => event.endsWith('runs'))).toEqual(['thanks runs', 'closing runs'])
    expect(warnings()).toEqual([])
  })
})
