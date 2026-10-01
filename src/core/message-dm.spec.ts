import { vi } from 'vitest'
import { Client, type Guild, type Message } from 'discord.js'
import { Catch, Controller, Cooldown, Guard, MeoCord, MessageHandler, UseFilter, UseGuard } from '@src/decorator/index.js'
import { MeoCordFactory } from '@src/core/meocord-factory.js'
import { createTranslator, GuardDeniedError, UserError } from '@src/common/index.js'
import { Logger } from '@src/common/logger.js'
import { type ExceptionFilter, type GuardInterface } from '@src/interface/index.js'
import { createDiscordError, createMockGuild, createMockMessage, MeoCordTestingModule } from '@src/testing/index.js'

vi.mock('@src/util/meocord-config-loader.util.js', () => ({ loadMeoCordConfig: () => ({ discordToken: 'token' }) }))
vi.mock('@src/util/platform.util.js', () => ({ assertBuiltForThisPlatform: () => {} }))

const t = createTranslator({
  default: 'en-US',
  locales: {
    'en-US': { ping: 'Pong!' },
    id: {
      ping: 'Pong!',
      meocord: {
        dm: { error: 'Gagal menjalankan {command} di {channel} ({server}).', cooldown: '{command} di {channel} ({server}): {wait}' },
        cooldown: { wholeMinutes: 'Tunggu {minutes} menit.' },
      },
    },
  },
})

@Guard()
class Nobody implements GuardInterface {
  canActivate(): boolean {
    throw new GuardDeniedError('Members only.')
  }
}

@Catch(Error)
class Swallow implements ExceptionFilter {
  catch() {}
}

@Controller()
class Commands {
  @MessageHandler('boom')
  boom() {
    throw new Error('database down')
  }

  @MessageHandler('roll {sides:int}')
  @Cooldown({ uses: 1, seconds: 60 })
  roll() {}

  @MessageHandler('draw')
  @Cooldown({ uses: 3, seconds: 60 })
  draw() {}

  @MessageHandler('secret')
  @UseGuard(Nobody)
  secret() {}

  @MessageHandler('refuse')
  refuse() {
    throw new UserError('You have no tickets.')
  }

  @MessageHandler('caught')
  @UseFilter(Swallow)
  caught() {
    throw new Error('handled by a filter')
  }

  @MessageHandler()
  listen(message: Message) {
    if (message.content === 'listener fails') throw new Error('listener broke')
  }
}

const messages = { prefix: '!', deleteUsageRepliesAfter: 0 }

@MeoCord({ controllers: [Commands], messages, i18n: t, clientOptions: { intents: [] } })
class QuietApp {}

@MeoCord({ controllers: [Commands], messages: { ...messages, dmOnError: true, dmOnCooldown: true }, i18n: t, clientOptions: { intents: [] } })
class TellingApp {}

/** A message in #general of the server "Cat Cafe", whose language is Indonesian, or in a DM with `dm`. */
function messageOf(content: string, { dm = false } = {}) {
  const guild = dm ? null : (Object.assign(createMockGuild({ name: 'Cat Cafe' }), { preferredLocale: 'id' }) as unknown as Guild)
  const message = createMockMessage({ content, guild: guild as never })
  Object.assign(message.author, { bot: false, id: 'user-1' })
  if (!dm) Object.assign(message.channel, { name: 'general' })
  return message
}

let errors: unknown[][]
let debugs: unknown[][]
beforeEach(() => {
  errors = []
  debugs = []
  vi.spyOn(Logger.prototype, 'error').mockImplementation((...args: unknown[]) => void errors.push(args))
  vi.spyOn(Logger.prototype, 'debug').mockImplementation((...args: unknown[]) => void debugs.push(args))
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('without dmOnError or dmOnCooldown', () => {
  it('tells nobody of an error or a cooldown, and logs the error as before', async () => {
    const module = MeoCordTestingModule.fromApp(QuietApp).compile()
    const failed = messageOf('!boom')
    await expect(module.dispatch(failed)).rejects.toThrow('database down')
    const first = messageOf('!roll 6')
    await module.dispatch(first)
    const refused = messageOf('!roll 6')
    Object.assign(refused.author, { id: 'user-1' })
    await module.dispatch(refused)

    for (const message of [failed, refused]) {
      expect(message.author.send).not.toHaveBeenCalled()
      expect(message.reply).not.toHaveBeenCalled()
    }
    expect(errors).toContainEqual([expect.stringContaining('Error handling message "!boom"'), expect.objectContaining({ message: 'database down' })])
  })
})

describe('dmOnError', () => {
  it("DMs the author in the server's language, naming the command, channel and server, and still logs the error", async () => {
    const module = MeoCordTestingModule.fromApp(TellingApp).compile()
    const message = messageOf('!boom')

    await expect(module.dispatch(message)).rejects.toThrow('database down')

    expect(message.author.send).toHaveBeenCalledWith({ content: 'Gagal menjalankan !boom di #general (Cat Cafe).', allowedMentions: { parse: [] } })
    expect(message.reply).not.toHaveBeenCalled()
    expect(errors).toContainEqual([expect.stringContaining('Error handling message "!boom"'), expect.objectContaining({ message: 'database down' })])
  })

  it('logs at debug, and says nothing in the channel, when the member takes no direct messages', async () => {
    const module = MeoCordTestingModule.fromApp(TellingApp).compile()
    const message = messageOf('!boom')
    message.author.send.mockRejectedValueOnce(createDiscordError(50007, 'Cannot send messages to this user'))

    await expect(module.dispatch(message)).rejects.toThrow('database down')

    expect(debugs).toContainEqual([expect.stringContaining('they take no direct messages')])
    expect(message.reply).not.toHaveBeenCalled()
    expect(errors).toHaveLength(1)
  })

  it('logs a direct message that fails for any other reason as an error', async () => {
    const module = MeoCordTestingModule.fromApp(TellingApp).compile()
    const message = messageOf('!boom')
    message.author.send.mockRejectedValueOnce(new TypeError('no channel'))

    await expect(module.dispatch(message)).rejects.toThrow('database down')

    expect(errors).toContainEqual(['Could not send a direct message about a command:', expect.objectContaining({ message: 'no channel' })])
  })

  it('answers a command sent in a direct message there, with the fallback’s own text', async () => {
    const module = MeoCordTestingModule.fromApp(TellingApp).compile()
    const message = messageOf('!boom', { dm: true })

    await expect(module.dispatch(message)).rejects.toThrow('database down')

    expect(message.author.send).not.toHaveBeenCalled()
    expect(message.reply).toHaveBeenCalledWith({
      content: 'An error occurred while executing the command.',
      allowedMentions: { repliedUser: false, parse: [] },
    })
  })

  it('leaves an error a filter handled, and a listener’s error, untold', async () => {
    const module = MeoCordTestingModule.fromApp(TellingApp).compile()
    const caught = messageOf('!caught')
    const heard = messageOf('listener fails')

    await module.dispatch(caught)
    await expect(module.dispatch(heard)).rejects.toThrow('listener broke')

    expect(caught.author.send).not.toHaveBeenCalled()
    expect(heard.author.send).not.toHaveBeenCalled()
    expect(errors).toContainEqual([expect.stringContaining('Error handling message "listener fails"'), expect.objectContaining({ message: 'listener broke' })])
  })
})

describe('dmOnCooldown', () => {
  it('DMs once per wait, however often the author retries, and again for the next wait', async () => {
    vi.useFakeTimers({ now: 0, toFake: ['Date'] })
    const module = MeoCordTestingModule.fromApp(TellingApp).compile()
    const send = async () => {
      const message = messageOf('!roll 6')
      await module.dispatch(message)
      return message
    }

    const ran = await send()
    const retries = [await send(), await send(), await send()]
    vi.setSystemTime(61_000)
    const afterWait = await send()
    const nextWait = await send()

    expect(ran.author.send).not.toHaveBeenCalled()
    expect(afterWait.author.send).not.toHaveBeenCalled()
    expect(retries[0]!.author.send).toHaveBeenCalledWith({ content: '!roll di #general (Cat Cafe): Tunggu 1 menit.', allowedMentions: { parse: [] } })
    expect(retries[1]!.author.send).not.toHaveBeenCalled()
    expect(retries[2]!.author.send).not.toHaveBeenCalled()
    expect(nextWait.author.send).toHaveBeenCalledTimes(1)
  })

  // The wait left shrinks with each retry, so a notice counted over it would expire halfway through
  it('DMs once in a wait the author retries every second until it ends', async () => {
    vi.useFakeTimers({ now: 0, toFake: ['Date'] })
    const module = MeoCordTestingModule.fromApp(TellingApp).compile()
    const sendAt = async (ms: number) => {
      vi.setSystemTime(ms)
      const message = messageOf('!roll 6')
      await module.dispatch(message)
      return vi.mocked(message.author.send).mock.calls.length > 0 ? [ms] : []
    }

    await sendAt(0)
    const dmedAt: number[] = []
    for (let ms = 1_000; ms < 60_000; ms += 1_000) dmedAt.push(...(await sendAt(ms)))
    await sendAt(60_000)
    for (let ms = 61_000; ms < 120_000; ms += 1_000) dmedAt.push(...(await sendAt(ms)))

    expect(dmedAt).toEqual([1_000, 61_000])
  })

  // With three uses, the wait after one use comes back can end a second after the wait before it
  it('DMs again for a wait that ends a moment after the one before', async () => {
    vi.useFakeTimers({ now: 0, toFake: ['Date'] })
    const module = MeoCordTestingModule.fromApp(TellingApp).compile()
    const sendAt = async (ms: number) => {
      vi.setSystemTime(ms)
      const message = messageOf('!draw')
      await module.dispatch(message)
      return vi.mocked(message.author.send).mock.calls.length > 0 ? [ms] : []
    }

    const dmedAt: number[] = []
    // Three uses, then a refusal whose wait ends at 160 s; one use back at 160 s, then a wait that ends at 161 s
    for (const ms of [100_000, 101_000, 102_000, 103_000, 160_000, 160_500]) dmedAt.push(...(await sendAt(ms)))

    expect(dmedAt).toEqual([103_000, 160_500])
  })

  it('keeps each author’s wait to themselves', async () => {
    vi.useFakeTimers({ now: 0, toFake: ['Date'] })
    const module = MeoCordTestingModule.fromApp(TellingApp).compile()
    const by = async (id: string) => {
      const message = messageOf('!roll 6')
      Object.assign(message.author, { id })
      await module.dispatch(message)
      return message
    }

    await by('user-1')
    await by('user-2')
    const first = await by('user-1')
    const second = await by('user-2')

    expect(first.author.send).toHaveBeenCalledTimes(1)
    expect(second.author.send).toHaveBeenCalledTimes(1)
  })
})

describe('with both on, what was answered before', () => {
  it('still answers a guard, a usage error and a UserError in the channel, and DMs none of them', async () => {
    const module = MeoCordTestingModule.fromApp(TellingApp).compile()
    const denied = messageOf('!secret')
    const misused = messageOf('!roll lots')
    const refused = messageOf('!refuse')

    await module.dispatch(denied)
    await module.dispatch(misused)
    await module.dispatch(refused)

    for (const message of [denied, misused, refused]) {
      expect(message.author.send).not.toHaveBeenCalled()
      expect(message.reply).toHaveBeenCalledTimes(1)
    }
    expect(refused.reply).toHaveBeenCalledWith({ content: 'You have no tickets.', allowedMentions: { repliedUser: false } })
  })
})

describe('in a running bot', () => {
  it('DMs an error, and a cooldown once per wait, through the bot’s own store', async () => {
    vi.useFakeTimers({ now: 0, toFake: ['Date'] })
    const clients: Client[] = []
    vi.spyOn(Client.prototype, 'login').mockImplementation(function (this: Client) {
      clients.push(this)
      return Promise.resolve('token')
    })
    await MeoCordFactory.create(TellingApp).start()
    const client = clients[0]!
    Object.defineProperty(client, 'user', { value: { id: '111', setActivity: () => {} }, configurable: true })
    const send = async (content: string) => {
      const message = messageOf(content)
      Object.defineProperty(message, 'client', { value: client })
      await Promise.all(client.rawListeners('messageCreate').map(listener => (listener as (m: unknown) => unknown)(message)))
      return message
    }

    const failed = await send('!boom')
    await send('!roll 6')
    const refused = [await send('!roll 6'), await send('!roll 6')]

    await vi.waitFor(() => expect(failed.author.send).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(refused[0]!.author.send).toHaveBeenCalledTimes(1))
    expect(refused[1]!.author.send).not.toHaveBeenCalled()
  })
})

describe('the options', () => {
  it('take true or false', () => {
    expect(() => {
      @MeoCord({ controllers: [], messages: { dmOnError: 'yes' as never }, clientOptions: { intents: [] } })
      class Wrong {}
      return Wrong
    }).toThrow('Wrong: @MeoCord({ messages: { dmOnError } }) takes true or false.')
  })
})
