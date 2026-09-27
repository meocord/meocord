import { vi } from 'vitest'
import { Client, type Message } from 'discord.js'
import { Controller, Guard, MeoCord, MessageHandler, On, Service, UseGuard, UseTheme, Validate } from '@src/decorator/index.js'
import { MeoCordFactory } from '@src/core/meocord-factory.js'
import { GuardDeniedError, UserError } from '@src/common/index.js'
import { type GuardInterface, type MessageCommandOptions, type StandardSchemaV1, type ThemeOverride, type ThemeResolvers } from '@src/interface/index.js'
import { DEFAULT_THEME } from '@src/core/theme-defaults.js'
import { createMockGuild, createMockMessage, MeoCordTestingModule } from '@src/testing/index.js'

vi.mock('@src/common/logger.js', async importOriginal => ({
  ...(await importOriginal<object>()),
  Logger: class {
    log = vi.fn()
    debug = vi.fn()
    info = vi.fn()
    verbose = vi.fn()
    warn = vi.fn()
    error = vi.fn()
  },
}))
vi.mock('@src/util/meocord-config-loader.util.js', () => ({ loadMeoCordConfig: () => ({ discordToken: 'token' }) }))
vi.mock('@src/util/platform.util.js', () => ({ assertBuiltForThisPlatform: () => {} }))

@Guard()
class ModeratorsOnly implements GuardInterface {
  canActivate(): boolean {
    throw new GuardDeniedError('Moderators only.')
  }
}

const positive: StandardSchemaV1<unknown, { amount: number }> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: input => {
      const { amount } = input as { amount: number }
      return amount > 0 ? { value: { amount } } : { issues: [{ message: 'must be at least 1', path: ['amount'] }] }
    },
  },
}

@Controller()
class Commands {
  @MessageHandler('roll {sides:int}')
  roll() {}

  @MessageHandler('ban {target}')
  @UseGuard(ModeratorsOnly)
  ban() {}

  @MessageHandler('give {amount:int}')
  @Validate(positive)
  give() {}

  @MessageHandler('link')
  link() {
    throw new UserError('Link your account first.')
  }

  @MessageHandler('vip')
  @UseTheme({ emojis: { warning: '🎟️' } })
  vip() {
    throw new UserError('Members only.')
  }
}

@Service()
class Watcher {
  @On('messageCreate')
  watch(message: Message) {
    if (message.content === 'spam') throw new UserError('Slow down.')
  }
}

/** Starts an app with these message options and theme, logged in without a network. */
async function startApp(messages: MessageCommandOptions, theme?: ThemeOverride, themeFor?: ThemeResolvers): Promise<Client> {
  const clients: Client[] = []
  vi.spyOn(Client.prototype, 'login').mockImplementation(function (this: Client) {
    clients.push(this)
    return Promise.resolve('token')
  })
  @MeoCord({ controllers: [Commands], services: [Watcher], messages: { prefix: '!', ...messages }, theme, themeFor, clientOptions: { intents: [] } })
  class App {}
  await MeoCordFactory.create(App).start()
  Object.defineProperty(clients[0], 'user', { value: { id: '111', setActivity: () => {} }, configurable: true })
  return clients[0]
}

/** The text of the replies each message got, sent in turn through every listener, by `author` in `guild`. */
async function repliesTo(client: Client, contents: string[], { author = 'user-1', guild }: { author?: string; guild?: { id: string } | null } = {}): Promise<string[]> {
  const replies: string[] = []
  for (const content of contents) {
    const message = createMockMessage({ content, ...(guild !== undefined && { guild: guild as never }) })
    Object.assign(message.author, { bot: false, id: author })
    await Promise.all(client.rawListeners('messageCreate').map(listener => (listener as (m: unknown) => unknown)(message)))
    for (const [reply] of vi.mocked(message.reply).mock.calls) replies.push((reply as { content: string }).content)
  }
  return replies
}

const REFUSED = ['!roll lots', '!ban ana', '!give 0', '!link', 'spam']

describe('messages.replyEmoji', () => {
  afterEach(() => vi.restoreAllMocks())

  it('leaves the text of every reply to a message as it is by default, whatever the theme', async () => {
    const client = await startApp({ deleteUsageRepliesAfter: 0 }, { emojis: { warning: '🚧' } })

    expect(await repliesTo(client, REFUSED)).toEqual([
      'Usage: !roll <sides>\nsides: "lots" is not a valid whole number',
      'Moderators only.',
      'amount: must be at least 1',
      'Link your account first.',
      'Slow down.',
    ])
  })

  it("begins the usage, a guard's and validation's reason, and a UserError's message with the theme's warning emoji", async () => {
    const client = await startApp({ deleteUsageRepliesAfter: 0, replyEmoji: true })
    const warning = DEFAULT_THEME.emojis.warning

    expect(await repliesTo(client, REFUSED)).toEqual([
      `${warning} Usage: !roll <sides>\nsides: "lots" is not a valid whole number`,
      `${warning} Moderators only.`,
      `${warning} amount: must be at least 1`,
      `${warning} Link your account first.`,
      `${warning} Slow down.`,
    ])
  })

  it("takes the emoji from the call's theme: the app's, and a handler's own @UseTheme", async () => {
    const client = await startApp({ deleteUsageRepliesAfter: 0, replyEmoji: true }, { emojis: { warning: '🚧' } })

    expect(await repliesTo(client, ['!link', '!vip'])).toEqual(['🚧 Link your account first.', '🎟️ Members only.'])
  })

  it("takes the emoji from themeFor: the server's, and the user's over it, in a server or a DM", async () => {
    const castle = createMockGuild({ id: '300000000000000001' })
    const client = await startApp({ deleteUsageRepliesAfter: 0, replyEmoji: true }, undefined, {
      guild: ({ guild }) => (guild.id === castle.id ? { emojis: { warning: '🏰' } } : undefined),
      user: ({ user }) => (user.id === 'vip' ? { emojis: { warning: '👑' } } : undefined),
    })
    const warning = DEFAULT_THEME.emojis.warning

    expect(await repliesTo(client, ['!link', '!roll lots', 'spam'], { guild: castle })).toEqual([
      '🏰 Link your account first.',
      '🏰 Usage: !roll <sides>\nsides: "lots" is not a valid whole number',
      '🏰 Slow down.',
    ])
    expect(await repliesTo(client, ['!link', 'spam'], { guild: castle, author: 'vip' })).toEqual(['👑 Link your account first.', '👑 Slow down.'])
    expect(await repliesTo(client, ['!link'], { guild: null, author: 'vip' })).toEqual(['👑 Link your account first.'])
    expect(await repliesTo(client, ['!link'], { guild: null })).toEqual([`${warning} Link your account first.`])
  })

  it('prefixes the replies module.dispatch sends, as the bot does', async () => {
    @MeoCord({ controllers: [Commands], messages: { prefix: '!', replyEmoji: true, deleteUsageRepliesAfter: 0 }, theme: { emojis: { warning: '🚧' } }, clientOptions: { intents: [] } })
    class App {}
    const module = MeoCordTestingModule.create({ app: App, controllers: [Commands] }).compile()
    const message = createMockMessage({ content: '!vip' })

    await module.dispatch(message)

    expect(message.reply).toHaveBeenCalledWith({ content: '🎟️ Members only.', allowedMentions: { repliedUser: false } })
  })

  it('refuses a replyEmoji that is not true or false', () => {
    expect(() => {
      @MeoCord({ controllers: [], messages: { replyEmoji: 'yes' as never }, clientOptions: { intents: [] } })
      class App {}
      return App
    }).toThrow('@MeoCord({ messages: { replyEmoji } }) takes true or false.')
  })
})
