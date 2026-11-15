import 'reflect-metadata'
import {
  ButtonInteraction,
  ChatInputCommandInteraction,
  InteractionCallbackResponse,
  InteractionResponse,
  InteractionResponseType,
  InteractionType,
  type Message,
  MessageFlags,
} from 'discord.js'
import { vi } from 'vitest'
import { Logger, respond } from '@src/common/index.js'
import { forgetDeprecationWarnings } from '@src/common/deprecation.js'
import { type ExecutionContext } from '@src/common/execution-context.js'
import { Command, Controller, Defer, Interceptor, UseInterceptor } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { type CallHandler, type InterceptorInterface } from '@src/interface/index.js'
import { createMockInteraction, createMockMessage, getResponse, MeoCordTestingModule } from '@src/testing/index.js'
import { forgetStrictMocks, useStrictMocks } from '@src/testing/strict-mocks.js'

let warned: string[]
const answerWarnings = () => warned.filter(text => text.includes('resolve to undefined here'))

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

const command = () => createMockInteraction(ChatInputCommandInteraction, { commandName: 'ping' })
// A mock's answer is typed without the overload withResponse picks
const callback = (resolved: unknown) => resolved as InteractionCallbackResponse
const button = () => createMockInteraction(ButtonInteraction, { customId: 'save' })

@Controller()
class Answers {
  @Command('deferred', CommandType.SLASH)
  @Defer()
  async deferred(interaction: ChatInputCommandInteraction) {
    await respond(interaction).send('Done.')
  }

  @Command('ping', CommandType.SLASH)
  async ping(interaction: ChatInputCommandInteraction) {
    await respond(interaction).send('Pong.')
  }

  @Command('save', CommandType.BUTTON)
  async save(interaction: ButtonInteraction) {
    await respond(interaction).send('Saved.')
  }

  // The handler's own deferReply(), sent while respond()'s reply is under way
  @Command('both', CommandType.SLASH)
  async both(interaction: ChatInputCommandInteraction) {
    const sending = respond(interaction).send('First.')
    await interaction.deferReply().catch(() => undefined)
    await sending.catch(() => undefined)
  }
}

@Interceptor()
class AcknowledgeFirst implements InterceptorInterface {
  async intercept(context: ExecutionContext, next: CallHandler) {
    await (context.getInteraction() as ChatInputCommandInteraction).deferReply()
    return next.handle()
  }
}

@Controller()
class Intercepted {
  @Command('intercepted', CommandType.SLASH)
  @UseInterceptor(AcknowledgeFirst)
  async intercepted(interaction: ChatInputCommandInteraction) {
    await respond(interaction).send('After the interceptor.')
  }
}

const compile = () => MeoCordTestingModule.create({ controllers: [Answers, Intercepted] }).compile()

describe('the answers of a mock interaction, without strict mocks', () => {
  it('resolve to undefined, with and without withResponse, as before', async () => {
    const asked = command()
    const deferred = command()
    const clicked = button()
    const acknowledged = button()

    await expect(asked.reply({ content: 'hi', withResponse: true })).resolves.toBeUndefined()
    await expect(deferred.deferReply()).resolves.toBeUndefined()
    await expect(clicked.update({ content: 'hi', withResponse: true })).resolves.toBeUndefined()
    await expect(acknowledged.deferUpdate({ withResponse: true })).resolves.toBeUndefined()
    await expect(command().reply({ content: 'hi' })).resolves.toBeUndefined()
  })

  it("leave respond()'s send() resolving as before", async () => {
    await expect(respond(command()).send('Pong.')).resolves.toBeUndefined()
    await expect(respond(button()).send('Saved.')).resolves.toBeUndefined()
  })

  it("warn once, from a test's own call", async () => {
    await command().reply({ content: 'hi' })
    await button().deferUpdate()

    expect(answerWarnings()).toHaveLength(1)
    expect(answerWarnings()[0]).toContain('useStrictMocks()')
    expect(answerWarnings()[0]).toContain('https://github.com/meocord/meocord/issues/441')
  })

  it('do not warn for a behaviour a test set', async () => {
    const asked = command()
    asked.reply.mockResolvedValue(undefined)

    await asked.reply({ content: 'hi' })

    expect(answerWarnings()).toEqual([])
  })

  it("do not warn for @Defer's acknowledgement, nor for respond()'s answers", async () => {
    const module = compile()
    const deferred = createMockInteraction(ChatInputCommandInteraction, { commandName: 'deferred' })
    const asked = command()
    const clicked = button()

    await module.dispatch(deferred)
    await module.dispatch(asked)
    await module.dispatch(clicked)

    expect(getResponse(deferred).calls.map(call => call.method)).toEqual(['deferReply', 'editReply'])
    expect(getResponse(asked).calls.map(call => call.method)).toEqual(['reply'])
    expect(getResponse(clicked).calls.map(call => call.method)).toEqual(['update'])
    expect(answerWarnings()).toEqual([])
  })

  it("still tell a test's call apart after one of MeoCord's own threw as it started", async () => {
    const broken = command()
    Object.assign(broken, {
      reply: () => {
        throw new Error('no reply')
      },
    })
    await expect(respond(broken).send('Pong.')).rejects.toThrow('no reply')
    expect(answerWarnings()).toEqual([])

    await command().reply({ content: 'hi' })

    expect(answerWarnings()).toHaveLength(1)
  })

  it("warn for a handler's own call made while respond()'s answer is under way", async () => {
    await compile().dispatch(createMockInteraction(ChatInputCommandInteraction, { commandName: 'both' }))

    expect(answerWarnings()).toHaveLength(1)
  })

  // Decided by where the call is made: inside one of MeoCord's own calls as it starts, here a behaviour a test set on
  // reply() that respond() runs, it counts as MeoCord's
  it("count a call made while one of MeoCord's own starts as MeoCord's", async () => {
    const asked = command()
    asked.reply.mockImplementation(() => {
      void asked.deferReply().catch(() => undefined)
      return Promise.resolve(undefined)
    })

    await respond(asked).send('Pong.')

    expect(asked.deferReply).toHaveBeenCalledTimes(1)
    expect(answerWarnings()).toEqual([])
  })

  // An interceptor runs outside MeoCord's own Discord calls, so its call is the app's
  it("warn for an interceptor's call, which is the app's", async () => {
    await compile().dispatch(createMockInteraction(ChatInputCommandInteraction, { commandName: 'intercepted' }))

    expect(answerWarnings()).toHaveLength(1)
  })
})

describe('the answers of a mock interaction, under strict mocks', () => {
  beforeEach(() => useStrictMocks())

  it('resolve to a mock InteractionResponse bound to the interaction', async () => {
    const asked = command()

    const response = await asked.reply({ content: 'hi' })

    expect(response).toBeInstanceOf(InteractionResponse)
    expect(response.interaction).toBe(asked)
    expect(response.id).toBe(asked.id)
    expect(response.client).toBe(asked.client)
  })

  it("edit, fetch and delete reach the interaction's own editReply, fetchReply and deleteReply", async () => {
    const asked = command()
    const response = await asked.reply({ content: 'hi' })

    const edited = await response.edit({ content: 'changed' })
    const fetched = await response.fetch()
    await response.delete()

    expect(edited.content).toBe('changed')
    expect(fetched.content).toBe('changed')
    expect(getResponse(asked).calls.map(call => call.method)).toEqual(['reply', 'editReply', 'deleteReply'])
    expect(asked.fetchReply).toHaveBeenCalledTimes(1)
  })

  it('has mock collector methods, as a mock message has', async () => {
    const response = await command().reply({ content: 'hi' })

    expect(vi.isMockFunction(response.createMessageComponentCollector)).toBe(true)
    expect(vi.isMockFunction(response.awaitMessageComponent)).toBe(true)
  })

  it('resolve deferReply, update and deferUpdate to one too', async () => {
    const deferred = command()
    const clicked = button()
    const acknowledged = button()

    expect(await deferred.deferReply()).toBeInstanceOf(InteractionResponse)
    expect(await clicked.update({ content: 'hi' })).toMatchObject({ interaction: clicked })
    expect(await acknowledged.deferUpdate()).toMatchObject({ interaction: acknowledged })
  })

  it("names an update's response by the interaction that sent the message, as discord.js does", async () => {
    const clicked = button()
    Object.assign(clicked.message, { interactionMetadata: { id: '1300000000000000001' } })
    const plain = button()
    Object.assign(plain.message, { interactionMetadata: null })

    expect((await clicked.update({ content: 'hi' })).id).toBe('1300000000000000001')
    expect((await plain.deferUpdate()).id).toBe(plain.id)
  })

  it('resolve reply with withResponse to an InteractionCallbackResponse holding the message sent, as fetchReply() reads it', async () => {
    const asked = command()

    const response = callback(await asked.reply({ content: 'hi', withResponse: true }))
    const fetched = await asked.fetchReply()

    expect(response).toBeInstanceOf(InteractionCallbackResponse)
    expect(response.resource?.type).toBe(InteractionResponseType.ChannelMessageWithSource)
    expect(response.resource?.message?.id).toBe(fetched.id)
    expect(response.resource?.message?.content).toBe('hi')
    expect(response.interaction).toMatchObject({
      id: asked.id,
      type: asked.type,
      responseMessageId: fetched.id,
      responseMessageLoading: false,
      responseMessageEphemeral: false,
      activityInstanceId: null,
    })
    const edited = await asked.editReply({ content: 'changed' })
    expect(edited.id).toBe(response.resource?.message?.id)
    // Snapshots, as fetchReply() and editReply() give: a message read before an edit keeps what it said
    expect(response.resource?.message?.content).toBe('hi')
    expect(response.resource?.message).not.toBe(fetched)
    expect(edited).not.toBe(fetched)
  })

  // Each case below is what Discord answered with_response in a live check (2026-11-15): a server's slash command, a
  // button on its plain reply and one on an ephemeral reply, and an edit after each deferral
  it("names a private reply's message ephemeral in the callback", async () => {
    const asked = command()

    const response = callback(await asked.reply({ content: 'hi', flags: MessageFlags.Ephemeral, withResponse: true }))

    expect(response.resource?.type).toBe(InteractionResponseType.ChannelMessageWithSource)
    expect(response.resource?.message?.flags.bitfield).toBe(MessageFlags.Ephemeral)
    expect(response.interaction).toMatchObject({ responseMessageId: (await asked.fetchReply()).id, responseMessageLoading: false, responseMessageEphemeral: true })
  })

  it('resolve deferReply with withResponse to a callback holding the loading message, whose id the reply keeps', async () => {
    const asked = command()

    const response = callback(await asked.deferReply({ withResponse: true }))
    const loading = await asked.fetchReply()
    const edited = await asked.editReply({ content: 'done' })

    expect(response.resource?.type).toBe(InteractionResponseType.ChannelMessageWithSource)
    expect(response.resource?.message?.flags.bitfield).toBe(MessageFlags.Loading)
    expect(response.interaction).toMatchObject({ responseMessageId: loading.id, responseMessageLoading: true, responseMessageEphemeral: false })
    expect(response.resource?.message?.id).toBe(loading.id)
    expect(loading.flags.bitfield).toBe(MessageFlags.Loading)
    expect(edited.id).toBe(loading.id)
    expect(edited.flags.bitfield).toBe(0)
  })

  it('resolve a private deferReply with withResponse to a callback holding a loading, ephemeral message', async () => {
    const asked = command()

    const response = callback(await asked.deferReply({ flags: MessageFlags.Ephemeral, withResponse: true }))
    const edited = await asked.editReply({ content: 'done' })

    expect(response.resource?.message?.flags.bitfield).toBe(MessageFlags.Loading | MessageFlags.Ephemeral)
    expect(response.interaction).toMatchObject({ responseMessageLoading: true, responseMessageEphemeral: true })
    // The edit ends the loading and keeps it private
    expect(edited.flags.bitfield).toBe(MessageFlags.Ephemeral)
  })

  it('resolve update with withResponse to a callback holding the updated message', async () => {
    const message = createMockMessage({ content: 'old' })
    const clicked = createMockInteraction(ButtonInteraction, { customId: 'save', message })

    const response = callback(await clicked.update({ content: 'updated', withResponse: true }))

    expect(response.resource?.type).toBe(InteractionResponseType.UpdateMessage)
    expect(response.resource?.message?.id).toBe(message.id)
    expect(response.resource?.message?.id).toBe((await clicked.fetchReply()).id)
    expect(response.resource?.message?.content).toBe('updated')
    expect(response.interaction).toMatchObject({ responseMessageId: message.id, responseMessageLoading: false, responseMessageEphemeral: false })
  })

  it("resolve deferUpdate with withResponse to a callback with no resource, naming the component's message", async () => {
    const message = createMockMessage({ content: 'old' })
    const clicked = createMockInteraction(ButtonInteraction, { customId: 'save', message })

    const response = callback(await clicked.deferUpdate({ withResponse: true }))

    expect(response.resource).toBeNull()
    expect(response.interaction).toMatchObject({
      type: InteractionType.MessageComponent,
      responseMessageId: message.id,
      responseMessageLoading: false,
      responseMessageEphemeral: false,
    })
  })

  // A button on an ephemeral message: the callback names it ephemeral, for an update and a deferUpdate alike
  it('name an update of a private message, and a deferUpdate on one, ephemeral', async () => {
    const message = createMockMessage({ content: 'old', flags: MessageFlags.Ephemeral })

    const updated = callback(await createMockInteraction(ButtonInteraction, { customId: 'save', message }).update({ content: 'new', withResponse: true }))
    const acknowledged = callback(await createMockInteraction(ButtonInteraction, { customId: 'save', message }).deferUpdate({ withResponse: true }))

    expect(updated.interaction.responseMessageEphemeral).toBe(true)
    expect(acknowledged.interaction.responseMessageEphemeral).toBe(true)
  })

  it("have respond()'s send() resolve the message the reply or the update sent", async () => {
    const asked = command()
    const clicked = createMockInteraction(ButtonInteraction, { customId: 'save', message: createMockMessage({ content: 'old' }) })

    const replied = (await respond(asked).send('Pong.')) as Message
    const updated = (await respond(clicked).send('Saved.')) as Message

    expect(replied.id).toBe((await asked.fetchReply()).id)
    expect(replied.content).toBe('Pong.')
    expect(updated.id).toBe(clicked.message.id)
    expect(updated.content).toBe('Saved.')
  })

  it('warn about none of it', async () => {
    await command().reply({ content: 'hi' })
    await compile().dispatch(createMockInteraction(ChatInputCommandInteraction, { commandName: 'both' }))

    expect(answerWarnings()).toEqual([])
  })
})
