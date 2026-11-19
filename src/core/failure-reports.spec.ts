import { inspect, stripVTControlCharacters } from 'node:util'
import { ChatInputCommandInteraction, Client } from 'discord.js'
import { vi } from 'vitest'
import { Command, Controller, MeoCord, Observer } from '@src/decorator/index.js'
import { MeoCordFactory } from '@src/core/meocord-factory.js'
import { forgetProcessState } from '@src/core/process-state.js'
import { CommandType } from '@src/enum/index.js'
import { type DispatchObserver } from '@src/interface/index.js'
import { createMockInteraction, getResponse } from '@src/testing/index.js'

vi.mock('@src/util/meocord-config-loader.util.js', () => ({ loadMeoCordConfig: () => ({ discordToken: 'token' }) }))
vi.mock('@src/util/platform.util.js', () => ({ assertBuiltForThisPlatform: () => {} }))

/** A value an application throws whose inspection throws, which a bot does not wait for in its observers. */
const uninspectable = () => ({
  [inspect.custom]: () => {
    throw new Error('inspect.custom')
  },
})
const PLACEHOLDER = '[value could not be inspected: inspect.custom]'

/** What each part of the app does on this test's calls. */
let fails: { onStart?: 'rejects'; onSettled?: boolean; handler?: boolean; namelessOnSettled?: boolean }
const ran: string[] = []

@Observer()
class Watch implements DispatchObserver {
  onStart() {
    if (fails.onStart === 'rejects') return Promise.reject(uninspectable()) as never
  }
  onSettled() {
    if (fails.onSettled) throw uninspectable()
  }
}

// An observer whose class cannot be named, so a report that names it throws
@Observer()
class Nameless implements DispatchObserver {
  static get name(): string {
    if (fails.namelessOnSettled) throw new Error('no name')
    return 'Nameless'
  }
  onSettled() {
    if (fails.namelessOnSettled) throw new Error('settled')
  }
}

@Controller()
class Calls {
  @Command('handler', CommandType.SLASH)
  async handler(interaction: ChatInputCommandInteraction) {
    ran.push('handler')
    if (fails.handler) throw uninspectable()
    await interaction.reply({ content: 'Done.' })
  }
}

@MeoCord({ controllers: [Calls], observers: [Watch, Nameless], clientOptions: { intents: [] } })
class App {}

/** Each line printed, without colour and timestamp, prefixed with the console method that printed it. */
let printed: string[]
const uncaught: unknown[] = []
const onUncaught = (error: unknown) => void uncaught.push(error)
/** The app each test starts, stopped after it. */
let app: ReturnType<typeof MeoCordFactory.create> | undefined

beforeEach(() => {
  forgetProcessState()
  fails = {}
  ran.length = 0
  uncaught.length = 0
  printed = []
  for (const method of ['log', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      const line = stripVTControlCharacters(args.map(String).join(' ')).replace(/^.*?UTC[+-]\d\d:\d\d /, '')
      printed.push(`${method} ${line}`)
    })
  }
  vi.spyOn(Client.prototype, 'destroy').mockResolvedValue(undefined)
  process.on('uncaughtException', onUncaught)
  process.on('unhandledRejection', onUncaught)
})

afterEach(async () => {
  fails = {}
  await app?.stop()
  app = undefined
  process.off('uncaughtException', onUncaught)
  process.off('unhandledRejection', onUncaught)
  vi.restoreAllMocks()
  forgetProcessState()
})

/** Starts the app as a built bot does, login mocked, and runs its ready listener. */
async function start(): Promise<Client> {
  const clients: Client[] = []
  vi.spyOn(Client.prototype, 'login').mockImplementation(function (this: Client) {
    clients.push(this)
    return Promise.resolve('token')
  })
  app = MeoCordFactory.create(App)
  await app.start()
  const client = clients[0]!
  await (client.listeners('clientReady')[0] as (ready: Client) => Promise<void>)(client)
  return client
}

/** Delivers a slash command to the bot as discord.js would, and lets what the bot does not wait for run. */
async function call(client: Client): Promise<ChatInputCommandInteraction> {
  const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName: 'handler', client } as never)
  await Promise.all(client.listeners('interactionCreate').map(listener => (listener as (i: unknown) => unknown)(interaction)))
  await settle()
  return interaction
}

/** A few turns of the event loop, so a rejection no one handles is reported. */
const settle = async () => {
  for (let i = 0; i < 3; i++) await new Promise(resolve => setTimeout(resolve, 0))
}

const errors = () => printed.filter(line => line.startsWith('error '))

describe('a failure the bot reports while nothing waits for it', () => {
  it.each([
    ['onSettled throws', { onSettled: true }, `error [ERROR] [Observer] Observer Watch threw while observing Calls.handler: ${PLACEHOLDER}`],
    ['onStart rejects', { onStart: 'rejects' }, `error [ERROR] [Observer] Observer Watch threw while starting Calls.handler: ${PLACEHOLDER}`],
  ] as const)("is logged when an observer's %s with such a value, and the bot answers the next call", async (_case, how, line) => {
    const client = await start()
    fails = how

    await call(client)
    fails = {}
    const next = await call(client)

    expect(uncaught).toEqual([])
    expect(errors()).toEqual([line])
    expect(ran).toEqual(['handler', 'handler'])
    expect(getResponse(next).calls.map(({ method }) => method)).toEqual(['reply'])
  })

  it('is logged in its place when reporting it throws, and the observers after it still run', async () => {
    const client = await start()
    fails = { namelessOnSettled: true, onSettled: true }

    await call(client)

    expect(uncaught).toEqual([])
    expect(errors()).toEqual([
      `error [ERROR] [Observer] Observer Watch threw while observing Calls.handler: ${PLACEHOLDER}`,
      expect.stringMatching(/^error \[ERROR\] \[Observer\] An observer failed, and reporting it threw: Error: no name\n/),
    ])
  })
})

describe('a handler that throws such a value', () => {
  it('is logged once, naming the value, and the call is answered', async () => {
    const client = await start()
    fails = { handler: true }

    const interaction = await call(client)

    expect(uncaught).toEqual([])
    expect(errors()).toEqual([`error [ERROR] [MeoCordApp] Error handling command "handler": ${PLACEHOLDER}`])
    expect(getResponse(interaction).calls.map(({ method }) => method)).toEqual(['reply'])
  })
})
