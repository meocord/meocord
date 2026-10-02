import { vi } from 'vitest'
import { Client, type Message } from 'discord.js'
import { Controller, Guard, MeoCord, MessageHandler, Service, UseGuard } from '@src/decorator/index.js'
import { MeoCordFactory } from '@src/core/meocord-factory.js'
import { HandlerRegistry } from '@src/core/handler-registry.js'
import { splitReply } from '@src/core/message-help.js'
import {
  type GuardInterface,
  type MessageCommandOptions,
  type MessageHelp,
  type PresentedError,
  type ResponseContext,
  type ResponsePresenter,
} from '@src/interface/index.js'
import { createMockMessage, MeoCordTestingModule, resolveRoute } from '@src/testing/index.js'
import { GuardDeniedError } from '@src/common/index.js'

const { logged } = vi.hoisted(() => ({ logged: { warn: [] as unknown[][] } }))

vi.mock('@src/common/index.js', async importOriginal => ({
  ...(await importOriginal<object>()),
  Logger: class {
    log = vi.fn()
    debug = vi.fn()
    info = vi.fn()
    verbose = vi.fn()
    error = vi.fn()
    warn = (...args: unknown[]) => logged.warn.push(args)
  },
}))
vi.mock('@src/util/meocord-config-loader.util.js', () => ({ loadMeoCordConfig: () => ({ discordToken: 'token' }) }))
vi.mock('@src/util/platform.util.js', () => ({ assertBuiltForThisPlatform: () => {} }))

const BOT_ID = '111'

/** Starts an app built by the factory, logged in as a bot with id {@link BOT_ID}, without a network. */
async function startApp(options: {
  controllers: any[]
  messages?: MessageCommandOptions
  presenter?: new () => ResponsePresenter
  guards?: (new () => GuardInterface)[]
  services?: any[]
}): Promise<Client> {
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

/** Sends a message with this content, in a server unless `dm`, and waits for every handler it reaches. */
async function send(client: Client, content: string, { dm = false } = {}): Promise<Message> {
  const message = createMockMessage({ content, ...(dm && { guild: null }) })
  Object.assign(message.author, { bot: false, id: 'user-1' })
  await Promise.all(client.rawListeners('messageCreate').map(listener => (listener as (m: unknown) => unknown)(message)))
  return message
}

/** The text of every reply a message got, in order. */
const replies = (message: Message) =>
  vi.mocked(message.reply).mock.calls.map(([sent]) => (typeof sent === 'string' ? sent : (sent as { content?: string }).content))

@Guard()
class StaffOnly implements GuardInterface {
  canActivate() {
    return false
  }
}

@Controller()
class Moderation {
  @MessageHandler('mute {target:member} {duration:duration?} {reason...?}', {
    aliases: ['m'],
    description: 'Times a member out.',
    scope: 'guild',
  })
  mute() {}

  @MessageHandler('purge {count:int} {--bots}')
  purge() {}

  @MessageHandler('config get {key}', { description: 'Reads a setting.' })
  get() {}

  @MessageHandler('config set {key} {value...}', { description: 'Changes a setting.' })
  set() {}

  @MessageHandler('config reset-db', { description: 'Wipes the database.' })
  @UseGuard(StaffOnly)
  reset() {}

  @MessageHandler('secret', { hidden: true, description: 'An easter egg.' })
  secret() {}
}

const HELP = { prefix: '!', help: true } satisfies MessageCommandOptions

beforeEach(() => {
  logged.warn.length = 0
})

describe('the built-in help', () => {
  it('lists what the caller can use, once per handler, with its description, leaving out guarded and hidden ones', async () => {
    const client = await startApp({ controllers: [Moderation], messages: HELP })

    expect(replies(await send(client, '!help'))).toEqual([
      [
        'Commands:',
        '!config get <key> — Reads a setting.',
        '!config set <key> <value…> — Changes a setting.',
        '!mute <target> [duration] [reason…] — Times a member out.',
        '!purge <count> [--bots]',
        "Type !help <command> for one command's usage.",
      ].join('\n'),
    ])
  })

  it('describes one command, by its words or an alias, with its params, aliases and where it works', async () => {
    const client = await startApp({ controllers: [Moderation], messages: HELP })
    const mute = [
      'Usage: !mute <target> [duration] [reason…]',
      'Times a member out.',
      'target: member · duration (optional): length of time, such as 10m · reason (optional): text',
      'Also: !m',
      'Works in servers only.',
    ].join('\n')

    expect(replies(await send(client, '!help mute'))).toEqual([mute])
    expect(replies(await send(client, '!help M'))).toEqual([mute])
    expect(replies(await send(client, '!help purge'))).toEqual(['Usage: !purge <count> [--bots]\ncount: whole number · --bots (optional): on when given'])
  })

  it('answers a query typed as an example by the command its leading words name, and lists other spellings', async () => {
    @Controller()
    class Cards {
      @MessageHandler('card show {id}')
      @MessageHandler('card view {id}')
      show() {}
    }
    const client = await startApp({ controllers: [Moderation, Cards], messages: HELP })

    expect(replies(await send(client, '!help purge 5'))).toEqual(['Usage: !purge <count> [--bots]\ncount: whole number · --bots (optional): on when given'])
    expect(replies(await send(client, '!help card view'))).toEqual(['Usage: !card show <id>\nid: text\nAlso: !card view'])
  })

  it('shows a guarded or hidden command when named, and lists a parent without its guarded subcommands', async () => {
    const client = await startApp({ controllers: [Moderation], messages: HELP })

    expect(replies(await send(client, '!help config reset-db'))).toEqual(['Usage: !config reset-db\nWipes the database.'])
    expect(replies(await send(client, '!help secret'))).toEqual(['Usage: !secret\nAn easter egg.'])
    expect(replies(await send(client, '!help config'))).toEqual(['Usage:\n!config get <key>\n!config set <key> <value…>'])
  })

  it('says when nothing is called that, and when nothing can be listed', async () => {
    @Controller()
    class Locked {
      @MessageHandler('vault open {code}')
      @UseGuard(StaffOnly)
      open() {}
    }
    @Controller()
    class ServerOnly {
      @MessageHandler('ban {target:member}')
      ban() {}
    }
    const client = await startApp({ controllers: [Moderation], messages: HELP })
    const locked = await startApp({ controllers: [Locked], messages: HELP })
    const server = await startApp({ controllers: [ServerOnly], messages: HELP })

    expect(replies(await send(client, '!help nope'))).toEqual(['No command is called "nope". Type !help to list them.'])
    // A parent whose subcommands are all guarded is not named, so it cannot be told apart from no command
    expect(replies(await send(locked, '!help vault'))).toEqual(['No command is called "vault". Type !help to list them.'])
    expect(replies(await send(locked, '!help'))).toEqual(['There are no commands you can use here.'])
    expect(replies(await send(server, '!help', { dm: true }))).toEqual(['These commands work in servers only.'])
  })

  it('is off unless asked for, and needs a prefix or mention', async () => {
    const off = await startApp({ controllers: [Moderation], messages: { prefix: '!' } })
    const on = await startApp({ controllers: [Moderation], messages: HELP })

    expect((await send(off, '!help')).reply).not.toHaveBeenCalled()
    expect((await send(on, 'help')).reply).not.toHaveBeenCalled()
    expect(replies(await send(on, '!HELP'))).toHaveLength(1)
  })

  it('answers to its own words, and to a mention alone under mention: only', async () => {
    const words = await startApp({ controllers: [Moderation], messages: { prefix: '!', help: { command: 'commands', aliases: ['h'] } } })
    const mentionOnly = await startApp({ controllers: [Moderation], messages: { mention: 'only', help: true } })

    expect((await send(words, '!help')).reply).not.toHaveBeenCalled()
    expect(replies(await send(words, '!h'))[0]).toMatch(/Type !commands <command> for one command's usage\.$/)
    expect((await send(mentionOnly, '!help')).reply).not.toHaveBeenCalled()
    expect(replies(await send(mentionOnly, `<@${BOT_ID}> help`))[0]).toContain(`<@${BOT_ID}> mute <target>`)
  })

  it("lets the app's own help handler run, and warns at startup that the built-in never answers", async () => {
    const ran: string[] = []
    @Controller()
    class OwnHelp {
      @MessageHandler('help')
      help() {
        ran.push('own')
      }
    }
    const client = await startApp({ controllers: [OwnHelp], messages: HELP })

    expect((await send(client, '!help')).reply).not.toHaveBeenCalled()
    expect(ran).toEqual(['own'])
    expect(logged.warn.flat().join(' ')).toContain('OwnHelp.help ("help") takes "!help", which runs it instead')
  })

  it('warns for any handler the help message reaches, and not for one only another start reaches', async () => {
    const shadowing = (pattern: string, options: { aliases?: string[]; prefix?: string } = {}) => {
      @Controller()
      class Topic {
        @MessageHandler(pattern, options)
        topic() {}
      }
      return Topic
    }
    const warned = async (controller: unknown) => {
      logged.warn.length = 0
      await startApp({ controllers: [controller], messages: HELP })
      return logged.warn.flat().join(' ')
    }

    expect(await warned(shadowing('help {topic?}'))).toContain('Topic.topic ("help {topic?}") takes "!help"')
    expect(await warned(shadowing('help {command}'))).toContain('Topic.topic ("help {command}") takes "!help"')
    expect(await warned(shadowing('guide {topic...?}', { aliases: ['help'] }))).toContain('takes "!help"')
    expect(await warned(shadowing('help {topic?}', { prefix: '?' }))).not.toContain('takes')
    logged.warn.length = 0
    await startApp({ controllers: [shadowing('help {topic?}')], messages: { mention: 'only', help: true } })
    expect(logged.warn.flat().join(' ')).toContain('takes "@bot help"')
  })

  it('warns at startup when no message can ask for help', async () => {
    await startApp({ controllers: [Moderation], messages: { help: true } })

    expect(logged.warn.flat().join(' ')).toContain('no message can ask for help')
  })

  it("begins with the theme's info emoji under replyEmoji, and splits a long list into messages", async () => {
    @Controller()
    class Many {
      @MessageHandler('command {x}', { description: 'x'.repeat(1990) })
      one() {}

      @MessageHandler('other {x}', { description: 'y'.repeat(1990) })
      two() {}
    }
    const emoji = await startApp({ controllers: [Moderation], messages: { ...HELP, replyEmoji: true } })
    const many = await startApp({ controllers: [Many], messages: HELP })

    expect(replies(await send(emoji, '!help nope'))).toEqual(['ℹ️ No command is called "nope". Type !help to list them.'])
    const parts = replies(await send(many, '!help'))
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.every(part => part!.length <= 2000)).toBe(true)
  })

  it("hands the presenter what it found, and replies with what the presenter writes", async () => {
    const seen: MessageHelp[] = []
    @Service()
    class HelpPresenter implements ResponsePresenter {
      loading = ({ theme }: ResponseContext) => ({ text: '…', emoji: theme.emojis.loading })
      error = (_context: ResponseContext, { message }: PresentedError) => ({ text: message })

      messageHelp(help: MessageHelp) {
        seen.push(help)
        return { content: help.kind === 'list' ? `${help.commands.length} commands` : help.kind }
      }
    }
    const client = await startApp({ controllers: [Moderation], messages: HELP, presenter: HelpPresenter })

    expect(replies(await send(client, '!help'))).toEqual(['4 commands'])
    expect(replies(await send(client, '!help nope'))).toEqual(['unknown'])
    expect(seen[0]).toMatchObject({ kind: 'list', invocation: '!help' })
    expect(seen[0].kind === 'list' && seen[0].commands.find(entry => entry.command === 'mute')).toEqual({
      usage: '!mute <target> [duration] [reason…]',
      command: 'mute',
      description: 'Times a member out.',
      aliases: ['!m'],
      scope: 'guild',
      params: [
        { name: 'target', label: 'member', optional: false },
        { name: 'duration', label: 'length of time, such as 10m', optional: true },
        { name: 'reason', label: 'text', optional: true },
      ],
      handler: { controller: 'Moderation', method: 'mute' },
    })
  })

  it("runs the app's guards first, answering as they answer a command", async () => {
    let saying = false
    @Guard()
    class Closed implements GuardInterface {
      canActivate() {
        if (saying) throw new GuardDeniedError('The bot is closed here.')
        return false
      }
    }
    const client = await startApp({ controllers: [Moderation], messages: HELP, guards: [Closed] })
    const asked = ['!help', '!help mute', '!config']

    for (const content of [...asked, '!purge 5']) expect(replies(await send(client, content))).toEqual([])
    saying = true
    for (const content of [...asked, '!purge 5']) expect(replies(await send(client, content))).toEqual(['The bot is closed here.'])
  })

  it('leaves a hidden subcommand out of a parent’s usage listing too', async () => {
    @Controller()
    class Tools {
      @MessageHandler('tool run {name}')
      run() {}

      @MessageHandler('tool debug {name}', { hidden: true })
      debug() {}
    }
    const client = await startApp({ controllers: [Tools], messages: { prefix: '!' } })

    expect(replies(await send(client, '!tool'))).toEqual(['Usage: !tool run <name>'])
  })

  it('refuses a help option it cannot read, and a hidden that is not true or false', async () => {
    const declare = (messages: unknown) => () =>
      MeoCord({ controllers: [], clientOptions: { intents: [] }, messages: messages as MessageCommandOptions })(class {})
    expect(declare({ help: 'help' })).toThrow('@MeoCord({ messages: { help } }) takes true, false, or { command, aliases } of single words.')
    expect(declare({ help: { command: 'two words' } })).toThrow('of single words')
    @Controller()
    class Odd {
      @MessageHandler('odd', { hidden: 'yes' as never })
      odd() {}
    }
    await expect(startApp({ controllers: [Odd], messages: HELP })).rejects.toThrow('hidden is true or false, not "yes".')
  })
})

describe('HandlerRegistry.messageHelp', () => {
  it('gives a help command of the app’s own the model the built-in uses, with help off', async () => {
    @Controller()
    class Help {
      constructor(private readonly handlers: HandlerRegistry) {}

      @MessageHandler('help {command...?}')
      async help(message: Message, { command }: { command?: string }) {
        const help = await this.handlers.messageHelp(message, command)
        const text = help.kind === 'list' ? help.commands.map(entry => entry.command).join(', ') : help.kind === 'command' ? help.commands[0].usage : help.kind
        await message.reply(text)
      }
    }
    const client = await startApp({ controllers: [Moderation, Help], messages: { prefix: '!' } })

    expect(replies(await send(client, '!help'))).toEqual(['config get, config set, help, mute, purge'])
    expect(replies(await send(client, '!help m'))).toEqual(['!mute <target> [duration] [reason…]'])
    expect(replies(await send(client, '!help nope'))).toEqual(['unknown'])
  })

  it('reads the routes dispatch reads, not a handler on a service, which no message reaches', async () => {
    @Service()
    class Stats {
      @MessageHandler('stats', { description: 'Shows the stats.' })
      stats() {}
    }
    @Controller()
    class Help {
      constructor(
        private readonly handlers: HandlerRegistry,
        readonly stats: Stats,
      ) {}

      @MessageHandler('help {command...?}')
      async help(message: Message, { command }: { command?: string }) {
        const help = await this.handlers.messageHelp(message, command)
        await message.reply(help.kind === 'list' ? help.commands.map(entry => entry.command).join(', ') : help.kind)
      }
    }
    const client = await startApp({ controllers: [Moderation, Help], messages: { prefix: '!' }, services: [Stats] })

    expect(replies(await send(client, '!help'))).toEqual(['config get, config set, help, mute, purge'])
    expect(replies(await send(client, '!help stats'))).toEqual(['unknown'])
  })
})

describe('the built-in help in the testing module', () => {
  it('answers through dispatch, and is no route resolveRoute finds', async () => {
    @MeoCord({ controllers: [Moderation], clientOptions: { intents: [] }, messages: HELP })
    class HelpApp {}
    const module = MeoCordTestingModule.create({ app: HelpApp, controllers: [Moderation] }).compile()
    const message = createMockMessage({ content: '!help config' })

    const result = await module.dispatch(message)

    expect(result.handlers).toEqual([])
    expect(message.reply).toHaveBeenCalledWith(expect.objectContaining({ content: 'Usage:\n!config get <key>\n!config set <key> <value…>' }))
    expect(resolveRoute(HelpApp, { content: '!help' })).toBeUndefined()
  })
})

describe('splitReply', () => {
  it('splits at line breaks into messages of 2000 characters at most, cutting a longer line', () => {
    const line = 'a'.repeat(1500)
    expect(splitReply(`${line}\n${line}`)).toEqual([line, line])
    expect(splitReply('b'.repeat(4100)).map(part => part.length)).toEqual([2000, 2000, 100])
    expect(splitReply('one\ntwo')).toEqual(['one\ntwo'])
  })
})
