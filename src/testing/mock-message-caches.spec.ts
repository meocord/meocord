import 'reflect-metadata'
import { vi } from 'vitest'
import { Client, type GuildMember, type Message, type User } from 'discord.js'
import { Controller, MeoCord, MessageHandler } from '@src/decorator/index.js'
import { MeoCordFactory } from '@src/core/meocord-factory.js'
import { MeoCordTestingModule } from './meocord-testing-module.js'
import { createMock, createMockClient, createMockGuild, createMockMessage } from './mock-interaction.js'

vi.mock('@src/util/meocord-config-loader.util.js', () => ({ loadMeoCordConfig: () => ({ discordToken: 'token' }) }))
vi.mock('@src/util/platform.util.js', () => ({ assertBuiltForThisPlatform: () => {} }))

const USER = '100000000000000011'
const OTHER = '100000000000000012'
const ROLE = '100000000000000013'
const CHANNEL = '100000000000000014'

describe('createMockMessage caches', () => {
  it('puts a mentioned user, member, role and channel in the caches and in mentions, as the gateway delivers them', () => {
    const message = createMockMessage({ content: `!x <@${USER}> <@!${OTHER}> <@&${ROLE}> <#${CHANNEL}>` })

    expect(message.client.users.cache.get(USER)?.id).toBe(USER)
    expect(message.client.users.cache.get(OTHER)?.id).toBe(OTHER)
    expect(message.guild!.members.cache.get(USER)?.user.id).toBe(USER)
    expect(message.guild!.members.cache.get(USER)?.id).toBe(USER)
    expect(message.guild!.roles.cache.get(ROLE)?.id).toBe(ROLE)
    expect(message.guild!.channels.cache.get(CHANNEL)?.id).toBe(CHANNEL)
    expect([...message.mentions.users.keys()]).toEqual([USER, OTHER])
    expect([...message.mentions.members!.keys()]).toEqual([USER, OTHER])
    expect([...message.mentions.roles.keys()]).toEqual([ROLE])
    expect([...message.mentions.channels.keys()]).toEqual([CHANNEL])
  })

  it('caches a mentioned user but no member in a DM', () => {
    const message = createMockMessage({ content: `!x <@${USER}>`, guild: null })

    expect(message.client.users.cache.get(USER)?.id).toBe(USER)
    expect(message.mentions.members).toBeNull()
  })

  // A bot fetches a user it is only given the id of, so the mock leaves it out of the cache too
  it('caches nothing for an id that is not a mention', () => {
    const message = createMockMessage({ content: `!x ${USER}` })

    expect(message.client.users.cache.size).toBe(0)
    expect(message.guild!.members.cache.size).toBe(0)
  })

  it('keeps the members and users a test gives, beside those mentioned', () => {
    const given = createMock<GuildMember>({ id: OTHER, user: createMock<User>({ id: OTHER }) })
    const user = createMock<User>({ id: OTHER })

    const message = createMockMessage({ content: `!x <@${USER}>`, guild: createMockGuild({ members: [given] }), users: [user] })

    expect(message.guild!.members.cache.get(OTHER)).toBe(given)
    expect(message.guild!.members.cache.get(USER)?.id).toBe(USER)
    expect(message.client.users.cache.get(OTHER)).toBe(user)
  })

  // Fixed, so a test that writes the id down, or a snapshot of it, passes in any order and on any run
  it('names the same bot whatever was mocked before it', async () => {
    vi.resetModules()
    const first = await import('./mock-interaction.js')
    first.createMockUser()
    first.createMockMessage()
    const afterOthers = first.createMockClient().user.id
    vi.resetModules()
    const second = await import('./mock-interaction.js')

    expect(second.createMockClient().user.id).toBe(afterOthers)
  })

  it('is sent to the same bot as every mock client, or to the client it is given', () => {
    const client = createMockClient()

    expect(createMockMessage().client.user!.id).toBe(client.user!.id)
    expect(createMockMessage({ client }).client).toBe(client)
    expect(client.user!.id).toMatch(/^\d{17,20}$/)
  })
})

describe('typed user params through dispatch and invoke', () => {
  const received: unknown[] = []

  @Controller()
  class WhoController {
    @MessageHandler('who {u:user}')
    who(_message: Message, { u }: { u: User }) {
      received.push(u.id)
    }

    @MessageHandler('purge {count:int} {--from:user?}')
    purge(_message: Message, { count, from }: { count: number; from?: User }) {
      received.push(`${count} from ${from?.id}`)
    }
  }

  @MeoCord({ controllers: [WhoController], messages: { prefix: '!', mention: true }, clientOptions: { intents: [] } })
  class App {}

  beforeEach(() => {
    received.length = 0
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('resolves a mentioned user under invoke', async () => {
    const module = MeoCordTestingModule.create({ app: App, controllers: [WhoController] }).compile()

    const { ran } = await module.invoke(WhoController, 'who', createMockMessage({ content: `!who <@${USER}>` }))

    expect(ran).toBe(true)
    expect(received).toEqual([USER])
  })

  it('resolves a mentioned user under dispatch', async () => {
    const clients: Client[] = []
    vi.spyOn(Client.prototype, 'login').mockImplementation(function (this: Client) {
      clients.push(this)
      return Promise.resolve('token')
    })
    await MeoCordFactory.create(App).start()

    const message = createMockMessage({ content: `!who <@${USER}>` })
    await Promise.all(clients[0].rawListeners('messageCreate').map(listener => (listener as (m: unknown) => unknown)(message)))

    expect(received).toEqual([USER])
  })

  it('resolves a user given to a flag under invoke', async () => {
    const module = MeoCordTestingModule.create({ app: App, controllers: [WhoController] }).compile()

    const { ran } = await module.invoke(WhoController, 'purge', createMockMessage({ content: `!purge --from=<@${USER}> 20` }))

    expect(ran).toBe(true)
    expect(received).toEqual([`20 from ${USER}`])
  })

  it('resolves a user given to a flag under dispatch', async () => {
    const clients: Client[] = []
    vi.spyOn(Client.prototype, 'login').mockImplementation(function (this: Client) {
      clients.push(this)
      return Promise.resolve('token')
    })
    await MeoCordFactory.create(App).start()

    const message = createMockMessage({ content: `!purge --from=<@${USER}> 20` })
    await Promise.all(clients[0].rawListeners('messageCreate').map(listener => (listener as (m: unknown) => unknown)(message)))

    expect(received).toEqual([`20 from ${USER}`])
  })

  it('matches a mention of the bot where a prefix goes, under invoke', async () => {
    const module = MeoCordTestingModule.create({ app: App, controllers: [WhoController] }).compile()
    const bot = createMockClient().user.id

    const { ran } = await module.invoke(WhoController, 'who', createMockMessage({ content: `<@${bot}> who <@${USER}>` }))

    expect(ran).toBe(true)
    expect(received).toEqual([USER])
  })
})
