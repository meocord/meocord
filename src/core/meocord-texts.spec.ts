import { vi } from 'vitest'
import { writeSync } from 'node:fs'

// Written to the process's stdout directly, so a passing test's timings reach the CI log too
const e36 = (line: string) => writeSync(1, `[E36] ${line}\n`)
import { ButtonInteraction, ChatInputCommandInteraction, Client, type APIEmbed, type Guild } from 'discord.js'
import { Command, Controller, Cooldown, MeoCord, MessageHandler } from '@src/decorator/index.js'
import { MeoCordFactory } from '@src/core/meocord-factory.js'
import { HandlerRegistry } from '@src/core/handler-registry.js'
import { createTranslator, defineCatalog, type Translator } from '@src/common/index.js'
import { CommandType } from '@src/enum/index.js'
import { type MessageParamType } from '@src/interface/index.js'
import { createMockGuild, createMockInteraction, createMockMessage, createMockUser, MeoCordTestingModule } from '@src/testing/index.js'
import { defaultPresenter } from '@src/common/response/presenter.js'
import { registerClientTranslator } from '@src/common/meocord-text.js'
import { DEFAULT_THEME } from '@src/core/theme-defaults.js'

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

const enUS = defineCatalog({ types: { color: 'hex colour' } })
const id = {
  types: { color: 'warna hex' },
  meocord: {
    usage: { heading: 'Cara pakai: {usage}', notValid: '{label}: "{word}" bukan {type} yang sah', notOneOf: '{label}: "{word}" bukan salah satu dari {choices}' },
    types: { int: 'bilangan bulat' },
    cooldown: { seconds: 'Pelan-pelan: coba lagi dalam {seconds} detik.' },
    fallback: { notFound: 'Perintah tidak ditemukan!', error: 'Terjadi kesalahan.' },
    presenter: { loading: 'Sedang diproses…', errorTitle: 'Aduh!' },
    help: { commandsHeading: 'Perintah:', listOf: '{label}, satu atau lebih', aliases: 'Juga: {aliases}', flagOn: 'aktif jika diberikan' },
  },
}
const t = createTranslator({ default: 'en-US', locales: { 'en-US': enUS, id } })

const color: MessageParamType<number> = {
  labelKey: 'types.color',
  parse: word => (/^#[0-9a-f]{6}$/i.test(word) ? parseInt(word.slice(1), 16) : undefined),
}

@Controller()
class Commands {
  @MessageHandler('roll {sides:int}')
  roll() {}

  @MessageHandler('sort {order:asc|desc}')
  sort() {}

  @MessageHandler('paint {accent:color}')
  paint() {}

  @MessageHandler('tag {names:string...} {--loud}', { aliases: ['t', 'label', 'mark'], description: 'Tags things.' })
  tag() {}

  @Command('daily', CommandType.SLASH)
  @Cooldown({ seconds: 10 })
  daily() {}

  @Command('broken', CommandType.SLASH)
  broken() {
    throw new Error('boom')
  }
}

/** Starts an app with this translator, logged in without a network; without one, `color` has a plain label. */
async function startApp(i18n: Translator<any> | undefined): Promise<Client> {
  const messages = { prefix: '!', help: true, deleteUsageRepliesAfter: 0, types: { color: i18n ? color : { parse: color.parse, label: 'hex colour' } } }
  const clients: Client[] = []
  vi.spyOn(Client.prototype, 'login').mockImplementation(function (this: Client) {
    clients.push(this)
    return Promise.resolve('token')
  })
  @MeoCord({ controllers: [Commands], messages, i18n, clientOptions: { intents: [] } })
  class App {}
  const t0 = performance.now()
  const created = MeoCordFactory.create(App)
  const t1 = performance.now()
  await created.start()
  e36(`create ${(t1 - t0).toFixed(0)}ms start ${(performance.now() - t1).toFixed(0)}ms`)
  Object.defineProperty(clients[0], 'user', { value: { id: '111', setActivity: () => {} }, configurable: true })
  return clients[0]
}

/** A server whose preferred locale is `locale`. */
function serverIn(locale: string): Guild {
  return Object.assign(createMockGuild(), { preferredLocale: locale }) as unknown as Guild
}

/** The text of the replies each message got, sent in turn to the bot, in `guild`. */
async function repliesTo(client: Client, contents: string[], guild: Guild | null): Promise<string[]> {
  const replies: string[] = []
  for (const content of contents) {
    const message = createMockMessage({ content, guild: guild as never })
    Object.assign(message.author, { bot: false, id: 'user-1' })
    // The gateway gives a message the bot's own client
    Object.defineProperty(message, 'client', { value: client })
    const r0 = performance.now()
    await Promise.all(client.rawListeners('messageCreate').map(listener => (listener as (m: unknown) => unknown)(message)))
    e36(`reply "${content}" ${(performance.now() - r0).toFixed(0)}ms`)
    for (const [reply] of vi.mocked(message.reply).mock.calls) replies.push((reply as { content: string }).content)
  }
  return replies
}

const REFUSED = ['!roll lots', '!roll 1 2', '!sort up', '!paint red']

describe("MeoCord's own texts", () => {
  afterEach(() => vi.restoreAllMocks())

  it("answers a message in its server's language, each line the catalog lacks in English", async () => {
    const begun = performance.now()
    e36(`first test begins ${begun.toFixed(0)}ms into the worker`)
    // The first use of ICU in this process: collation, then a list format for the locale the replies use
    const i0 = performance.now()
    'b'.localeCompare('a')
    const i1 = performance.now()
    new Intl.ListFormat('id', { type: 'disjunction' }).format(['asc', 'desc'])
    e36(`first localeCompare ${(i1 - i0).toFixed(0)}ms, first ListFormat('id') ${(performance.now() - i1).toFixed(0)}ms`)
    const client = await startApp(t)

    expect(await repliesTo(client, REFUSED, serverIn('id'))).toEqual([
      'Cara pakai: !roll <sides>\nsides: "lots" bukan bilangan bulat yang sah',
      'Cara pakai: !roll <sides>\nThe command has more words than it takes',
      'Cara pakai: !sort <order>\norder: "up" bukan salah satu dari asc atau desc',
      'Cara pakai: !paint <accent>\naccent: "red" bukan warna hex yang sah',
    ])
    e36(`first test took ${(performance.now() - begun).toFixed(0)}ms`)
  })

  it("answers a direct message, and a server whose language has no catalog, in the translator's default", async () => {
    const client = await startApp(t)
    const english = [
      'Usage: !roll <sides>\nsides: "lots" is not a valid whole number',
      'Usage: !roll <sides>\nThe command has more words than it takes',
      'Usage: !sort <order>\norder: "up" is not one of asc, desc',
      'Usage: !paint <accent>\naccent: "red" is not a valid hex colour',
    ]

    expect(await repliesTo(client, REFUSED, null)).toEqual(english)
    expect(await repliesTo(client, REFUSED, serverIn('ja'))).toEqual(english)
  })

  it("answers help in the server's language, each line the catalog lacks in English", async () => {
    const client = await startApp(t)

    const [list, tag] = await repliesTo(client, ['!help', '!help tag'], serverIn('id'))
    expect(list.split('\n')[0]).toBe('Perintah:')
    expect(list.split('\n').at(-1)).toBe("Type !help <command> for one command's usage.")
    expect(tag).toBe(
      'Cara pakai: !tag <names…> [--loud]\nTags things.\nnames: text, satu atau lebih · --loud (optional): aktif jika diberikan\nJuga: !label, !mark, !t',
    )
    expect((await repliesTo(client, ['!help tag'], null))[0]).toBe(
      'Usage: !tag <names…> [--loud]\nTags things.\nnames: text, one or more · --loud (optional): on when given\nAlso: !label, !mark, !t',
    )
  })

  it('answers help with a partial catalog: the translated lines and joins, the rest in English', async () => {
    const partial = createTranslator({
      default: 'en-US',
      locales: { 'en-US': enUS, id: { meocord: { help: { params: '{params}', aliases: 'Juga: {aliases}' } } } },
    })
    const client = await startApp(partial)

    expect((await repliesTo(client, ['!help tag'], serverIn('id')))[0]).toBe(
      'Usage: !tag <names…> [--loud]\nTags things.\nnames: text, one or more, --loud (optional): on when given\nJuga: !label, !mark, !t',
    )
  })

  it("answers an English server in MeoCord's English when the default locale is another language", async () => {
    const idDefault = defineCatalog({
      types: { color: 'warna hex' },
      meocord: { usage: { heading: 'Cara pakai: {usage}', notValid: '{label}: "{word}" bukan {type} yang sah' }, types: { int: 'bilangan bulat' } },
    })
    const idFirst = createTranslator({ default: 'id', locales: { id: idDefault, 'en-US': {} } })
    const client = await startApp(idFirst)
    const indonesian = 'Cara pakai: !roll <sides>\nsides: "lots" bukan bilangan bulat yang sah'

    expect(await repliesTo(client, ['!roll lots'], serverIn('en-US'))).toEqual(['Usage: !roll <sides>\nsides: "lots" is not a valid whole number'])
    expect(await repliesTo(client, ['!roll lots'], serverIn('en-GB'))).toEqual(['Usage: !roll <sides>\nsides: "lots" is not a valid whole number'])
    expect([...(await repliesTo(client, ['!roll lots'], serverIn('id'))), ...(await repliesTo(client, ['!roll lots'], null))]).toEqual([indonesian, indonesian])
  })

  it('answers in English without i18n, whatever the server speaks', async () => {
    const client = await startApp(undefined)

    expect(await repliesTo(client, ['!roll lots', '!sort up', '!paint red'], serverIn('id'))).toEqual([
      'Usage: !roll <sides>\nsides: "lots" is not a valid whole number',
      'Usage: !sort <order>\norder: "up" is not one of asc, desc',
      'Usage: !paint <accent>\naccent: "red" is not a valid hex colour',
    ])
  })

  it('refuses a labelKey without i18n, or one the default catalog has no message for', () => {
    const declare = (i18n: typeof t | undefined, labelKey: string) => () => {
      @MeoCord({ controllers: [], messages: { types: { color: { ...color, labelKey } } }, i18n, clientOptions: { intents: [] } })
      class App {}
      return App
    }

    expect(declare(undefined, 'types.color')).toThrow(`"color" has labelKey 'types.color', which needs @MeoCord({ i18n }).`)
    expect(declare(t, 'types.colour')).toThrow(`"color" has labelKey 'types.colour', which the default catalog has no message for.`)
    expect(declare(t, 'types')).toThrow('which the default catalog has no message for')
  })
})

describe("MeoCord's own texts for an interaction", () => {
  @MeoCord({ controllers: [Commands], messages: { types: { color } }, i18n: t, clientOptions: { intents: [] } })
  class App {}
  const compile = () => MeoCordTestingModule.create({ app: App, controllers: [Commands] }).compile()

  /** The embed of the last reply or edit `interaction` got. */
  function answer(interaction: { reply: { mock: { calls: unknown[][] } }; editReply: { mock: { calls: unknown[][] } } }): APIEmbed {
    const calls = [...interaction.reply.mock.calls, ...interaction.editReply.mock.calls]
    return (calls.at(-1)![0] as { embeds: APIEmbed[] }).embeds[0]
  }

  it("answers a cooldown, a command not found and a fault in the user's language", async () => {
    const module = compile()
    const user = createMockUser()
    const slash = (commandName: string) => createMockInteraction(ChatInputCommandInteraction, { commandName, user, locale: 'id' as never })

    await module.dispatch(slash('daily'))
    const blocked = slash('daily')
    await module.dispatch(blocked)
    const lost = createMockInteraction(ButtonInteraction, { customId: 'nowhere', locale: 'id' as never })
    await module.dispatch(lost)
    const broken = slash('broken')
    // Rethrown to the test, as a fault is, after the fallback answered it
    await module.dispatch(broken).catch(() => undefined)

    expect(answer(blocked)).toMatchObject({ title: 'Aduh!', description: 'Pelan-pelan: coba lagi dalam 10 detik.' })
    expect(answer(lost)).toMatchObject({ title: 'Aduh!', description: 'Perintah tidak ditemukan!' })
    expect(answer(broken)).toMatchObject({ title: 'Aduh!', description: 'Terjadi kesalahan.' })
  })

  it("gives HandlerRegistry.messageHelp's param labels in the server's language", async () => {
    const registry = compile().get(HandlerRegistry)
    const help = await registry.messageHelp(createMockMessage({ content: '!help roll', guild: serverIn('id') as never }), 'roll')

    expect(help.kind === 'command' && help.commands[0].params).toEqual([{ name: 'sides', label: 'bilangan bulat', optional: false }])
  })

  it("shows the default presenter's loading view in the user's language, and in English for another", () => {
    const interaction = createMockInteraction(ButtonInteraction)
    registerClientTranslator(interaction.client, t)
    const loading = (locale: string) =>
      defaultPresenter.loading({ interaction: interaction as never, locale: locale as never, mode: 'embed', theme: DEFAULT_THEME as never }).text

    expect([loading('id'), loading('fr')]).toEqual(['Sedang diproses…', 'Working on it…'])
  })
})
