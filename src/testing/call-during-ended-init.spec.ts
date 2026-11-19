import { ChatInputCommandInteraction, type GuildMember } from 'discord.js'
import { vi } from 'vitest'
import { Logger } from '@src/common/index.js'
import { isStoppedBeforeStart } from '@src/core/ready-gate.js'
import { Command, Controller, Inject, On, Service } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { createMock, createMockInteraction, MeoCordTestingModule } from '@src/testing/index.js'

/** close()'s wait for the factory under way; short, as the rows that outlast it settle the factory only afterwards. */
const SHUTDOWN_TIMEOUT_MS = 50
/** What a call that never started ends with, as the bot's ready gate drops one at a stop. */
const DROPPED = 'The bot stopped before this call started.'
/** The warning a call made after close() logs before it runs. */
const CLOSED_WARNING = /This testing module is closed/
/** What close() logs when it stops waiting for the factory under way. */
const OUTLASTED = `warn: init() still waits for the factory providing 'LATE' after ${SHUTDOWN_TIMEOUT_MS} ms; close() shuts down without it.`

/** What happened, in order. */
let events: string[]

beforeEach(() => {
  events = []
  vi.spyOn(Logger.prototype, 'warn').mockImplementation((...args: unknown[]) => void events.push(`warn: ${String(args[0])}`))
})

afterEach(() => {
  vi.restoreAllMocks()
})

@Service()
class Cache {
  constructor(@Inject('LATE') readonly late: object) {
    events.push('Cache made')
  }
  onReady() {
    events.push('Cache ready')
  }
  onShutdown() {
    events.push('Cache closed')
  }
}

@Controller()
class Quotes {
  constructor(@Inject(Cache) readonly cache: Cache) {}
  @Command('quote', CommandType.SLASH)
  quote() {
    events.push('quote runs')
  }
}

@Controller()
class Greeter {
  constructor(@Inject(Cache) readonly cache: Cache) {}
  @On('guildMemberAdd')
  welcome() {
    events.push('welcome runs')
  }
}

class NotAController {
  quote() {}
}

/** A module whose LATE factory settles when the test says, before Cache and the controllers that inject it. */
function moduleWithLateFactory() {
  const late = Promise.withResolvers<void>()
  const module = MeoCordTestingModule.create({
    controllers: [Quotes, Greeter],
    services: [Cache],
    providers: [{ provide: 'LATE', useFactory: () => late.promise.then(() => (events.push('LATE made'), {})) }],
    shutdownTimeout: SHUTDOWN_TIMEOUT_MS,
  } as never).compile()
  return { module, settleFactory: () => late.resolve() }
}

const quote = () => createMockInteraction(ChatInputCommandInteraction, { commandName: 'quote' })

type Kind = 'dispatch' | 'invoke' | 'emit'

function call(module: ReturnType<typeof moduleWithLateFactory>['module'], kind: Kind): Promise<{ ran: unknown; error?: unknown }> {
  if (kind === 'dispatch') return module.dispatch(quote())
  if (kind === 'invoke') return module.invoke(Quotes, 'quote', quote())
  return module.emit('guildMemberAdd', createMock<GuildMember>())
}

describe('a call made while init() runs, which close() then ends', () => {
  for (const kind of ['dispatch', 'invoke', 'emit'] as const) {
    for (const factory of ['outlasts', 'settles inside'] as const) {
      it(`${kind}: doesn't start, with a factory that ${factory} close()'s wait`, async () => {
        const { module, settleFactory } = moduleWithLateFactory()
        const init = module.init()
        const result = call(module, kind)
        const closing = module.close()
        if (factory === 'settles inside') settleFactory()
        await closing
        events.push('close resolved')
        if (factory === 'outlasts') settleFactory()

        const { ran, error, ...rest } = await result
        await init

        expect(ran).toBe(kind === 'emit' ? 0 : false)
        expect((error as Error).message).toBe(DROPPED)
        expect(isStoppedBeforeStart(error)).toBe(true)
        if (kind === 'dispatch') expect(rest).toEqual({ handlers: [] })
        // Nothing is made for it and no handler runs, before or after close(); nor is it warned about as a late call
        expect(events).toEqual(factory === 'outlasts' ? [OUTLASTED, 'close resolved', 'LATE made'] : ['LATE made', 'close resolved'])
      })
    }
  }

  it('invoke of a class that is not a controller still throws', async () => {
    const { module, settleFactory } = moduleWithLateFactory()
    void module.init()
    const result = module.invoke(NotAController as never, 'quote' as never, quote())
    await module.close()
    settleFactory()

    await expect(result).rejects.toThrow('NotAController is not a controller of this testing module.')
  })
})

describe('calls close() leaves alone', () => {
  it('emit during init with no close() resolves with ran alone', async () => {
    const { module, settleFactory } = moduleWithLateFactory()
    void module.init()
    const result = module.emit('guildMemberAdd', createMock<GuildMember>())
    settleFactory()

    const emitted = await result

    expect(emitted).toStrictEqual({ ran: 1 })
    expect('error' in emitted).toBe(false)
    await module.close()
  })

  // close() ended the init(), but the call came after it, so it warns and runs, as its warning says
  it('a call made after close() warns and runs', async () => {
    const { module, settleFactory } = moduleWithLateFactory()
    void module.init()
    await module.close()
    const result = module.dispatch(quote())
    settleFactory()

    const { ran } = await result

    expect(ran).toBe(true)
    expect(events.filter(event => CLOSED_WARNING.test(event))).toHaveLength(1)
    expect(events.indexOf('quote runs')).toBeGreaterThan(events.findIndex(event => CLOSED_WARNING.test(event)))
  })

  // init() was done, so close() ended nothing: the call goes on, and the close's sequence runs as it always did
  it('a call made just before close() on an initialised module runs', async () => {
    const { module, settleFactory } = moduleWithLateFactory()
    settleFactory()
    await module.init()
    const result = module.dispatch(quote())
    await module.close()

    const { ran, error } = await result

    expect(ran).toBe(true)
    expect(error).toBeUndefined()
    expect(events).toContain('quote runs')
  })

  it('init({ ready: true }) after init() and close() runs no onReady', async () => {
    const { module, settleFactory } = moduleWithLateFactory()
    settleFactory()
    await module.init()
    await module.close()

    await module.init({ ready: true })

    expect(events).toEqual(['LATE made'])
  })
})
