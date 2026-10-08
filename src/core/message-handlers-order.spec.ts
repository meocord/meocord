import { vi } from 'vitest'
import { type Message } from 'discord.js'
import { Catch, Controller, MeoCord, MessageHandler, UseFilter } from '@src/decorator/index.js'
import { Logger } from '@src/common/logger.js'
import { type ExceptionFilter, type MessageCommandOptions } from '@src/interface/index.js'
import { createMockMessage, MeoCordTestingModule } from '@src/testing/index.js'

/** A promise and the function that settles it, for a handler a test holds open. */
function gate() {
  let open!: () => void
  const promise = new Promise<void>(resolve => (open = resolve))
  return { promise, open }
}

const events: string[] = []
let commandGate = gate()

@Catch(Error)
class AuditFilter implements ExceptionFilter {
  catch(error: Error) {
    events.push(`filter:${error.message}`)
  }
}

@Controller()
class Commands {
  @MessageHandler('report')
  async report() {
    events.push('report:start')
    await commandGate.promise
    events.push('report:end')
  }
}

@Controller()
class Listeners {
  @MessageHandler()
  log(message: Message) {
    events.push(`log:${message.content}`)
  }

  @MessageHandler()
  @UseFilter(AuditFilter)
  audit() {
    throw new Error('audit failed')
  }

  @MessageHandler()
  count() {
    events.push('count')
  }
}

function moduleFor(messages: MessageCommandOptions) {
  @MeoCord({ controllers: [Commands, Listeners], messages, clientOptions: { intents: [] } })
  class App {}
  return MeoCordTestingModule.fromApp(App).compile()
}

beforeEach(() => {
  events.length = 0
  commandGate = gate()
})

describe('a message’s command and listeners', () => {
  it('run one after another by default, the command first, each listener after the one before it', async () => {
    const module = moduleFor({ prefix: '!' })

    const dispatched = module.dispatch(createMockMessage({ content: '!report' }))
    await vi.waitFor(() => expect(events).toEqual(['report:start']))
    commandGate.open()
    const { handlers } = await dispatched

    expect(events).toEqual(['report:start', 'report:end', 'log:!report', 'filter:audit failed', 'count'])
    expect(handlers.map(handler => handler.method)).toEqual(['report', 'log', 'audit', 'count'])
  })

  describe("with messages: { handlers: 'concurrent' }", () => {
    it('runs every listener while the command is still running, and settles once all have', async () => {
      const module = moduleFor({ prefix: '!', handlers: 'concurrent' })

      const dispatched = module.dispatch(createMockMessage({ content: '!report' }))
      // The command waits on its gate; the listeners and the failing listener's filter finish without it
      await vi.waitFor(() =>
        expect([...events].sort()).toEqual(['count', 'filter:audit failed', 'log:!report', 'report:start']),
      )
      let settled = false
      void dispatched.then(() => (settled = true))
      await Promise.resolve()
      expect(settled).toBe(false)

      commandGate.open()
      const { handlers } = await dispatched
      expect(events.at(-1)).toBe('report:end')
      // Reported in the order they started, whichever settled first
      expect(handlers.map(handler => [handler.method, handler.ran])).toEqual([
        ['report', true],
        ['log', true],
        ['audit', true],
        ['count', true],
      ])
    })
  })
})

// A 4.1 test that compares a whole result must keep passing: the result gains no property in either mode
it.each([{ prefix: '!' }, { prefix: '!', handlers: 'concurrent' as const }])('reports a call as 4.1 did, with %j', async messages => {
  commandGate.open()
  const result = await moduleFor(messages).dispatch(createMockMessage({ content: '!report' }))

  expect(result).toStrictEqual({
    ran: true,
    handlers: [
      { controller: Commands, method: 'report', ran: true },
      { controller: Listeners, method: 'log', ran: true },
      { controller: Listeners, method: 'audit', ran: true, error: expect.any(Error) },
      { controller: Listeners, method: 'count', ran: true },
    ],
    error: expect.any(Error),
  })
})

describe('the slow-handler warning', () => {
  let warn: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'performance'] })
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.useRealTimers()
    warn.mockRestore()
  })

  /** Dispatches `!report` with the command held open for `seconds` of fake time. */
  async function slowReport(module: ReturnType<typeof moduleFor>, seconds: number) {
    const dispatched = module.dispatch(createMockMessage({ content: '!report' }))
    await vi.waitFor(() => expect(events).toContain('report:start'))
    setTimeout(() => commandGate.open(), seconds * 1000)
    await vi.advanceTimersByTimeAsync(seconds * 1000)
    await dispatched
    commandGate = gate()
    events.length = 0
  }

  const slowWarnings = () => warn.mock.calls.map(([text]) => String(text)).filter(text => text.includes('held back'))

  it('names a handler that held the message’s listeners back for 5 s or more, once, and how to run them side by side', async () => {
    const module = moduleFor({ prefix: '!' })

    await slowReport(module, 6)
    await slowReport(module, 6)

    expect(slowWarnings()).toEqual([
      "Commands.report took 6.0 s on a message, and held back the 3 listeners after it. @MeoCord({ messages: { handlers: 'concurrent' } }) runs them side by side; messages: { slowHandlerWarning: false } turns this off.",
    ])
  })

  it.each([
    ['under 5 s', { prefix: '!' }, 4.9],
    ['with slowHandlerWarning: false', { prefix: '!', slowHandlerWarning: false }, 6],
    ["with handlers: 'concurrent', which holds no one back", { prefix: '!', handlers: 'concurrent' as const }, 6],
  ])('says nothing %s', async (_, messages, seconds) => {
    await slowReport(moduleFor(messages), seconds)

    expect(slowWarnings()).toEqual([])
  })
})

describe('the options', () => {
  it.each([
    [{ handlers: 'parallel' }, "@MeoCord({ messages: { handlers } }) takes 'sequential' or 'concurrent'."],
    [{ slowHandlerWarning: 'yes' }, '@MeoCord({ messages: { slowHandlerWarning } }) takes true or false.'],
  ])('refuses %j where the app is declared', (messages, message) => {
    expect(() => moduleFor(messages as unknown as MessageCommandOptions)).toThrow(message)
  })
})
