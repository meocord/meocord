import { vi } from 'vitest'
import { ChatInputCommandInteraction, Client, type InteractionReplyOptions } from 'discord.js'

const { logged, config } = vi.hoisted(() => ({
  logged: [] as string[],
  config: { discordToken: 'token', shutdownTimeout: 4_000 } as { discordToken: string; shutdownTimeout: number },
}))

vi.mock('@src/common/index.js', async importOriginal => ({
  ...(await importOriginal<object>()),
  Logger: class {
    log = vi.fn()
    debug = vi.fn()
    info = vi.fn()
    verbose = vi.fn()
    warn = (...args: unknown[]) => logged.push(args.map(String).join(' '))
    error = (...args: unknown[]) => logged.push(args.map(String).join(' '))
  },
}))
vi.mock('@src/util/meocord-config-loader.util.js', () => ({ loadMeoCordConfig: () => config }))
vi.mock('@src/util/platform.util.js', () => ({ assertBuiltForThisPlatform: () => {} }))

import { respond } from '@src/common/index.js'
import { Command, Controller, Defer, MeoCord } from '@src/decorator/index.js'
import { MeoCordFactory } from '@src/core/meocord-factory.js'
import { CommandType } from '@src/enum/index.js'
import { type MeoCordApplication } from '@src/interface/index.js'
import { createChatInputOptions, createMockInteraction } from '@src/testing/index.js'

const GUILD = '100000000000000001'
/** MeoCord's default primary colour: the handler's theme in an app with none of its own. */
const HANDLER = '#7680F4'

@Controller()
class Calls {
  @Command('plain', CommandType.SLASH)
  async plain(interaction: ChatInputCommandInteraction) {
    await respond(interaction).send({ embeds: [{ description: 'pong' }] })
  }

  @Defer()
  @Command('eager', CommandType.SLASH)
  async eager(interaction: ChatInputCommandInteraction) {
    await respond(interaction).send({ embeds: [{ description: 'pong' }] })
  }
}

let app: MeoCordApplication

/** Starts an app logged in without a network, whose server theme resolver never answers. */
async function startApp(): Promise<Client> {
  const clients: Client[] = []
  vi.spyOn(Client.prototype, 'login').mockImplementation(function (this: Client) {
    clients.push(this)
    return Promise.resolve('token')
  })
  vi.spyOn(Client.prototype, 'destroy').mockResolvedValue(undefined)

  @MeoCord({ controllers: [Calls], clientOptions: { intents: [] }, themeFor: { guild: () => new Promise(() => undefined) }, themeForTimeoutMs: 5000 })
  class App {}

  app = MeoCordFactory.create(App)
  await app.start()
  const client = clients[0]
  Object.defineProperty(client, 'application', { value: { id: '100000000000000002' }, configurable: true })
  vi.spyOn(client.rest, 'get').mockResolvedValue([])
  vi.spyOn(client.rest, 'put').mockResolvedValue([])
  for (const listener of client.listeners('clientReady')) await (listener as (c: Client) => Promise<void>)(client)
  return client
}

/** Dispatches `/name` from the server as the gateway would, recording each answer's method, time and colour. */
function command(client: Client, name: string) {
  const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName: name, guildId: GUILD, options: createChatInputOptions({}) } as never)
  const sent: { method: string; at: number; colour?: string }[] = []
  for (const method of ['reply', 'deferReply', 'editReply'] as const) {
    const call = interaction[method] as (...args: unknown[]) => unknown
    Object.assign(interaction, {
      [method]: (...args: unknown[]) => {
        const embed = (args[0] as InteractionReplyOptions | undefined)?.embeds?.[0] as { color?: number; data?: { color?: number } } | undefined
        const colour = embed?.data?.color ?? embed?.color
        sent.push({ method, at: Date.now() - interaction.createdTimestamp, ...(colour !== undefined && { colour: `#${colour.toString(16).padStart(6, '0').toUpperCase()}` }) })
        return call(...args)
      },
    })
  }
  const [dispatch] = client.listeners('interactionCreate') as ((interaction: unknown) => Promise<void>)[]
  return { handled: dispatch(interaction), sent }
}

describe('a theme lookup in flight as the bot stops', () => {
  beforeEach(() => {
    logged.length = 0
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    process.removeAllListeners('SIGINT')
    process.removeAllListeners('SIGTERM')
  })

  it('logs nothing once the stop has resolved, and leaves no timer armed, for a lookup a call was cut from', async () => {
    const client = await startApp()
    vi.useFakeTimers()
    const { handled, sent } = command(client, 'plain')
    await vi.advanceTimersByTimeAsync(2100)
    await handled
    expect(sent).toEqual([{ method: 'reply', at: 2000, colour: HANDLER }])

    const stopping = app.stop()
    await vi.advanceTimersByTimeAsync(0)
    await stopping
    const before = [...logged]
    const armed = vi.getTimerCount()
    await vi.advanceTimersByTimeAsync(8000)

    expect(logged).toEqual(before)
    expect(logged.filter(line => line.includes('did not answer'))).toEqual([])
    expect(armed).toBe(0)
  })

  it("ends the wait of a call the drain outlasted in the handler's theme as the shutdown ends, logging nothing after the stop", async () => {
    const client = await startApp()
    vi.useFakeTimers()
    const { handled, sent } = command(client, 'eager')
    await vi.advanceTimersByTimeAsync(100)

    const stopping = app.stop()
    // The drain has 3 s of the 4 s, then the hooks run and the lookup is abandoned
    await vi.advanceTimersByTimeAsync(4000)
    await stopping
    const before = [...logged]
    await vi.advanceTimersByTimeAsync(8000)
    await handled

    // Its wait ends as the sequence does, at 3.1 s; nothing awaits the call itself, so its edit may follow the stop
    expect(sent).toEqual([
      { method: 'deferReply', at: 0 },
      { method: 'editReply', at: 3100, colour: HANDLER },
    ])
    expect(logged).toEqual(before)
    expect(logged.filter(line => line.includes('did not answer'))).toEqual([])
  })
})
