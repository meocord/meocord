import { vi } from 'vitest'
import { Client, type Message, type MessageReaction, type OmitPartialGroupDMChannel } from 'discord.js'
import { Catch, Controller, MeoCord, MessageHandler, ReactionHandler } from '@src/decorator/index.js'
import { MeoCordFactory } from '@src/core/meocord-factory.js'
import { Logger } from '@src/common/logger.js'
import { type ExceptionFilter, type MessageCommandOptions } from '@src/interface/index.js'
import { createMock, createMockMessage, createMockUser, MeoCordTestingModule } from '@src/testing/index.js'

vi.mock('@src/util/meocord-config-loader.util.js', () => ({ loadMeoCordConfig: () => ({ discordToken: 'token' }) }))
vi.mock('@src/util/platform.util.js', () => ({ assertBuiltForThisPlatform: () => {} }))

class ConfigMissing extends Error {}

/** A promise and the function that settles it, for a handler a test holds open. */
function gate() {
  let open!: () => void
  const promise = new Promise<void>(resolve => (open = resolve))
  return { promise, open }
}

const events: string[] = []
let logsGate = gate()

// Records the error, then passes it on, so it reaches the fallback as well
@Catch(ConfigMissing)
class Recorder implements ExceptionFilter {
  catch(error: ConfigMissing) {
    events.push(`filter:${error.message}`)
    throw error
  }
}

@Controller()
class Logs {
  @MessageHandler()
  async log() {
    events.push('Logs.log started')
    await logsGate.promise
    events.push('Logs.log finished')
  }
}

@Controller()
class Broken {
  constructor() {
    throw new ConfigMissing('Broken: config missing')
  }

  @MessageHandler()
  audit() {
    events.push('Broken.audit ran')
  }
}

@Controller()
class BrokenStars {
  constructor() {
    throw new ConfigMissing('BrokenStars: config missing')
  }

  @ReactionHandler('⭐')
  star() {
    events.push('BrokenStars.star ran')
  }

  @ReactionHandler()
  any() {
    events.push('BrokenStars.any ran')
  }
}

@Controller()
class BrokenBoth {
  constructor() {
    throw new ConfigMissing('BrokenBoth: config missing')
  }

  @MessageHandler('audit')
  audit() {
    events.push('BrokenBoth.audit ran')
  }

  @MessageHandler()
  listen() {
    events.push('BrokenBoth.listen ran')
  }
}

@Controller()
class BrokenCommand {
  constructor() {
    throw new ConfigMissing('BrokenCommand: config missing')
  }

  @MessageHandler('audit')
  audit() {
    events.push('BrokenCommand.audit ran')
  }
}

@Controller()
class Later {
  @MessageHandler()
  later() {
    events.push('Later.later ran')
  }

  @ReactionHandler('⭐')
  star() {
    events.push('Later.star ran')
  }
}

type ControllerClass = new (...args: any[]) => unknown

function appFor(controllers: ControllerClass[], messages: MessageCommandOptions = {}) {
  @MeoCord({ controllers, messages: { prefix: '!', ...messages }, filters: [Recorder], clientOptions: { intents: [] } })
  class App {}
  return App
}

const moduleFor = (controllers: ControllerClass[], messages?: MessageCommandOptions) =>
  MeoCordTestingModule.fromApp(appFor(controllers, messages)).compile()

const star = () => createMock<MessageReaction>({ emoji: { name: '⭐' } as never, message: createMockMessage() as never })

/** A started bot, its login stubbed, that receives events from its own client. */
async function runningBot(controllers: ControllerClass[], messages?: MessageCommandOptions) {
  const clients: Client[] = []
  vi.spyOn(Client.prototype, 'login').mockImplementation(function (this: Client) {
    clients.push(this)
    return Promise.resolve('token')
  })
  vi.spyOn(Client.prototype, 'destroy').mockResolvedValue(undefined)
  const app = MeoCordFactory.create(appFor(controllers, messages))
  await app.start()
  const client = clients[0]!
  Object.defineProperty(client, 'user', { value: { id: '111', setActivity: () => {} }, configurable: true })
  const message = (content: string) => {
    const sent = createMockMessage({ content })
    Object.defineProperty(sent, 'client', { value: client })
    return sent as unknown as OmitPartialGroupDMChannel<Message>
  }
  return { app, client, message }
}

let error: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  events.length = 0
  logsGate = gate()
  error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  process.removeAllListeners('SIGINT')
  process.removeAllListeners('SIGTERM')
})

const unhandledLogs = () => error.mock.calls.filter(([text]) => String(text).startsWith('Unhandled error'))

describe('a controller whose constructor throws', () => {
  describe('on a reaction', () => {
    it('leaves the reaction handlers of other controllers running when it has none of its own', async () => {
      const module = moduleFor([Broken, Later])

      const { handlers } = await module.dispatch(star(), { user: createMockUser() })

      expect(events).toEqual(['Later.star ran'])
      expect(handlers.map(({ controller, method }) => `${controller.name}.${method}`)).toEqual(['Later.star'])
    })

    it("fails only its own handlers, listed first, with the error through the filters to the fallback once", async () => {
      const module = moduleFor([BrokenStars, Later])

      await expect(module.dispatch(star(), { user: createMockUser() })).rejects.toThrow('BrokenStars: config missing')

      expect(events).toEqual(['filter:BrokenStars: config missing', 'Later.star ran'])
    })
  })

  describe.each([
    ['in turn', {}],
    ['side by side', { handlers: 'concurrent' as const }],
  ])('on a message, its handlers %s', (_, messages) => {
    it('fails only its own listener, the others before and after it running, with the error reported once', async () => {
      logsGate.open()
      const module = moduleFor([Logs, Broken, Later], messages)

      await expect(module.dispatch(createMockMessage({ content: 'hello' }))).rejects.toThrow('Broken: config missing')

      expect([...events].sort()).toEqual(['Later.later ran', 'Logs.log finished', 'Logs.log started', 'filter:Broken: config missing'])
    })

    it('fails only its own patterned handler, the listeners still running', async () => {
      logsGate.open()
      const module = moduleFor([BrokenCommand, Logs, Later], messages)

      await expect(module.dispatch(createMockMessage({ content: '!audit' }))).rejects.toThrow('BrokenCommand: config missing')

      expect([...events].sort()).toEqual(['Later.later ran', 'Logs.log finished', 'Logs.log started', 'filter:BrokenCommand: config missing'])
    })

    it('reports it once when the message reaches both its patterned handler and its listener', async () => {
      logsGate.open()
      const module = moduleFor([BrokenBoth, Logs, Later], messages)

      await expect(module.dispatch(createMockMessage({ content: '!audit' }))).rejects.toThrow('BrokenBoth: config missing')

      expect([...events].sort()).toEqual(['Later.later ran', 'Logs.log finished', 'Logs.log started', 'filter:BrokenBoth: config missing'])
    })
  })

  it('starts every other listener side by side, and settles only once a slower one has', async () => {
    const module = moduleFor([Logs, Broken, Later], { handlers: 'concurrent' })

    const dispatched = module.dispatch(createMockMessage({ content: 'hello' }))
    let settled = false
    dispatched.then(
      () => (settled = true),
      () => (settled = true),
    )
    await vi.waitFor(() => expect([...events].sort()).toEqual(['Later.later ran', 'Logs.log started', 'filter:Broken: config missing']))
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(settled).toBe(false)

    logsGate.open()
    await expect(dispatched).rejects.toThrow('Broken: config missing')
    expect(events.at(-1)).toBe('Logs.log finished')
  })

  describe('on a running bot', () => {
    it('runs every other listener and reaction handler, the error going to the filters rather than logged as unhandled', async () => {
      logsGate.open()
      const { app, client, message } = await runningBot([Logs, Broken, BrokenStars, Later])

      client.emit('messageCreate', message('hello'))
      client.emit('messageReactionAdd', star(), createMockUser() as never, {} as never)
      await vi.waitFor(() => expect(events).toContain('Later.star ran'))
      await vi.waitFor(() => expect(events).toContain('Later.later ran'))
      await app.stop()

      expect([...events].sort()).toEqual([
        'Later.later ran',
        'Later.star ran',
        'Logs.log finished',
        'Logs.log started',
        'filter:Broken: config missing',
        'filter:BrokenStars: config missing',
      ])
      expect(unhandledLogs()).toEqual([])
    })

    it('waits, as it shuts down, for the listeners of a message handled side by side', async () => {
      const { app, client, message } = await runningBot([Logs, Broken, Later], { handlers: 'concurrent' })

      client.emit('messageCreate', message('hello'))
      await vi.waitFor(() => expect(events).toContain('Later.later ran'))
      const stopped = app.stop().then(() => events.push('stopped'))
      await new Promise(resolve => setTimeout(resolve, 10))
      expect(events).not.toContain('stopped')

      logsGate.open()
      await stopped

      expect(events.slice(-2)).toEqual(['Logs.log finished', 'stopped'])
      expect(unhandledLogs()).toEqual([])
    })
  })
})
