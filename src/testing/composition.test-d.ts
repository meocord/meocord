import { describe, expectTypeOf, it } from 'vitest'
import {
  type AnyThreadChannel,
  AutocompleteInteraction,
  ButtonInteraction,
  CategoryChannel,
  ChannelSelectMenuInteraction,
  ChatInputCommandInteraction,
  type Client,
  type ClientEvents,
  Collection,
  DMChannel,
  ForumChannel,
  type Guild,
  type GuildBasedChannel,
  type GuildTextBasedChannel,
  type Interaction,
  type MessageReaction,
  MentionableSelectMenuInteraction,
  MessageContextMenuCommandInteraction,
  ModalSubmitInteraction,
  NewsChannel,
  PrimaryEntryPointCommandInteraction,
  Role,
  RoleSelectMenuInteraction,
  StageChannel,
  StringSelectMenuInteraction,
  type TextBasedChannel,
  type User,
  UserContextMenuCommandInteraction,
  UserSelectMenuInteraction,
  VoiceChannel,
  type GuildMember,
  type InteractionDeferUpdateOptions,
  type InteractionReplyOptions,
  type Message,
  type MessagePayload,
  type OmitPartialGroupDMChannel,
  TextChannel,
  ThreadChannel,
  type APIInteractionGuildMember,
} from 'discord.js'
import { MeoCordTestingModule } from './meocord-testing-module.js'
import { type ResponseCall } from '@src/common/response/response-state.js'
import { getResponse } from './response.js'
import { createModalFields } from './modal-fields.js'
import {
  createChatInputOptions,
  createMock,
  createMockChannel,
  createMockClient,
  createMockGuild,
  createMockInteraction,
  createMockMember,
  createMockRawMember,
  createMockMessage,
  createMockUser,
} from './mock-interaction.js'

/**
 * One mock passed where another factory, or the testing module, takes a discord.js value: each compiles with no cast.
 * Each slot is checked against every mock meant to fit it, as a union, so a factory added to a list is covered there.
 */

const client = createMockClient()
const guild = createMockGuild()
const member = createMockMember({ guild })
const user = createMockUser()

// Every interaction class discord.js dispatches, as a handler gets it
const interactions = [
  createMockInteraction(ChatInputCommandInteraction),
  createMockInteraction(AutocompleteInteraction),
  createMockInteraction(UserContextMenuCommandInteraction),
  createMockInteraction(MessageContextMenuCommandInteraction),
  createMockInteraction(PrimaryEntryPointCommandInteraction),
  createMockInteraction(ButtonInteraction),
  createMockInteraction(StringSelectMenuInteraction),
  createMockInteraction(UserSelectMenuInteraction),
  createMockInteraction(RoleSelectMenuInteraction),
  createMockInteraction(MentionableSelectMenuInteraction),
  createMockInteraction(ChannelSelectMenuInteraction),
  createMockInteraction(ModalSubmitInteraction),
]

// Every channel of a server, and the text-based ones an interaction or a message is sent in
const textChannels = [
  createMockChannel(TextChannel),
  createMockChannel(NewsChannel),
  createMockChannel(VoiceChannel),
  createMockChannel(StageChannel),
  createMockChannel(ThreadChannel),
]
const guildChannels = [...textChannels, createMockChannel(ForumChannel), createMockChannel(CategoryChannel)]

describe('the composition matrix', () => {
  it('passes each mock where discord.js and the testing module take its type', async () => {
    expectTypeOf<(typeof interactions)[number]>().toExtend<Interaction>()
    expectTypeOf(client).toExtend<Client<true>>()
    expectTypeOf([client.user, user, member.user]).toExtend<User[]>()
    expectTypeOf(guildChannels).toExtend<GuildBasedChannel[]>()
    expectTypeOf(textChannels).toExtend<GuildTextBasedChannel[]>()
    expectTypeOf([guild, member.guild, textChannels[0].guild]).toExtend<Guild[]>()

    const module = MeoCordTestingModule.create({}).compile()
    for (const interaction of interactions) {
      await module.dispatch(interaction)
      await module.emit('interactionCreate', interaction)
      getResponse(interaction)
    }
    await module.dispatch(createMockMessage())
    await module.dispatch(createMock<MessageReaction>({ message: createMockMessage() }), { user })
    await module.emit('messageCreate', createMockMessage({ channel: createMockChannel(DMChannel) }))
    await module.emit('threadCreate', createMockChannel(ThreadChannel), true)
    await module.emit('guildMemberAdd', member)
    await module.init({ ready: { client } })
  })

  it('feeds each mock back into the factories', () => {
    for (const channel of textChannels) {
      createMockInteraction(ButtonInteraction, { channel, client, user, member, guild })
      createMockMessage({ channel, client, author: user })
    }
    createMockInteraction(ChatInputCommandInteraction, {
      options: createChatInputOptions({ target: user, place: createMockChannel(ThreadChannel) }),
    })
    createMockInteraction(UserContextMenuCommandInteraction, { targetUser: user, targetMember: member })
    createMockInteraction(MessageContextMenuCommandInteraction, { targetMessage: createMockMessage() })
    createMockInteraction(ButtonInteraction, { message: createMockMessage() })
    createMockInteraction(ModalSubmitInteraction, { fields: createModalFields({ reason: 'spam' }) })
    createMockInteraction(RoleSelectMenuInteraction, {
      roles: new Collection([['1', createMockInteraction(Role)]]),
    })
    createMockGuild({ members: [member], channels: guildChannels, roles: [createMockInteraction(Role)] })
    createMockMember({ user: client.user, guild })
    createMockChannel(TextChannel, { guild, client })
    expectTypeOf(createMockMessage().channel).toExtend<TextBasedChannel>()
  })
})

describe('a mock reached through a nullable property', () => {
  it('keeps the mock API, beside the null', () => {
    const message = createMockMessage({ guild: createMockGuild() })

    expectTypeOf(message.member!.fetch.mockResolvedValue).toBeFunction()
    expectTypeOf(message.guild!.members.fetch.mockResolvedValue).toBeFunction()
    expectTypeOf(message.member).toExtend<GuildMember | null>()
  })
})

describe('an overloaded method', () => {
  it('takes what any of its overloads resolves to', () => {
    const guild = createMockGuild()
    const member = createMockMember({ guild })

    guild.members.fetch.mockResolvedValue(member)
    guild.members.fetch.mockResolvedValue(new Collection([[member.id, member]]))
    createMockChannel(TextChannel).messages.fetch.mockResolvedValue(createMockMessage())
  })
})

describe('an interaction outside a server', () => {
  it('is a raw-server interaction when given a raw member, its member the API member', () => {
    const command = createMockInteraction(ChatInputCommandInteraction, { guildId: '100000000000000001', member: createMockRawMember() })

    expectTypeOf(command).toExtend<ChatInputCommandInteraction<'raw'>>()
    expectTypeOf(command.member).toExtend<APIInteractionGuildMember>()
  })

  it('is built in a DM, and is no cached-guild interaction', () => {
    const dm = createMockInteraction(ChatInputCommandInteraction, { channel: createMockChannel(DMChannel), guild: null })

    expectTypeOf<null>().toExtend<typeof dm.guild>()
    expectTypeOf(dm).not.toExtend<ChatInputCommandInteraction<'cached'>>()
  })

  it('is a cached-guild interaction by default, as a handler for a server the bot is in takes', () => {
    expectTypeOf(createMockInteraction(ButtonInteraction)).toExtend<ButtonInteraction<'cached'>>()
  })
})

describe('a mock message', () => {
  it('is what discord.js emits for a message', () => {
    const module = MeoCordTestingModule.create({}).compile()

    expectTypeOf(createMockMessage()).toExtend<OmitPartialGroupDMChannel<Message>>()
    void module.emit('messageCreate', createMockMessage())
    expectTypeOf(createMockMessage()).toExtend<ClientEvents['messageCreate'][0]>()
  })

  it('may be in a server or not, as its guild says', () => {
    expectTypeOf<null>().toExtend<ReturnType<typeof createMockMessage>['guild']>()
  })
})

describe('a mock thread', () => {
  it('is a public or private thread, as discord.js types every thread it gives', () => {
    const thread = createMockChannel(ThreadChannel)

    expectTypeOf(thread).toExtend<AnyThreadChannel>()
    createMockInteraction(ChatInputCommandInteraction, { channel: thread })
    createMockGuild({ channels: [thread] })
  })
})

describe('a recorded response', () => {
  it('is still a ResponseCall to build from any payload, or to extend', () => {
    const unknownValue: unknown = { content: 'hi' }
    const call: ResponseCall = { method: 'reply', payload: unknownValue }
    interface Logged extends ResponseCall {
      at: number
    }
    expectTypeOf<Logged>().toExtend<ResponseCall>()
    expectTypeOf(getResponse(createMockInteraction(ButtonInteraction)).calls[0]).toExtend<ResponseCall>()
    void call
  })

  it('types its payload by the method that sent it', () => {
    const call = getResponse(createMockInteraction(ButtonInteraction)).calls[0]

    if (call.method === 'reply') expectTypeOf(call.payload).toEqualTypeOf<string | MessagePayload | InteractionReplyOptions | undefined>()
    if (call.method === 'deferUpdate') expectTypeOf(call.payload).toEqualTypeOf<InteractionDeferUpdateOptions | undefined>()
  })
})
