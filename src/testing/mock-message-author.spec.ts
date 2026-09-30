import 'reflect-metadata'
import { ButtonInteraction, type GuildMember, type Message, type User } from 'discord.js'
import { Controller, Cooldown, MeoCord, MessageHandler } from '@src/decorator/index.js'
import { MeoCordTestingModule } from './meocord-testing-module.js'
import { createMock, createMockClient, createMockGuild, createMockInteraction, createMockMessage, createMockUser } from './mock-interaction.js'

describe('createMockMessage with an author', () => {
  it('is sent by the author given, cached on its client', () => {
    const author = createMockUser()

    const message = createMockMessage({ author })

    expect(message.author).toBe(author)
    expect(message.client.users.cache.get(author.id)).toBe(author)
  })

  it('has the author as its member in a server, with the member id and guild matching', () => {
    const author = createMockUser()

    const message = createMockMessage({ author })

    expect(message.member!.user).toBe(author)
    expect(message.member!.id).toBe(author.id)
    expect(message.member!.guild).toBe(message.guild)
    expect(message.guild!.members.cache.get(author.id)).toBe(message.member)
  })

  it("takes the author's member from the server's cache when the test put one there", () => {
    const author = createMockUser()
    const member = createMock<GuildMember>({ id: author.id, user: author })

    const message = createMockMessage({ author, guild: createMockGuild({ members: [member] }) })

    expect(message.member).toBe(member)
  })

  it('has no member in a direct message', () => {
    const message = createMockMessage({ author: createMockUser(), guild: null })

    expect(message.member).toBeNull()
  })

  it('resolves a mention of the author to the author', () => {
    const author = createMockUser()

    const message = createMockMessage({ author, content: `!x <@${author.id}>` })

    expect(message.mentions.users.get(author.id)).toBe(author)
    expect(message.mentions.members!.get(author.id)).toBe(message.member)
  })

  it('can be sent by the bot itself', () => {
    const client = createMockClient()

    const message = createMockMessage({ author: client.user!, client })

    expect(message.author).toBe(client.user)
  })
})

describe("an interaction's member", () => {
  it("is the member the server caches for the interaction's user", () => {
    const user = createMockUser()
    const cachedMember = createMock<GuildMember>({ id: user.id, user })
    const guild = createMockGuild({ members: [cachedMember] })

    const click = createMockInteraction(ButtonInteraction, { user, guild, guildId: guild.id })

    expect(click.member).toBe(cachedMember)
  })

  it('has the user\'s id, the user and the guild otherwise', () => {
    const user = createMockUser()
    const guild = createMockGuild()

    const click = createMockInteraction(ButtonInteraction, { user, guild, guildId: guild.id })

    expect(click.member!.id).toBe(user.id)
    expect(click.member!.user).toBe(user)
    expect((click.member as GuildMember).guild).toBe(guild)
  })

  it('is shared with a message from the same user in the same server, whichever comes first', () => {
    const author = createMockUser()
    const guild = createMockGuild()
    const message = createMockMessage({ author, guild })
    const click = createMockInteraction(ButtonInteraction, { user: author, guild, guildId: guild.id })

    expect(click.member).toBe(message.member)

    const user = createMockUser()
    const first = createMockInteraction(ButtonInteraction, { user, guild, guildId: guild.id })
    const later = createMockMessage({ author: user, guild })

    expect(later.member).toBe(first.member)
  })

  it('is null outside a server', () => {
    expect(createMockInteraction(ButtonInteraction, { user: createMockUser() }).member).toBeNull()
  })
})

describe('messages from one author through dispatch', () => {
  let runs: string[] = []

  @Controller()
  class DailyController {
    @MessageHandler('daily')
    @Cooldown({ uses: 1, seconds: 60 })
    daily(message: Message) {
      runs.push(message.author.id)
    }
  }

  @MeoCord({ controllers: [DailyController], messages: { prefix: '!' }, clientOptions: { intents: [] } })
  class App {}

  beforeEach(() => {
    runs = []
  })

  it("counts two messages from one author against that user's cooldown, so the second is refused", async () => {
    const module = MeoCordTestingModule.fromApp(App).compile()
    const author: User = createMockUser()
    const guild = createMockGuild()

    await module.dispatch(createMockMessage({ author, guild, content: '!daily' }))
    await module.dispatch(createMockMessage({ author, guild, content: '!daily' }))

    expect(runs).toEqual([author.id])
  })

  it('counts two authors apart', async () => {
    const module = MeoCordTestingModule.fromApp(App).compile()
    const guild = createMockGuild()

    await module.dispatch(createMockMessage({ author: createMockUser(), guild, content: '!daily' }))
    await module.dispatch(createMockMessage({ author: createMockUser(), guild, content: '!daily' }))

    expect(runs).toHaveLength(2)
  })
})
