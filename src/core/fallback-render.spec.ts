import { vi } from 'vitest'
import { ChatInputCommandInteraction, Client, type Guild } from 'discord.js'
import { Command, Controller, MeoCord, MessageHandler, Observer } from '@src/decorator/index.js'
import { MeoCordFactory } from '@src/core/meocord-factory.js'
import { createTranslator } from '@src/common/index.js'
import { Logger } from '@src/common/logger.js'
import { CommandType } from '@src/enum/index.js'
import { type DispatchResult, type ResponsePresenter } from '@src/interface/index.js'
import { createDiscordError, createMockGuild, createMockInteraction, createMockMessage, MeoCordTestingModule } from '@src/testing/index.js'

vi.mock('@src/util/meocord-config-loader.util.js', () => ({ loadMeoCordConfig: () => ({ discordToken: 'token' }) }))
vi.mock('@src/util/platform.util.js', () => ({ assertBuiltForThisPlatform: () => {} }))

const t = createTranslator({ default: 'en-US', locales: { 'en-US': { ping: 'Pong!' } } })
const told: DispatchResult[] = []

@Observer()
class Audit {
  onSettled(_context: unknown, result: DispatchResult) {
    told.push(result)
  }
}

@Controller()
class Commands {
  @MessageHandler('roll {sides:int}')
  roll() {}

  @Command('broken', CommandType.SLASH)
  broken() {
    throw new Error('boom')
  }
}

// A presenter with a fault of its own, as an app's may have
const failingPresenter: ResponsePresenter = {
  loading: () => ({ text: 'Working' }),
  error: () => {
    throw new TypeError('presenter broke')
  },
}

@MeoCord({
  controllers: [Commands],
  observers: [Audit],
  messages: { prefix: '!', deleteUsageRepliesAfter: 0 },
  i18n: t,
  clientOptions: { intents: [] },
})
class App {}

/** A server whose preferred locale is not a locale, which the translator cannot read: the usage reply fails to render. */
const unreadable = () => Object.assign(createMockGuild(), { preferredLocale: 42 }) as unknown as Guild

let errors: unknown[][]
let debugs: unknown[][]
beforeEach(() => {
  told.length = 0
  errors = []
  debugs = []
  vi.spyOn(Logger.prototype, 'error').mockImplementation((...args: unknown[]) => void errors.push(args))
  vi.spyOn(Logger.prototype, 'debug').mockImplementation((...args: unknown[]) => void debugs.push(args))
})
afterEach(() => vi.restoreAllMocks())

describe('in a running bot, an answer MeoCord fails to build', () => {
  async function start(): Promise<Client> {
    const clients: Client[] = []
    vi.spyOn(Client.prototype, 'login').mockImplementation(function (this: Client) {
      clients.push(this)
      return Promise.resolve('token')
    })
    await MeoCordFactory.create(App).start()
    Object.defineProperty(clients[0], 'user', { value: { id: '111', setActivity: () => {} }, configurable: true })
    return clients[0]
  }

  it('is logged as an error naming the call, and observed as the call’s fault, not passed off as a refusal', async () => {
    const client = await start()
    const message = createMockMessage({ content: '!roll lots', guild: unreadable() as never })
    Object.assign(message.author, { bot: false, id: 'user-1' })
    Object.defineProperty(message, 'client', { value: client })

    await Promise.all(client.rawListeners('messageCreate').map(listener => (listener as (m: unknown) => unknown)(message)))

    expect(message.reply).not.toHaveBeenCalled()
    expect(errors).toContainEqual([
      'Could not write the usage reply for message "!roll lots" for method "roll":',
      expect.objectContaining({ name: 'TypeError' }),
    ])
    await vi.waitFor(() => expect(told).toHaveLength(1))
    expect(told[0]).toMatchObject({ outcome: 'error', handled: false, error: expect.objectContaining({ name: 'TypeError' }) })
  })

  it('leaves a reply Discord refuses at debug level', async () => {
    const client = await start()
    const message = createMockMessage({ content: '!roll lots' })
    Object.assign(message.author, { bot: false, id: 'user-1' })
    Object.defineProperty(message, 'client', { value: client })
    Object.assign(message.guild!, { preferredLocale: 'en-US' })
    message.reply.mockRejectedValueOnce(createDiscordError(50013))

    await Promise.all(client.rawListeners('messageCreate').map(listener => (listener as (m: unknown) => unknown)(message)))

    expect(debugs).toContainEqual([expect.stringContaining('Could not reply to a command: DiscordAPIError')])
    expect(errors).toEqual([])
    await vi.waitFor(() => expect(told).toHaveLength(1))
    expect(told[0]).toMatchObject({ outcome: 'invalid', handled: true })
  })
})

describe('in a testing module, an answer MeoCord fails to build', () => {
  it('rejects the dispatch with the fault', async () => {
    const module = MeoCordTestingModule.fromApp(App).compile()
    const message = createMockMessage({ content: '!roll lots', guild: unreadable() as never })

    await expect(module.dispatch(message)).rejects.toThrow(TypeError)
    expect(message.reply).not.toHaveBeenCalled()
  })

  it('rejects the dispatch when the presenter fails to build an interaction’s error view', async () => {
    const module = MeoCordTestingModule.fromApp(App).compile()
    const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName: 'broken' })
    const { setPresenter } = await import('@src/common/response/presenter.js')
    setPresenter(interaction.client, failingPresenter)

    await expect(module.dispatch(interaction)).rejects.toThrow('presenter broke')
    expect(errors).toContainEqual([expect.stringContaining('Could not write the answer for'), expect.objectContaining({ message: 'presenter broke' })])
  })
})
