import { vi } from 'vitest'
import { Client, type GuildMember, type Message } from 'discord.js'
import {
  Catch,
  Controller,
  Cooldown,
  Guard,
  Interceptor,
  MeoCord,
  MessageHandler,
  On,
  UseGuard,
  UseInterceptor,
  Validate,
} from '@src/decorator/index.js'
import { MeoCordFactory } from '@src/core/meocord-factory.js'
import { type ExecutionContext, GuardDeniedError, MessageUsageError } from '@src/common/index.js'
import {
  type CallHandler,
  type ExceptionFilter,
  type GuardInterface,
  type InterceptorInterface,
  type EntityRef,
  type MessageCommandOptions,
  type ParamRefsOf,
  type StandardSchemaV1,
} from '@src/interface/index.js'
import { createMockGuild, createMockMessage } from '@src/testing/index.js'

const { logged } = vi.hoisted(() => ({ logged: { error: [] as unknown[][], warn: [] as unknown[][] } }))

vi.mock('@src/common/index.js', async importOriginal => ({
  ...(await importOriginal<object>()),
  Logger: class {
    log = vi.fn()
    debug = vi.fn()
    info = vi.fn()
    verbose = vi.fn()
    error = (...args: unknown[]) => logged.error.push(args)
    warn = (...args: unknown[]) => logged.warn.push(args)
  },
}))
vi.mock('@src/util/meocord-config-loader.util.js', () => ({ loadMeoCordConfig: () => ({ discordToken: 'token' }) }))
vi.mock('@src/util/platform.util.js', () => ({ assertBuiltForThisPlatform: () => {} }))

const BOT_ID = '111'
const calls: [string, ...unknown[]][] = []

/** Starts an app built by the factory, logged in as a bot with id {@link BOT_ID}, without a network. */
async function startApp(options: { controllers: any[]; messages?: MessageCommandOptions; filters?: any[] }): Promise<Client> {
  const clients: Client[] = []
  vi.spyOn(Client.prototype, 'login').mockImplementation(function (this: Client) {
    clients.push(this)
    return Promise.resolve('token')
  })

  @MeoCord({ ...options, clientOptions: { intents: [] } })
  class App {}

  await MeoCordFactory.create(App).start()
  const [client] = clients
  Object.defineProperty(client, 'user', { value: { id: BOT_ID, setActivity: () => {} }, configurable: true })
  return client
}

/** Sends a message with this content and waits for every handler it reaches. */
async function send(client: Client, content: string, author = { bot: false, id: 'user-1' }): Promise<Message> {
  const message = createMockMessage({ content })
  Object.assign(message.author, author)
  await Promise.all(client.rawListeners('messageCreate').map(listener => (listener as (m: unknown) => unknown)(message)))
  return message
}

function schema<Output>(check: (input: Record<string, unknown>) => Output | undefined): StandardSchemaV1<unknown, Output> {
  return {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: value => {
        const output = check(value as Record<string, unknown>)
        return output === undefined ? { issues: [{ message: 'Invalid', path: ['sides'] }] } : { value: output }
      },
    },
  }
}

const dice = schema<{ sides: number; note?: string }>(({ sides, note }) => {
  const count = Number(sides)
  return Number.isInteger(count) && count > 1 ? { sides: count, note: note as string | undefined } : undefined
})

@Interceptor()
class ParamsRecorder implements InterceptorInterface {
  async intercept(context: ExecutionContext, next: CallHandler) {
    calls.push(['before', context.getHandlerParams()])
    const result = await next.handle()
    calls.push(['after', context.getHandlerParams(), context.getArgs()[1]])
    return result
  }
}

@Controller()
class DiceController {
  @MessageHandler('roll {sides} {note...?}')
  @Validate(dice)
  async roll(_message: Message, params: { sides: number; note?: string }) {
    calls.push(['roll', params])
  }

  @MessageHandler('roll 20')
  async rollTwenty(_message: Message, params: Record<string, string>) {
    calls.push(['rollTwenty', params])
  }

  @MessageHandler('hello', { prefix: false })
  async hello() {
    calls.push(['hello'])
  }

  @MessageHandler('ping')
  async ping() {
    calls.push(['ping'])
  }
}

@Controller()
class ListenerController {
  @MessageHandler()
  async everything(message: Message) {
    calls.push(['listener', message.content])
  }
}

beforeEach(() => {
  calls.length = 0
  logged.error.length = 0
  logged.warn.length = 0
})

afterEach(() => vi.restoreAllMocks())

describe('message commands', () => {
  it('runs only the most specific matching handler, across controllers, then every listener', async () => {
    const client = await startApp({ controllers: [ListenerController, DiceController], messages: { prefix: '!' } })

    await send(client, '!roll 20')
    expect(calls).toEqual([['rollTwenty', {}], ['listener', '!roll 20']])

    calls.length = 0
    await send(client, '!ROLL 6 for luck')
    expect(calls).toEqual([['roll', { sides: 6, note: 'for luck' }], ['listener', '!ROLL 6 for luck']])
  })

  it('still ignores messages from bots and empty messages, listeners included', async () => {
    const client = await startApp({ controllers: [ListenerController, DiceController], messages: { prefix: '!' } })

    await send(client, '!roll 20', { bot: true, id: 'bot-2' })
    await send(client, '   ')
    expect(calls).toEqual([])
  })

  it('applies a configured prefix to a plain keyword, unless the handler sets prefix: false', async () => {
    const client = await startApp({ controllers: [DiceController], messages: { prefix: '!' } })

    await send(client, 'ping')
    await send(client, '!hello')
    expect(calls).toEqual([])

    await send(client, '!ping')
    await send(client, 'Hello')
    expect(calls).toEqual([['ping'], ['hello']])
  })

  it("runs every handler when one sets its own prefix to '', none", async () => {
    @Controller()
    class Unprefixed {
      @MessageHandler('echo {text...}', { prefix: '' })
      echo(_message: Message, { text }: { text: string }) {
        calls.push(['echo', text])
      }
    }
    const client = await startApp({ controllers: [DiceController, Unprefixed], messages: { prefix: '!' } })

    await send(client, '!ping')
    await send(client, 'echo hi')
    expect(calls).toEqual([['ping'], ['echo', 'hi']])
    expect(logged.error).toEqual([])
  })

  it("takes a mention of the bot as a start when every handler has its own prefix, and prefers a handler whose scope fits", async () => {
    @Controller()
    class OwnPrefixed {
      @MessageHandler('ping', { prefix: '?' })
      ping() {
        calls.push(['ping'])
      }

      @MessageHandler('config {key}', { prefix: '?', scope: 'dm' })
      personal(_message: Message, { key }: { key: string }) {
        calls.push(['personal', key])
      }

      @MessageHandler('config {words...}', { prefix: '?' })
      server(_message: Message, { words }: { words: string }) {
        calls.push(['server', words])
      }
    }
    const prefix = vi.fn(() => '!')
    const client = await startApp({ controllers: [OwnPrefixed], messages: { prefix, mention: true } })

    await send(client, `<@${BOT_ID}> ping`)
    await send(client, '?config volume')
    expect(calls).toEqual([['ping'], ['server', 'volume']])
    // No handler uses the app's prefixes, so they are never read
    expect(prefix).not.toHaveBeenCalled()
  })

  it('matches keywords as the whole message, without a prefix, when none is configured', async () => {
    const client = await startApp({ controllers: [DiceController] })

    await send(client, 'PING')
    await send(client, 'ping now')
    expect(calls).toEqual([['ping']])
  })

  it('keeps literal words case-sensitive when the app asks', async () => {
    const client = await startApp({ controllers: [DiceController], messages: { prefix: '!', caseSensitive: true } })

    await send(client, '!PING')
    await send(client, '!ping')
    expect(calls).toEqual([['ping']])
  })

  it('reads the prefixes from a function of the message, which may be async', async () => {
    const prefix = vi.fn(async (message: Message) => (message.guildId === 'g1' ? ['?', '$'] : '!'))
    const client = await startApp({ controllers: [DiceController], messages: { prefix } })

    const inGuild = createMockMessage({ content: '$ping' })
    Object.assign(inGuild, { guildId: 'g1' })
    Object.assign(inGuild.author, { bot: false })
    await Promise.all(client.rawListeners('messageCreate').map(listener => (listener as (m: unknown) => unknown)(inGuild)))
    expect(prefix).toHaveBeenCalledWith(inGuild)

    await send(client, '!ping')
    expect(calls).toEqual([['ping'], ['ping']])
  })

  it('hands a failing prefix function to the global filters, and runs no handler', async () => {
    const failure = new Error('settings are down')
    const caught: unknown[] = []

    @Catch()
    class Recorder implements ExceptionFilter {
      catch(error: unknown) {
        caught.push(error)
      }
    }

    const client = await startApp({
      controllers: [DiceController],
      messages: {
        prefix: () => {
          throw failure
        },
      },
      filters: [Recorder],
    })

    await send(client, '!ping')
    expect(caught).toEqual([failure])
    expect(calls).toEqual([])
  })

  it('treats a message no pattern matches as ordinary chat: no error, no warning, nothing for the filters', async () => {
    const caught: unknown[] = []

    @Catch()
    class Recorder implements ExceptionFilter {
      catch(error: unknown) {
        caught.push(error)
      }
    }

    const client = await startApp({ controllers: [DiceController], messages: { prefix: '!' }, filters: [Recorder] })
    // Only what the messages cause, not the startup warning about intents
    logged.warn.length = 0

    await send(client, '!unknown command')
    await send(client, 'just chatting')
    expect([calls, caught, logged.error, logged.warn]).toEqual([[], [], [], []])
  })

  it('accepts a mention of the bot in place of the prefix when mention is on', async () => {
    const client = await startApp({ controllers: [DiceController], messages: { prefix: '!', mention: true } })

    await send(client, `<@${BOT_ID}> ping`)
    await send(client, `<@!${BOT_ID}>ping`)
    await send(client, '<@999> ping')
    expect(calls).toEqual([['ping'], ['ping']])
  })

  it("starts every command with a mention alone under mention: 'only', never the message as it is", async () => {
    const client = await startApp({ controllers: [DiceController], messages: { mention: 'only' } })

    await send(client, `<@${BOT_ID}> ping`)
    await send(client, 'ping')
    await send(client, '!ping')
    await send(client, `<@!${BOT_ID}> roll 6`)
    expect(calls).toEqual([['ping'], ['roll', { sides: 6, note: undefined }]])
  })

  it("starts a handler with mention: 'only' by a mention alone, beside the app's prefix and whatever its mention", async () => {
    @Controller()
    class Split {
      @MessageHandler('status', { mention: 'only' })
      async status() {
        calls.push(['status'])
      }

      @MessageHandler('ping')
      async ping() {
        calls.push(['ping'])
      }
    }
    const client = await startApp({ controllers: [Split], messages: { prefix: '!' } })

    await send(client, `<@${BOT_ID}> status`)
    await send(client, '!status')
    await send(client, 'status')
    await send(client, '!ping')
    // The app accepts no mention, so the prefixed handler takes none
    await send(client, `<@${BOT_ID}> ping`)
    expect(calls).toEqual([['status'], ['ping']])
  })

  it('validates message params and shows them to every stage through getHandlerParams', async () => {
    @Controller()
    class Recorded {
      @MessageHandler('roll {sides}')
      @UseInterceptor(ParamsRecorder)
      @Validate(dice)
      async roll(_message: Message, params: { sides: number }) {
        calls.push(['roll', params])
      }
    }
    const client = await startApp({ controllers: [Recorded] })

    await send(client, 'roll 6')
    expect(calls).toEqual([
      ['before', { sides: '6' }],
      ['roll', { sides: 6, note: undefined }],
      ['after', { sides: 6, note: undefined }, { sides: 6, note: undefined }],
    ])

    calls.length = 0
    await send(client, 'roll lots')
    expect(calls.map(([name]) => name)).toEqual(['before'])
  })

  it('counts a cooldown apart by a message param', async () => {
    @Controller()
    class Cooled {
      @MessageHandler('vote {option}')
      @Cooldown({ seconds: 60, by: (_context, { option }: { option: string }) => option })
      async vote(_message: Message, { option }: { option: string }) {
        calls.push(['vote', option])
      }
    }
    const client = await startApp({ controllers: [Cooled] })

    await send(client, 'vote a')
    await send(client, 'vote a')
    await send(client, 'vote b')
    expect(calls).toEqual([
      ['vote', 'a'],
      ['vote', 'b'],
    ])
  })
})

describe('message command startup errors', () => {
  const create = (...controllers: any[]) => {
    @MeoCord({ controllers, clientOptions: { intents: [] } })
    class App {}
    return () => MeoCordFactory.create(App)
  }

  it('refuses a pattern that cannot be read, naming the handler', () => {
    @Controller()
    class Broken {
      @MessageHandler('say {text...} now')
      say() {}
    }
    expect(create(Broken)).toThrow(/Broken\.say.*\{text\.\.\.\} takes the rest of the message, so it must be last/)
  })

  it('refuses two handlers whose patterns match the same messages', () => {
    @Controller()
    class First {
      @MessageHandler('roll {sides}')
      roll() {}
    }
    @Controller()
    class Second {
      @MessageHandler('roll {count}')
      roll() {}
    }
    expect(create(First, Second)).toThrow(/match the same messages/)
  })

  it('refuses a messages option of the wrong type where the app is declared', () => {
    const declare = (messages: unknown) => () =>
      MeoCord({ controllers: [], clientOptions: { intents: [] }, messages: messages as MessageCommandOptions })(class App {})

    expect(declare({ prefix: 1 })).toThrow('@MeoCord({ messages: { prefix } }) takes a string, a list of strings, or a function')
    expect(declare({ prefix: ['!', 2] })).toThrow('@MeoCord({ messages: { prefix } })')
    expect(declare({ mention: 'yes' })).toThrow("@MeoCord({ messages: { mention } }) takes true, false or 'only'.")
    expect(declare({ mention: 'only', prefix: '!' })).toThrow("has mention: 'only', which starts every command with a mention, and a prefix")
    expect(declare({ prefix: ['!', '?'], mention: true, caseSensitive: false })).not.toThrow()
    expect(declare({ mention: 'only' })).not.toThrow()
  })

  it('still refuses @Validate on a listener, which has no params', () => {
    @Controller()
    class Listening {
      @MessageHandler()
      @Validate(dice)
      all() {}
    }
    expect(create(Listening)).toThrow(/Listening\.all is a message handler without a pattern/)
  })
})

describe('typed message params and usage replies', () => {
  const TARGET = '200000000000000001'
  const target = { id: TARGET, user: { id: TARGET } } as unknown as GuildMember
  const seen: unknown[] = []

  @Guard()
  class SeesParams implements GuardInterface {
    canActivate(_message: Message, params: Record<string, unknown>) {
      seen.push(['guard', params])
      return true
    }
  }

  @Controller()
  class Economy {
    @MessageHandler('pay {to:member} {amount:int} {note...?}')
    @UseGuard(SeesParams)
    @Validate(
      schema<{ to: GuildMember; amount: number; note?: string }>(({ to, amount, note }) =>
        (amount as number) > 0 ? { to: to as GuildMember, amount: amount as number, note: note as string | undefined } : undefined,
      ),
    )
    async pay(_message: Message, params: { to: GuildMember; amount: number; note?: string }) {
      seen.push(['pay', params])
    }
  }

  @Controller()
  class Moderation {
    @MessageHandler('ban {target:member} {duration:duration?} {reason...?}')
    async ban(_message: Message, params: { target: GuildMember; duration?: number; reason?: string }) {
      seen.push(['ban', params])
    }

    @MessageHandler('slowmode {mode:on|off?} {seconds:int?}')
    async slowmode(_message: Message, params: { mode?: 'on' | 'off'; seconds?: number }) {
      seen.push(['slowmode', params])
    }
  }

  @Controller()
  class Places {
    @MessageHandler('settings {key}', { aliases: ['cfg'], scope: 'guild' })
    async settings(_message: Message, params: { key: string }) {
      seen.push(['settings', params])
    }

    @MessageHandler('inbox', { scope: 'dm' })
    async inbox() {
      seen.push(['inbox'])
    }
  }

  @Controller()
  class Cleanup {
    @MessageHandler('purge {count:int} {--bots} {--from:member?}')
    async purge(_message: Message, params: { count: number; bots: boolean; from?: GuildMember }) {
      seen.push(['purge', params])
    }

    @MessageHandler('poll {question} {options:string...}')
    async poll(_message: Message, params: { question: string; options: string[] }) {
      seen.push(['poll', params])
    }
  }

  /** Sends a message in a guild whose member cache holds the target, and waits for dispatch. */
  async function sendIn(client: Client, content: string, guild: ReturnType<typeof createMockGuild> | null = createMockGuild({ members: [target] })) {
    const message = createMockMessage({ content, guild })
    Object.assign(message.author, { bot: false, id: 'user-1' })
    await Promise.all(client.rawListeners('messageCreate').map(listener => (listener as (m: unknown) => unknown)(message)))
    return message
  }

  /** The reply dispatch sent, and whether it has been deleted. */
  async function replyOf(message: Message) {
    const sent = vi.mocked(message.reply).mock.results[0]?.value as Promise<Message & { deleted: boolean }> | undefined
    return sent && (await sent)
  }

  beforeEach(() => {
    seen.length = 0
  })

  afterEach(() => vi.useRealTimers())

  it('reads typed params before the guards, which see a member as a ref, and gives the handler the member', async () => {
    const client = await startApp({ controllers: [Economy], messages: { prefix: '!' } })

    await sendIn(client, `!pay <@${TARGET}> 25 for lunch`)

    const [[, inGuard], paid] = seen as [string, { to: EntityRef<GuildMember>; amount: number; note: string }][]
    expect(inGuard.to.id).toBe(TARGET)
    expect(inGuard.to.cached).toBe(target)
    expect({ amount: inGuard.amount, note: inGuard.note }).toEqual({ amount: 25, note: 'for lunch' })
    expect(paid).toEqual(['pay', { to: target, amount: 25, note: 'for lunch' }])
  })

  it('fetches nothing from Discord for a caller the guards deny, or one on cooldown, however many IDs they name', async () => {
    @Guard()
    class Deny implements GuardInterface {
      canActivate(): boolean {
        return false
      }
    }
    @Controller()
    class Lookups {
      @MessageHandler('whois {users:user...}')
      @UseGuard(Deny)
      async whois() {
        seen.push(['whois'])
      }

      @MessageHandler('lock {channels:channel...}')
      @UseGuard(Deny)
      async lock() {
        seen.push(['lock'])
      }

      @MessageHandler('kick {targets:member...}')
      @UseGuard(Deny)
      async kick() {
        seen.push(['kick'])
      }

      @MessageHandler('find {users:user...}')
      @Cooldown({ seconds: 60 })
      async find() {
        seen.push(['find'])
      }
    }
    const client = await startApp({ controllers: [Lookups], messages: { prefix: '!', deleteUsageRepliesAfter: 0 } })
    const ids = Array.from({ length: 50 }, (_, i) => String(300000000000000000n + BigInt(i))).join(' ')
    const guild = createMockGuild()

    const whois = await sendIn(client, `!whois ${ids}`, guild)
    await sendIn(client, `!lock ${ids}`, guild)
    await sendIn(client, `!kick ${ids}`, guild)
    const first = await sendIn(client, `!find ${ids.split(' ')[0]}`, guild)
    const again = await sendIn(client, `!find ${ids}`, guild)

    expect(vi.mocked(whois.client.users.fetch)).not.toHaveBeenCalled()
    expect(guild.channels.fetch).not.toHaveBeenCalled()
    expect(guild.members.fetch).not.toHaveBeenCalled()
    // The first find is let through and fetches its one user; the second is refused before fetching any
    expect(vi.mocked(first.client.users.fetch)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(again.client.users.fetch)).not.toHaveBeenCalled()
    expect(seen).toEqual([['find']])
  })

  it("shares one request between a guard's resolve() and the fetch after it", async () => {
    const user = { id: '400000000000000001' }
    @Guard()
    class LooksFirst implements GuardInterface {
      async canActivate(_message: Message, { who }: ParamRefsOf<'whois {who:user}'>) {
        return (await who.resolve())?.id === user.id
      }
    }
    @Controller()
    class Whois {
      @MessageHandler('whois {who:user}')
      @UseGuard(LooksFirst)
      async whois(_message: Message, { who }: { who: unknown }) {
        seen.push(['whois', who])
      }
    }
    const client = await startApp({ controllers: [Whois], messages: { prefix: '!' } })
    const message = createMockMessage({ content: `!whois ${user.id}`, guild: createMockGuild() })
    Object.assign(message.author, { bot: false, id: 'user-1' })
    vi.mocked(message.client.users.fetch).mockResolvedValue(user as never)

    await Promise.all(client.rawListeners('messageCreate').map(listener => (listener as (m: unknown) => unknown)(message)))

    expect(seen).toEqual([['whois', user]])
    expect(vi.mocked(message.client.users.fetch)).toHaveBeenCalledTimes(1)
  })

  it('gives each trailing optional param a word that fits its type, and leaves one out when none does', async () => {
    const client = await startApp({ controllers: [Moderation], messages: { prefix: '!', deleteUsageRepliesAfter: 0 } })

    await sendIn(client, `!ban <@${TARGET}> spamming`)
    await sendIn(client, `!ban <@${TARGET}> 7d spamming links`)
    await sendIn(client, `!ban ${TARGET}`)
    await sendIn(client, '!slowmode OFF')
    await sendIn(client, '!slowmode 30')
    const wrong = await sendIn(client, '!slowmode soon')

    expect(seen).toEqual([
      ['ban', { target, reason: 'spamming' }],
      ['ban', { target, duration: 604_800_000, reason: 'spamming links' }],
      ['ban', { target }],
      ['slowmode', { mode: 'off' }],
      ['slowmode', { seconds: 30 }],
    ])
    expect(wrong.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Usage: !slowmode [mode] [seconds]\nseconds: "soon" is not a whole number' }),
    )
  })

  it('gives a handler its flags from anywhere in the message, and its typed lists', async () => {
    const client = await startApp({ controllers: [Cleanup], messages: { prefix: '!', deleteUsageRepliesAfter: 0 } })

    await sendIn(client, `!purge --from=<@${TARGET}> 20 --bots`)
    await sendIn(client, '!purge 5')
    await sendIn(client, '!poll "Lunch today?" pizza "fried rice"')
    const unknown = await sendIn(client, '!purge 5 --all')

    expect(seen).toEqual([
      ['purge', { count: 20, bots: true, from: target }],
      ['purge', { count: 5, bots: false }],
      ['poll', { question: 'Lunch today?', options: ['pizza', 'fried rice'] }],
    ])
    expect(unknown.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Usage: !purge <count> [--bots] [--from=<from>]\n--all is not an option of this command' }),
    )
  })

  it('runs a command by its alias, and answers a misused alias with the usage as typed', async () => {
    const client = await startApp({ controllers: [Places], messages: { prefix: '!', deleteUsageRepliesAfter: 0 } })

    await sendIn(client, '!cfg lang')
    const bare = await sendIn(client, '!CFG')

    expect(seen).toEqual([['settings', { key: 'lang' }]])
    expect(bare.reply).toHaveBeenCalledWith(expect.objectContaining({ content: 'Usage: !cfg <key>\nkey is missing' }))
  })

  it('answers a command sent where its scope says it does not work, before any other usage issue', async () => {
    const client = await startApp({ controllers: [Places], messages: { prefix: '!', deleteUsageRepliesAfter: 0 } })

    const guildOnly = await sendIn(client, '!settings', null)
    const dmOnly = await sendIn(client, '!inbox')
    await sendIn(client, '!settings lang')
    await sendIn(client, '!inbox', null)

    expect(guildOnly.reply).toHaveBeenCalledWith(expect.objectContaining({ content: 'This command works in a server only.' }))
    expect(dmOnly.reply).toHaveBeenCalledWith(expect.objectContaining({ content: 'This command works in direct messages only.' }))
    expect(seen).toEqual([['settings', { key: 'lang' }], ['inbox']])
  })

  it('runs the handler whose scope fits where the message was sent, before one of another scope', async () => {
    @Controller()
    class Scoped {
      @MessageHandler('config {key}', { scope: 'dm' })
      async personal(_message: Message, params: { key: string }) {
        seen.push(['personal', params])
      }

      @MessageHandler('config {words...}')
      async server(_message: Message, params: { words: string }) {
        seen.push(['server', params])
      }

      @MessageHandler('help', { scope: 'guild' })
      async guildHelp() {
        seen.push(['guildHelp'])
      }

      @MessageHandler('help', { scope: 'dm' })
      async dmHelp() {
        seen.push(['dmHelp'])
      }
    }
    const client = await startApp({ controllers: [Scoped], messages: { prefix: '!', deleteUsageRepliesAfter: 0 } })

    const inServer = await sendIn(client, '!config volume')
    await sendIn(client, '!config volume', null)
    await sendIn(client, '!help')
    await sendIn(client, '!help', null)

    expect(seen).toEqual([['server', { words: 'volume' }], ['personal', { key: 'volume' }], ['guildHelp'], ['dmHelp']])
    expect(inServer.reply).not.toHaveBeenCalled()
  })

  it('stays quiet about scope when the message used no prefix', async () => {
    const client = await startApp({ controllers: [Places], messages: { deleteUsageRepliesAfter: 0 } })

    const message = await sendIn(client, 'inbox')

    expect(message.reply).not.toHaveBeenCalled()
    expect(seen).toEqual([])
  })

  it("answers a guard's reason and a validation failure with a reply it deletes, as it does the usage", async () => {
    vi.useFakeTimers()
    @Guard()
    class ModeratorsOnly implements GuardInterface {
      canActivate(): boolean {
        throw new GuardDeniedError('Only moderators can do that.')
      }
    }
    @Controller()
    class Guarded {
      @MessageHandler('purge {count:int}')
      @UseGuard(ModeratorsOnly)
      async purge() {
        seen.push(['purge'])
      }
    }
    const client = await startApp({ controllers: [Economy, Guarded], messages: { prefix: '!', deleteUsageRepliesAfter: 2 } })

    const denied = await sendIn(client, '!purge 5')
    const invalid = await sendIn(client, `!pay <@${TARGET}> 0`)

    expect(denied.reply).toHaveBeenCalledWith({ content: 'Only moderators can do that.', allowedMentions: { repliedUser: false, parse: [] } })
    expect(invalid.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Invalid') }))
    expect(logged.error).toEqual([])
    const replies = await Promise.all([replyOf(denied), replyOf(invalid)])
    await vi.advanceTimersByTimeAsync(2_000)
    expect(replies.map(reply => reply!.deleted)).toEqual([true, true])
    expect(seen.filter(entry => ['purge', 'pay'].includes((entry as string[])[0]))).toEqual([])
  })

  it('answers nothing, and logs no error, when a guard refuses a message listener', async () => {
    @Guard()
    class OnlyInGeneral implements GuardInterface {
      canActivate(): boolean {
        throw new GuardDeniedError('Only in #general.')
      }
    }
    @Controller()
    class Listeners {
      @MessageHandler()
      @UseGuard(OnlyInGeneral)
      async everything() {
        seen.push(['everything'])
      }

      @On('messageCreate')
      @UseGuard(OnlyInGeneral)
      async watch() {
        seen.push(['watch'])
      }
    }
    const client = await startApp({ controllers: [Listeners], messages: { prefix: '!', deleteUsageRepliesAfter: 0 } })

    const message = await sendIn(client, 'just chatting')
    await Promise.all(client.rawListeners('messageCreate').map(listener => (listener as (m: unknown) => unknown)(message)))

    expect(message.reply).not.toHaveBeenCalled()
    expect(logged.error).toEqual([])
    expect(seen).toEqual([])
  })

  it('answers a word of the wrong type with the usage, and deletes the answer after 10 seconds', async () => {
    vi.useFakeTimers()
    const client = await startApp({ controllers: [Economy], messages: { prefix: '!' } })

    const message = await sendIn(client, `!pay <@${TARGET}> lots`)
    const reply = await replyOf(message)

    expect(seen).toEqual([])
    expect(message.reply).toHaveBeenCalledWith({
      content: 'Usage: !pay <to> <amount> [note…]\namount: "lots" is not a whole number',
      allowedMentions: { repliedUser: false, parse: [] },
    })
    await vi.advanceTimersByTimeAsync(9_999)
    expect(reply!.deleted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(reply!.deleted).toBe(true)
  })

  it('answers a command left without its params, naming what is missing', async () => {
    const client = await startApp({ controllers: [Economy], messages: { prefix: '!', deleteUsageRepliesAfter: 0 } })

    const message = await sendIn(client, `!PAY <@${TARGET}>`)

    expect(message.reply).toHaveBeenCalledWith(expect.objectContaining({ content: 'Usage: !pay <to> <amount> [note…]\namount is missing' }))
    await vi.waitFor(async () => expect((await replyOf(message))!.deleted).toBe(false))
  }, 10_000)

  it('keeps a usage reply when told 0, and only logs a reply it could not delete', async () => {
    vi.useFakeTimers()
    const client = await startApp({ controllers: [Economy], messages: { prefix: '!', deleteUsageRepliesAfter: 2 } })

    const message = await sendIn(client, `!pay <@${TARGET}> 0.5`)
    const reply = await replyOf(message)
    vi.mocked(reply!.delete).mockRejectedValue(new Error('Missing Permissions'))
    await vi.advanceTimersByTimeAsync(2_000)

    expect(reply!.delete).toHaveBeenCalledTimes(1)
    expect(logged.error).toEqual([])
  })

  it('says a command with a member param works in a server only, when sent in a DM', async () => {
    const client = await startApp({ controllers: [Economy], messages: { prefix: '!', deleteUsageRepliesAfter: 0 } })

    const message = await sendIn(client, `!pay <@${TARGET}> 5`, null)

    expect(message.reply).toHaveBeenCalledWith(expect.objectContaining({ content: 'This command works in a server only.' }))
    expect(seen).toEqual([])
  })

  it('stays quiet when the message used no prefix, as chat that begins with a command word', async () => {
    const client = await startApp({ controllers: [Economy], messages: { deleteUsageRepliesAfter: 0 } })

    const typo = await sendIn(client, `pay <@${TARGET}> lots`)
    const short = await sendIn(client, 'pay')

    expect(typo.reply).not.toHaveBeenCalled()
    expect(short.reply).not.toHaveBeenCalled()
    expect(logged.error).toEqual([])
  })

  it('lets an exception filter answer a usage error instead', async () => {
    const caught: unknown[] = []

    @Catch(MessageUsageError)
    class UsageFilter implements ExceptionFilter<MessageUsageError> {
      catch(error: MessageUsageError) {
        caught.push(error.usage)
      }
    }

    const client = await startApp({ controllers: [Economy], messages: { prefix: '!' }, filters: [UsageFilter] })
    const message = await sendIn(client, `!pay <@${TARGET}> lots`)

    expect(caught).toEqual(['!pay <to> <amount> [note…]'])
    expect(message.reply).not.toHaveBeenCalled()
  })
})
