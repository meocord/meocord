import 'reflect-metadata'
import {
  AutocompleteInteraction,
  ButtonInteraction,
  ChatInputCommandInteraction,
  Client,
  Collection,
  type CollectedMessageInteraction,
  DMChannel,
  InteractionCollector,
  type Message,
  type User,
  MessageContextMenuCommandInteraction,
  PermissionsBitField,
  Role,
  TextChannel,
  UserContextMenuCommandInteraction,
  UserSelectMenuInteraction,
} from 'discord.js'
import { vi } from 'vitest'
import { Logger, respond } from '@src/common/index.js'
import { forgetDeprecationWarnings } from '@src/common/deprecation.js'
import { Command, Controller } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import {
  createChatInputOptions,
  createMock,
  createMockChannel,
  createMockClient,
  createMockGuild,
  createMockInteraction,
  createMockMember,
  createMockMessage,
  createMockUser,
  MeoCordTestingModule,
} from '@src/testing/index.js'
import { forgetStrictMocks, useStrictMocks } from '@src/testing/strict-mocks.js'

// In discord.js a structure reaches an interaction or a message through the client's caches, so each one's client is
// the interaction's or the message's (discord.js 14.27.0, src/structures/BaseInteraction.js and Message.js)

let warned: string[]
const clientWarnings = () => warned.filter(text => text.includes('A structure a mock interaction or message holds'))

beforeEach(() => {
  forgetStrictMocks()
  forgetDeprecationWarnings()
  warned = []
  vi.spyOn(Logger.prototype, 'warn').mockImplementation((text: unknown) => void warned.push(String(text)))
})
afterEach(() => {
  forgetStrictMocks()
  vi.restoreAllMocks()
})

const slash = (props: Record<string, unknown> = {}) => createMockInteraction(ChatInputCommandInteraction, { commandName: 'ping', ...props } as never)

describe('a mock interaction or message and what it holds, under strict mocks', () => {
  beforeEach(() => useStrictMocks())

  it('put an interaction on the client of the channel and user it makes for itself', async () => {
    const interaction = slash()
    const dm = await interaction.user.createDM()

    expect(interaction.channel).toBe(dm)
    expect(dm.client).toBe(interaction.client)
    expect(interaction.user.client).toBe(interaction.client)
    expect(dm.recipient?.client).toBe(interaction.client)
  })

  it('put an interaction, and the channel and guild it is given, on one client', () => {
    const channel = createMockChannel(TextChannel)
    const guild = createMockGuild()

    const interaction = slash({ channel, guild })

    expect(interaction.channel?.client).toBe(interaction.client)
    expect(interaction.guild?.client).toBe(interaction.client)
    expect(interaction.member?.client).toBe(interaction.client)
    expect(interaction.member?.user.client).toBe(interaction.client)
    expect(interaction.user.client).toBe(interaction.client)
    expect(interaction.guild!.client.guilds.cache.get(guild.id)).toBe(guild)
  })

  it("put the guild of a channel given without one on the channel's client", () => {
    const interaction = slash({ channel: createMockChannel(TextChannel) })

    expect(interaction.channel?.client).toBe(interaction.client)
    expect((interaction.channel as TextChannel).guild.client).toBe(interaction.client)
  })

  it("put a reply's channel on the interaction's client", async () => {
    const interaction = slash()
    await interaction.reply('Pong.')

    const reply = await interaction.fetchReply()

    expect(reply.client).toBe(interaction.client)
    expect(reply.channel.client).toBe(interaction.client)
  })

  it('put a message, its author, member and the users it mentions on one client', () => {
    const mentioned = '100000000000000777'
    const message = createMockMessage({ content: `<@${mentioned}> hi` })

    expect(message.author.client).toBe(message.client)
    expect(message.member?.client).toBe(message.client)
    expect(message.member?.user.client).toBe(message.client)
    expect(message.channel.client).toBe(message.client)
    expect(message.guild?.client).toBe(message.client)
    expect(message.mentions.users.get(mentioned)?.client).toBe(message.client)
  })

  it('put a message given a DM channel on the same client as the channel', () => {
    const channel = createMockChannel(DMChannel)

    expect(createMockMessage({ channel }).client).toBe(channel.client)
  })

  it('put a message given a guild, and the channel it makes there, on the same client as the guild', () => {
    const guild = createMockGuild()

    const message = createMockMessage({ guild })

    expect(message.client).toBe(guild.client)
    expect(message.channel.client).toBe(message.client)
  })

  it('put a message on the client its given channel already holds', () => {
    const channel = createMockChannel(TextChannel)
    const held = channel.client

    expect(createMockMessage({ channel }).client).toBe(held)
  })

  it('put a message given an author on the same client as the author', () => {
    const author = createMockUser()

    const message = createMockMessage({ author })

    expect(author.client).toBe(message.client)
  })

  // Each held client is read before the interaction is made, so the structure already holds it
  it('take the client a given message already holds, before its channel and guild', () => {
    const message = createMockMessage()
    const channel = createMockChannel(TextChannel)
    const guild = createMockGuild()
    void [channel.client, guild.client]

    expect(createMockInteraction(ButtonInteraction, { customId: 'x', message, channel, guild } as never).client).toBe(message.client)
  })

  it('take the client a given channel already holds, before its guild', () => {
    const channel = createMockChannel(TextChannel)
    const held = channel.client
    const guild = createMockGuild()
    void guild.client

    expect(slash({ channel, guild }).client).toBe(held)
  })

  it("put a message given a channel and a guild on different clients on the channel's", () => {
    const [channel, guild] = [createMockChannel(TextChannel), createMockGuild()]
    const [channelClient, guildClient] = [channel.client, guild.client]

    const message = createMockMessage({ channel, guild })

    expect(message.client).toBe(channelClient)
    expect(guild.client).toBe(guildClient)
  })

  it('leave a guild whose client was read on it, given beside a channel on another client', () => {
    const [channel, guild] = [createMockChannel(TextChannel), createMockGuild()]
    const [channelClient, guildClient] = [channel.client, guild.client]

    const interaction = slash({ channel, guild })

    expect(interaction.client).toBe(channelClient)
    expect(guild.client).toBe(guildClient)
  })

  it('take the client a given guild already holds', () => {
    const guild = createMockGuild()

    expect(slash({ guild }).client).toBe(guild.client)
  })

  it('leave a structure already on another client where it is, neither moved nor refused', () => {
    const channel = createMockChannel(TextChannel)
    const own = channel.client
    const client = createMockClient()

    const interaction = slash({ channel, client })

    expect(interaction.client).toBe(client)
    expect(channel.client).toBe(own)
  })

  // A deep mock holds a stub, not a mock client, so there is none to share, as with a real Client
  it('leave a channel made with createMock() off the client, with no warning', () => {
    const channel = createMock<TextChannel>()

    const message = createMockMessage({ channel })

    expect(message.client).not.toBe(channel.client)
    expect(warned).toEqual([])
  })

  it('never take a real client from a structure, nor write to its caches', () => {
    const real = new Client({ intents: [] })
    const channel = createMockChannel(TextChannel, { client: real } as never)
    const cached = () => [[...real.users.cache.keys()], [...real.guilds.cache.keys()], [...real.channels.cache.keys()]]
    const before = cached()

    const interaction = slash({ channel })

    expect(interaction.client).not.toBe(real)
    expect(channel.client).toBe(real)
    expect(cached()).toEqual(before)
  })

  // A real Client given is the mock's own client alone; what the mock holds would otherwise read one not logged in
  it('keep what an interaction or message holds off a real client given as its client', () => {
    const real = new Client({ intents: [] })
    const request = vi.spyOn(real.rest, 'request')
    const guild = createMockGuild()
    const mentioned = createMockUser()

    const [optionUser, optionMember, picked] = [createMockUser(), createMockMember({ guild }), createMockUser()]
    const options = createChatInputOptions({ who: optionUser, whom: optionMember })

    const interaction = slash({ client: real, guild, guildId: guild.id, channel: createMockChannel(TextChannel, { guild }), options })
    const message = createMockMessage({ client: real, content: `<@${mentioned.id}>`, users: [mentioned] })
    const target = createMockMessage({ client: real })
    const quote = createMockInteraction(MessageContextMenuCommandInteraction, { commandName: 'Quote', targetMessage: target } as never)
    const menu = createMockInteraction(UserSelectMenuInteraction, { client: real, customId: 'pick', users: new Collection([[picked.id, picked]]) } as never)

    expect([interaction.client, menu.client]).toEqual([real, real])
    for (const held of [interaction.user, interaction.member, interaction.channel, interaction.guild, message.author, mentioned, optionUser, optionMember.user, picked]) {
      expect(held?.client).not.toBe(real)
    }
    // The users the client caches as the mocks are made, and none their options or the menu resolve to
    expect(new Set(real.users.cache.keys())).toEqual(new Set([interaction.user.id, menu.user.id, message.author.id, mentioned.id, target.author.id]))
    expect(quote.client).not.toBe(real)
    expect(guild.members.me?.user).toBe(guild.client.user)
    expect(interaction.appPermissions).toBeInstanceOf(PermissionsBitField)
    expect(request).not.toHaveBeenCalled()
  })

  it("put the users and members an interaction's options resolve to on its client", () => {
    const guild = createMockGuild()
    const [user, member, mentioned] = [createMockUser(), createMockMember({ guild }), createMockUser()]
    const options = createChatInputOptions({ who: user, whom: member, mention: mentioned })

    const interaction = slash({ guild, options })

    expect(interaction.options.getUser('who')?.client).toBe(interaction.client)
    expect(interaction.options.getMember('who')?.user.client).toBe(interaction.client)
    expect(interaction.options.getUser('whom')?.client).toBe(interaction.client)
    expect(interaction.options.getMentionable('mention')?.client).toBe(interaction.client)
    expect([user, member.user, mentioned].map(each => interaction.client.users.cache.get(each.id))).toEqual([user, member.user, mentioned])
  })

  it("put a role and a channel an interaction's options resolve to on its client", () => {
    const [role, channel] = [createMockInteraction(Role, {}), createMockChannel(TextChannel)]

    const interaction = slash({ options: createChatInputOptions({ what: role, where: channel }) })

    expect(interaction.options.getRole('what')?.client).toBe(interaction.client)
    expect(interaction.options.getChannel('where')?.client).toBe(interaction.client)
  })

  // Discord sends an autocomplete's options as ids, so strict mocks resolve none of them to a user
  it("leave a user an autocomplete's options are given off its client and its cache", () => {
    const user = createMockUser()

    const interaction = createMockInteraction(AutocompleteInteraction, { commandName: 'search', options: createChatInputOptions({ who: user }) } as never)

    expect(user.client).not.toBe(interaction.client)
    expect(interaction.client.users.cache.has(user.id)).toBe(false)
  })

  it('put what options assigned after the interaction is made resolve to on its client', () => {
    const [interaction, user] = [slash(), createMockUser()]

    interaction.options = createChatInputOptions({ who: user })

    expect(interaction.options.getUser('who')?.client).toBe(interaction.client)
  })

  it("put a user context menu's target user and member on its client, given or made", () => {
    const guild = createMockGuild()
    const menu = (props: Record<string, unknown>) =>
      createMockInteraction(UserContextMenuCommandInteraction, { commandName: 'Report', guild, guildId: guild.id, ...props } as never)

    for (const interaction of [menu({ targetUser: createMockUser() }), menu({})]) {
      expect(interaction.targetUser.client).toBe(interaction.client)
      expect(interaction.targetMember?.client).toBe(interaction.client)
    }
  })

  it("put a message context menu's target message on its client, made or given", () => {
    const menu = (props: Record<string, unknown>) => createMockInteraction(MessageContextMenuCommandInteraction, { commandName: 'Quote', ...props } as never)
    const [made, given] = [menu({}), menu({ targetMessage: createMockMessage() })]

    expect(made.targetMessage.client).toBe(made.client)
    expect(given.targetMessage.client).toBe(given.client)
  })

  it('take the client a given target message already holds, before its channel and guild', () => {
    const [targetMessage, channel, guild] = [createMockMessage(), createMockChannel(TextChannel), createMockGuild()]
    void [channel.client, guild.client]

    const interaction = createMockInteraction(MessageContextMenuCommandInteraction, { commandName: 'Quote', targetMessage, channel, guild } as never)

    expect(interaction.client).toBe(targetMessage.client)
  })

  // discord.js keeps one object for each id in a client's cache: the one cached first, as the interaction's own user is
  it("keep the user cached first for an id when an interaction's options resolve to another with it", () => {
    const [user, other] = [createMockUser(), createMockUser()]
    const [twin, otherTwin] = [createMockUser({ id: user.id }), createMockUser({ id: other.id })]

    const interaction = slash({ user, options: createChatInputOptions({ who: twin, first: other, second: otherTwin }) })

    expect(interaction.client.users.cache.get(user.id)).toBe(user)
    expect(interaction.client.users.cache.get(other.id)).toBe(other)
    expect(interaction.options.getUser('who')).toBe(twin)
  })

  it("put the users and members a select menu is given on its client", () => {
    const guild = createMockGuild()
    const [user, member] = [createMockUser(), createMockMember({ guild })]

    const menu = createMockInteraction(UserSelectMenuInteraction, {
      customId: 'pick',
      guild,
      users: new Collection([[user.id, user]]),
      members: new Collection([[member.id, member]]),
    } as never)

    expect(menu.users.first()?.client).toBe(menu.client)
    expect(menu.members.first()?.user.client).toBe(menu.client)
  })

  @Controller()
  class Panel {
    @Command('panel', CommandType.SLASH)
    async panel(interaction: ChatInputCommandInteraction) {
      await interaction.reply({ content: 'Pick one.' })
      const collector = new InteractionCollector<CollectedMessageInteraction>(interaction.channel!.client, { channel: interaction.channel!, max: 1 })
      collector.on('collect', click => respond(click).send({ content: `Picked ${click.customId}.` }))
    }
  }

  // discord.js's channel.createMessageComponentCollector() builds this collector, on the channel's client
  it.each([
    ['a server text channel', () => createMockChannel(TextChannel)],
    ['a DM channel', () => createMockChannel(DMChannel)],
  ])("collect, on the channel's client, a click built from the reply's message, in %s", async (_where, channelOf) => {
    const module = MeoCordTestingModule.create({ controllers: [Panel] }).compile()
    const command = createMockInteraction(ChatInputCommandInteraction, { commandName: 'panel', channel: channelOf() } as never)
    await module.dispatch(command)

    const click = createMockInteraction(ButtonInteraction, { customId: 'red', message: (await command.fetchReply()) as Message })
    await module.dispatch(click)

    expect(click.update).toHaveBeenCalledWith(expect.objectContaining({ content: 'Picked red.' }))
  })
})

describe('a mock interaction or message and what it holds, without strict mocks', () => {
  it('keep their own clients and warn once where code reads one', () => {
    const channel = createMockChannel(TextChannel)
    const interaction = slash({ channel })
    const message = createMockMessage()

    expect(interaction.channel?.client).not.toBe(interaction.client)
    expect(interaction.user.client).not.toBe(interaction.client)
    expect(message.author.client).not.toBe(message.client)
    const placed = createMockChannel(TextChannel)
    const held = placed.client
    expect(createMockMessage({ channel: placed }).client).not.toBe(held)
    const optionUser = createMockUser()
    const withOption = slash({ options: createChatInputOptions({ who: optionUser }) })
    expect(withOption.options.getUser('who')?.client).not.toBe(withOption.client)
    expect(clientWarnings()).toHaveLength(1)
    expect(clientWarnings()[0]).toContain('useStrictMocks()')
  })

  // A DM channel warns that its client is not its user's, so the read warns once, not again for the interaction's
  it("warn once for a read of a DM interaction's channel client", () => {
    const interaction = slash()

    void interaction.channel?.client

    expect(warned).toHaveLength(1)
  })

  it('warn for no read the mock makes itself', async () => {
    const interaction = slash({ channel: createMockChannel(TextChannel) })
    await interaction.reply('Pong.')
    await interaction.fetchReply()
    createMockMessage({ content: 'hi' })

    expect(clientWarnings()).toEqual([])
  })
})

// A user a test gives may be callable, as a deep mock's property or a vi.fn() with an id is: the member's user, never called
describe.each([
  ['without strict mocks', () => undefined],
  ['under strict mocks', () => useStrictMocks()],
])('a callable user a test gives, %s', (_mode, mode) => {
  beforeEach(() => mode())

  const callables = (): [string, User][] => [
    ['a createMock() user', createMock<User>({ id: '100000000000000801' })],
    ['a property of a createMock() mock', createMock<{ author: User }>().author],
    ['a vi.fn() with an id', Object.assign(vi.fn(), { id: '100000000000000802' }) as unknown as User],
  ]

  it.each(callables())("is the member's user of an interaction, a member, a message and a context menu's target: %s", (_kind, user) => {
    const guild = createMockGuild()

    expect(slash({ guild, guildId: guild.id, user }).member?.user).toBe(user)
    expect(createMockMember({ guild, user }).user).toBe(user)
    expect(createMockMessage({ guild, author: user }).member?.user).toBe(user)
    const menu = createMockInteraction(UserContextMenuCommandInteraction, { commandName: 'Report', targetUser: user, guild, guildId: guild.id } as never)
    expect(menu.targetMember?.user).toBe(user)
  })

  it('leaves the bot member on the user of a client the test gives the guild', () => {
    const guild = createMockGuild()
    const client = createMock<Client>()
    ;(guild as { client: unknown }).client = client

    expect(guild.members.me?.user).toBe(client.user)
  })
})
