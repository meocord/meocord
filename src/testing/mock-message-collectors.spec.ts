import 'reflect-metadata'
import * as discord from 'discord.js'
import {
  ChatInputCommandInteraction,
  Client,
  Collection,
  DMChannel,
  type Message,
  type MessageCollector,
  type MessageReplyOptions,
  MessageReaction,
  type ReactionCollector,
  TextChannel,
  type User,
} from 'discord.js'
import { vi } from 'vitest'
import { Logger } from '@src/common/index.js'
import { forgetDeprecationWarnings } from '@src/common/deprecation.js'
import { Command, Controller, MeoCord, MessageHandler, ReactionHandler } from '@src/decorator/index.js'
import { CommandType, ReactionHandlerAction } from '@src/enum/index.js'
import { createMockChannel, createMockClient, createMockInteraction, createMockMessage, createMockUser, MeoCordTestingModule } from '@src/testing/index.js'
import { forgetStrictMocks, useStrictMocks } from '@src/testing/strict-mocks.js'

// A mock channel's message collectors and a mock message's reaction collectors run discord.js's own under strict mocks,
// and dispatch delivers a message or a reaction to the client's listeners as the gateway does (discord.js 14.27.0,
// src/structures/interfaces/TextBasedChannel.js:313-347, Message.js:651-684, client/actions/MessageReactionAdd.js)

let warned: string[]
const collectorWarnings = () => warned.filter(text => text.includes('createMessageCollector()'))

beforeEach(() => {
  forgetStrictMocks()
  forgetDeprecationWarnings()
  warned = []
  vi.spyOn(Logger.prototype, 'warn').mockImplementation((text: unknown) => void warned.push(String(text)))
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
})
afterEach(() => {
  forgetStrictMocks()
  vi.restoreAllMocks()
})

// What the handlers below collected, and why their collectors ended
let collected: string[]
let ended: string[]
// Lets the slow handler below finish
let finishSlow: () => void
beforeEach(() => {
  collected = []
  ended = []
})

/** The text of each reply `message` sent, in order. */
const replies = (message: Message) => vi.mocked(message.reply).mock.calls.map(([options]) => (typeof options === 'string' ? options : (options as MessageReplyOptions).content))

@Controller()
class Conversations {
  @MessageHandler('quiz')
  async quiz(message: Message) {
    if (!message.channel.isSendable()) return
    await message.reply('What is 2 + 2?')
    const answers = await message.channel.awaitMessages({ filter: m => m.author.id === message.author.id, max: 1, time: 5_000 })
    await message.reply(answers.first()?.content === '4' ? 'Right.' : 'No.')
  }

  @MessageHandler('name')
  async name(message: Message) {
    if (!message.channel.isSendable()) return
    await message.reply('Your name?')
    const answers = await message.channel.awaitMessages({ filter: m => m.author.id === message.author.id, max: 1, time: 5_000 })
    await message.reply(`Hello, ${answers.first()?.content ?? 'nobody'}.`)
  }

  // A command whose handler waits until the test lets it finish
  @MessageHandler('slow')
  async slow(message: Message) {
    await new Promise<void>(resolve => (finishSlow = resolve))
    await message.reply('Slow done.')
  }

  @MessageHandler('listen')
  listen(message: Message) {
    if (!message.channel.isSendable()) return
    const collector = message.channel.createMessageCollector({ max: 1 })
    collector.on('collect', heard => void collected.push(heard.content))
    collector.on('end', (_collected, reason) => void ended.push(reason))
  }

  @Command('listen', CommandType.SLASH)
  async listenHere(interaction: ChatInputCommandInteraction) {
    await interaction.reply('Say something.')
    if (!interaction.channel?.isSendable()) return
    const collector = interaction.channel.createMessageCollector({ max: 1 })
    collector.on('collect', heard => void collected.push(heard.content))
  }
}

@MeoCord({ controllers: [Conversations], messages: { prefix: '!' }, clientOptions: { intents: [] } })
class App {}

const compile = () => MeoCordTestingModule.create({ app: App, controllers: [Conversations] }).compile()

/** A message in `channel`, from `author` unless another is given. */
const said = (channel: object, content: string, author?: User) => createMockMessage({ channel, content, ...(author && { author }) } as never)

/** A reaction to `message`, as a test builds one. */
const reactionTo = (message: Message, props: Record<string, unknown> = {}) =>
  createMockInteraction(MessageReaction, { emoji: { name: '⭐', id: null }, message, ...props } as never)

/** One turn, so a collector's async collect has run. */
const turn = () => new Promise(resolve => setImmediate(resolve))

describe("a mock's message and reaction collectors, under strict mocks", () => {
  beforeEach(() => useStrictMocks())

  describe('a handler that asks and waits for the answer', () => {
    it('hears an answer that matches no command', async () => {
      const module = compile()
      const channel = createMockChannel(TextChannel)
      const quiz = said(channel, '!quiz')
      const running = module.dispatch(quiz)
      await vi.waitFor(() => expect(channel.awaitMessages).toHaveBeenCalled())

      await module.dispatch(said(channel, '4', quiz.author))
      await running

      expect(replies(quiz)).toEqual(['What is 2 + 2?', 'Right.'])
    })

    it("hears an answer that another command takes, while that command's handler still waits", async () => {
      const module = compile()
      const channel = createMockChannel(TextChannel)
      const ask = said(channel, '!name')
      const running = module.dispatch(ask)
      await vi.waitFor(() => expect(channel.awaitMessages).toHaveBeenCalled())

      const answer = said(channel, '!slow', ask.author)
      const answering = module.dispatch(answer)
      await vi.waitFor(() => expect(replies(ask)).toEqual(['Your name?', 'Hello, !slow.']))
      expect(replies(answer)).toEqual([])
      finishSlow()
      await Promise.all([running, answering])

      expect(replies(answer)).toEqual(['Slow done.'])
    })

    it('leaves the message that starts a collector to it, and collects the next', async () => {
      const module = compile()
      const channel = createMockChannel(TextChannel)
      await module.dispatch(said(channel, '!listen'))

      await module.dispatch(said(channel, 'hello'))

      expect(collected).toEqual(['hello'])
      expect(ended).toEqual(['limit'])
    })

    it('leaves a message in another channel uncollected', async () => {
      const module = compile()
      const channel = createMockChannel(TextChannel)
      const start = said(channel, '!listen')
      await module.dispatch(start)

      await module.dispatch(createMockMessage({ channel: createMockChannel(TextChannel, { client: start.client } as never), content: 'elsewhere' } as never))

      expect(collected).toEqual([])
    })

    it.each([
      ['a server text channel', () => createMockChannel(TextChannel)],
      ['a DM channel', () => createMockChannel(DMChannel)],
    ])("hears a dispatched message on an interaction's channel, %s", async (_where, channelOf) => {
      const module = compile()
      const command = createMockInteraction(ChatInputCommandInteraction, { commandName: 'listen', channel: channelOf() } as never)
      await module.dispatch(command)

      await module.dispatch(said(command.channel!, 'from the channel'))

      expect(collected).toEqual(['from the channel'])
    })
  })

  describe("discord.js's message collector options", () => {
    it('keeps max, filter, and ends on stop(), time and idle with their reasons', async () => {
      const module = compile()
      const channel = createMockChannel(TextChannel)
      const author = createMockUser()
      const kept: string[] = []
      const collector = channel.createMessageCollector({ filter: m => m.author.id === author.id, max: 2 })
      collector.on('collect', m => void kept.push(m.content))
      const reasons: string[] = []
      const ending = (each: MessageCollector) => new Promise<void>(resolve => each.on('end', (_c, reason) => void (reasons.push(reason), resolve())))
      const limited = ending(collector)

      for (const [content, from] of [['one', author], ['skip', createMockUser()], ['two', author], ['three', author]] as const) {
        await module.dispatch(said(channel, content, from))
      }
      await limited
      const stopped = channel.createMessageCollector()
      const stop = ending(stopped)
      stopped.stop()
      await stop
      await ending(channel.createMessageCollector({ time: 10 }))
      await ending(channel.createMessageCollector({ idle: 10 }))

      expect(kept).toEqual(['one', 'two'])
      expect(reasons).toEqual(['limit', 'user', 'time', 'idle'])
    })

    it("rejects awaitMessages with errors: ['time'] on its time", async () => {
      const channel = createMockChannel(TextChannel)

      await expect(channel.awaitMessages({ time: 10, errors: ['time'] })).rejects.toBeInstanceOf(Collection)
    })

    it("disposes a collected message the test deletes with the client's own messageDelete", async () => {
      const module = compile()
      const channel = createMockChannel(TextChannel)
      const collector = channel.createMessageCollector({ dispose: true })
      const disposed: string[] = []
      collector.on('dispose', m => void disposed.push(m.content))
      const message = said(channel, 'gone soon')
      await module.dispatch(message)

      message.client.emit('messageDelete', message)
      await turn()

      expect(disposed).toEqual(['gone soon'])
      expect(collector.collected.size).toBe(0)
      collector.stop()
    })
  })

  describe('a dispatched reaction', () => {
    const bot = (message: Message) => message.client.user as User

    /** What a test reads of `reaction` on `message`. */
    const stateOf = (reaction: MessageReaction, message: Message) => ({
      count: reaction.count,
      countDetails: { ...reaction.countDetails },
      users: [...reaction.users.cache.keys()],
      me: reaction.me,
      cached: message.reactions.cache.get('⭐') === reaction,
    })

    it('is added as the gateway adds it, and taken away as it removes it', async () => {
      const module = compile()
      const message = createMockMessage()
      const reaction = reactionTo(message)
      const [ada, bea] = [createMockUser(), createMockUser()]

      await module.dispatch(reaction, { user: ada })
      const once = stateOf(reaction, message)
      await module.dispatch(reaction, { user: bea })
      await module.dispatch(reaction, { user: bot(message) })
      const thrice = stateOf(reaction, message)
      await module.dispatch(reaction, { user: ada, action: ReactionHandlerAction.REMOVE })
      await module.dispatch(reaction, { user: bea, action: ReactionHandlerAction.REMOVE })

      expect(once).toEqual({ count: 1, countDetails: { burst: 0, normal: 1 }, users: [ada.id], me: false, cached: true })
      expect(thrice).toEqual({ count: 3, countDetails: { burst: 0, normal: 3 }, users: [ada.id, bea.id, bot(message).id], me: true, cached: true })
      expect(stateOf(reaction, message)).toEqual({ count: 1, countDetails: { burst: 0, normal: 1 }, users: [bot(message).id], me: true, cached: true })
    })

    it('leaves its message once the last user takes theirs away', async () => {
      const module = compile()
      const message = createMockMessage()
      const reaction = reactionTo(message)
      const user = createMockUser()

      await module.dispatch(reaction, { user })
      await module.dispatch(reaction, { user, action: ReactionHandlerAction.REMOVE })

      expect(stateOf(reaction, message)).toEqual({ count: 0, countDetails: { burst: 0, normal: 0 }, users: [], me: false, cached: false })
    })

    it('reads countDetails as that many normal reactions until one is dispatched', () => {
      const message = createMockMessage()

      expect([reactionTo(message).countDetails, reactionTo(message, { count: 4 }).countDetails]).toEqual([
        { burst: 0, normal: 1 },
        { burst: 0, normal: 4 },
      ])
    })

    it('applies nothing for a remove once its message no longer caches it, and counts the next add from none', async () => {
      const module = compile()
      const message = createMockMessage()
      const reaction = reactionTo(message)
      const [ada, bea] = [createMockUser(), createMockUser()]
      const states: unknown[] = []

      await module.dispatch(reaction, { user: ada })
      await module.dispatch(reaction, { user: ada, action: ReactionHandlerAction.REMOVE })
      states.push(stateOf(reaction, message))
      await module.dispatch(reaction, { user: ada, action: ReactionHandlerAction.REMOVE })
      states.push(stateOf(reaction, message))
      await module.dispatch(reaction, { user: bea })
      states.push(stateOf(reaction, message))

      expect(states).toEqual([
        { count: 0, countDetails: { burst: 0, normal: 0 }, users: [], me: false, cached: false },
        { count: 0, countDetails: { burst: 0, normal: 0 }, users: [], me: false, cached: false },
        { count: 1, countDetails: { burst: 0, normal: 1 }, users: [bea.id], me: false, cached: true },
      ])
    })

    it("counts out a user who never reacted from a reaction its message caches, which stays while a user is left", async () => {
      const module = compile()
      const message = createMockMessage()
      const reaction = reactionTo(message)

      await module.dispatch(reaction, { user: bot(message) })
      await module.dispatch(reaction, { user: createMockUser(), action: ReactionHandlerAction.REMOVE })

      expect(stateOf(reaction, message)).toEqual({ count: 0, countDetails: { burst: 0, normal: 0 }, users: [bot(message).id], me: true, cached: true })
    })

    it("counts a reaction the mock emptied from none again, the test's own counts no longer on it", async () => {
      const module = compile()
      const message = createMockMessage()
      const reaction = reactionTo(message, { count: 1, countDetails: { burst: 1, normal: 0 } })
      const [ada, bea] = [createMockUser(), createMockUser()]

      await module.dispatch(reaction, { user: ada })
      await module.dispatch(reaction, { user: ada, action: ReactionHandlerAction.REMOVE })
      await module.dispatch(reaction, { user: bea, action: ReactionHandlerAction.REMOVE })
      await module.dispatch(reaction, { user: bea })

      expect(stateOf(reaction, message)).toEqual({ count: 1, countDetails: { burst: 0, normal: 1 }, users: [bea.id], me: false, cached: true })
    })

    it('counts the first add of a reaction the test caches itself, given no count, as one', async () => {
      const module = compile()
      const message = createMockMessage()
      const reaction = reactionTo(message)
      message.reactions.cache.set('⭐', reaction)

      await module.dispatch(reaction, { user: createMockUser() })

      expect([reaction.count, reaction.countDetails.normal]).toEqual([1, 1])
    })

    it("delivers a remove of a reaction its message doesn't cache and applies nothing to it", async () => {
      const module = compile()
      const message = createMockMessage()
      const reaction = reactionTo(message, { count: 2 })
      const heard = vi.fn()
      message.client.on('messageReactionRemove', heard)

      await module.dispatch(reaction, { user: createMockUser(), action: ReactionHandlerAction.REMOVE })

      expect([heard.mock.calls.length, reaction.count, message.reactions.cache.size]).toEqual([1, 2, 0])
    })

    it('keeps the count a test gives it, and counts from there', async () => {
      const module = compile()
      const message = createMockMessage()
      const reaction = reactionTo(message, { count: 4 })

      await module.dispatch(reaction, { user: createMockUser() })

      expect([reaction.count, reaction.countDetails.normal]).toEqual([5, 5])
    })

    it('keeps the countDetails a test gives it, and counts from there', async () => {
      const module = compile()
      const message = createMockMessage()
      const reaction = reactionTo(message, { count: 4, countDetails: { burst: 1, normal: 3 } })

      await module.dispatch(reaction, { user: createMockUser() })

      expect(reaction.countDetails).toEqual({ burst: 1, normal: 4 })
    })

    it("counts on from a count the test sets after a dispatch, where its message no longer caches it", async () => {
      const module = compile()
      const message = createMockMessage()
      const reaction = reactionTo(message)
      const [ada, bea] = [createMockUser(), createMockUser()]

      await module.dispatch(reaction, { user: ada })
      await module.dispatch(reaction, { user: ada, action: ReactionHandlerAction.REMOVE })
      reaction.count = 5
      await module.dispatch(reaction, { user: bea })

      expect(stateOf(reaction, message)).toEqual({ count: 6, countDetails: { burst: 0, normal: 1 }, users: [bea.id], me: false, cached: true })
    })

    it('counts on from countDetails the test sets after a dispatch, burst or normal', async () => {
      const module = compile()
      const [ada, bea] = [createMockUser(), createMockUser()]
      const states: unknown[] = []

      for (const written of [{ burst: 2, normal: 0 }, { burst: 0, normal: 3 }]) {
        const message = createMockMessage()
        const reaction = reactionTo(message)
        await module.dispatch(reaction, { user: ada })
        await module.dispatch(reaction, { user: ada, action: ReactionHandlerAction.REMOVE })
        reaction.countDetails = written
        await module.dispatch(reaction, { user: bea })
        states.push(stateOf(reaction, message))
      }

      expect(states).toEqual([
        { count: 1, countDetails: { burst: 2, normal: 1 }, users: [bea.id], me: false, cached: true },
        { count: 1, countDetails: { burst: 0, normal: 4 }, users: [bea.id], me: false, cached: true },
      ])
    })

    it('starts all of a reaction from none when its message no longer caches it: users and me too', async () => {
      const module = compile()
      const message = createMockMessage()
      const reaction = reactionTo(message)
      const [ada, bea] = [createMockUser(), createMockUser()]

      await module.dispatch(reaction, { user: bot(message) })
      await module.dispatch(reaction, { user: ada })
      message.reactions.cache.delete('⭐')
      await module.dispatch(reaction, { user: bea })

      expect(stateOf(reaction, message)).toEqual({ count: 1, countDetails: { burst: 0, normal: 1 }, users: [bea.id], me: false, cached: true })
    })

    it("counts on from what a test gives a reaction before its first dispatch: countDetails, me or users alone", async () => {
      const module = compile()
      const [ada, bea] = [createMockUser(), createMockUser()]
      const states: unknown[] = []

      for (const give of [
        (reaction: MessageReaction) => void (reaction.countDetails = { burst: 2, normal: 3 }),
        (reaction: MessageReaction) => void (reaction.me = true),
        (reaction: MessageReaction) => void reaction.users.cache.set(bea.id, bea),
      ]) {
        const message = createMockMessage()
        const reaction = reactionTo(message)
        give(reaction)
        await module.dispatch(reaction, { user: ada })
        states.push(stateOf(reaction, message))
      }

      expect(states).toEqual([
        { count: 2, countDetails: { burst: 2, normal: 4 }, users: [ada.id], me: false, cached: true },
        { count: 2, countDetails: { burst: 0, normal: 2 }, users: [ada.id], me: true, cached: true },
        { count: 2, countDetails: { burst: 0, normal: 2 }, users: [bea.id, ada.id], me: false, cached: true },
      ])
    })

    it('leaves the reaction its message already caches for that emoji there', async () => {
      const module = compile()
      const message = createMockMessage()
      const cached = reactionTo(message)
      message.reactions.cache.set('⭐', cached)
      const reaction = reactionTo(message)

      await module.dispatch(reaction, { user: createMockUser() })

      expect(message.reactions.cache.get('⭐')).toBe(cached)
    })

    it("reaches the client's listeners with discord.js's three arguments, routed or not", async () => {
      const module = compile()
      const message = createMockMessage()
      const reaction = reactionTo(message)
      const user = createMockUser()
      const heard: unknown[][] = []
      message.client.on('messageReactionAdd', (...args) => void heard.push(['add', ...args]))
      message.client.on('messageReactionRemove', (...args) => void heard.push(['remove', ...args]))

      await module.dispatch(reaction, { user })
      await module.dispatch(reaction, { user, action: ReactionHandlerAction.REMOVE })

      expect(heard).toEqual([
        ['add', reaction, user, { type: 0, burst: false }],
        ['remove', reaction, user, { type: 0, burst: false }],
      ])
    })

    it('reaches a listener as it is when partial, its count null and nothing applied', async () => {
      const module = compile()
      const message = createMockMessage()
      const reaction = reactionTo(message, { count: null })
      const seen: unknown[] = []
      message.client.on('messageReactionAdd', heard => void seen.push([heard.partial, heard.count, heard.users.cache.size]))

      await module.dispatch(reaction, { user: createMockUser() })

      expect(seen).toEqual([[true, null, 0]])
      expect(message.reactions.cache.size).toBe(0)
    })

    it("runs discord.js's reaction collector: collect, create on the first, and dispose and remove with dispose: true", async () => {
      const module = compile()
      const message = createMockMessage()
      const reaction = reactionTo(message)
      const [ada, bea] = [createMockUser(), createMockUser()]
      const events: string[] = []
      const collector: ReactionCollector = message.createReactionCollector({ dispose: true })
      for (const event of ['collect', 'create', 'remove', 'dispose'] as const) {
        collector.on(event, (_reaction: MessageReaction, user: User) => void events.push(`${event} ${user === ada ? 'ada' : 'bea'}`))
      }

      await module.dispatch(reaction, { user: ada })
      await module.dispatch(reaction, { user: bea })
      await module.dispatch(reaction, { user: bea, action: ReactionHandlerAction.REMOVE })
      await module.dispatch(reaction, { user: ada, action: ReactionHandlerAction.REMOVE })
      collector.stop()

      expect(events).toEqual(['create ada', 'collect ada', 'collect bea', 'remove bea', 'remove ada', 'dispose ada'])
    })

    it('resolves awaitReactions with the reaction a test dispatches', async () => {
      const module = compile()
      const message = createMockMessage()
      const reaction = reactionTo(message)
      const waiting = message.awaitReactions({ max: 1, time: 5_000 })

      await module.dispatch(reaction, { user: createMockUser() })

      expect([...(await waiting).values()]).toEqual([reaction])
    })
  })

  // A reaction is on its message's client, by the rule a mock interaction follows: the client given, else its
  // message's, a real Client included, else a new one, on which a message is made for it; a real Client given is its
  // own only
  describe("a reaction's client", () => {
    /** Whether a reaction dispatched on `reaction` reaches a listener on `client`. */
    const heardOn = async (client: Client, reaction: MessageReaction) => {
      const heard = vi.fn()
      client.on('messageReactionAdd', heard)
      await compile().dispatch(reaction, { user: createMockUser() })
      return heard.mock.calls.length === 1
    }

    it('is the client given to the reaction, on which its message is made', async () => {
      const client = createMockClient()
      const reaction = createMockInteraction(MessageReaction, { client, emoji: { name: '⭐', id: null } } as never)

      expect([reaction.client === client, reaction.message.client === client, await heardOn(client, reaction)]).toEqual([true, true, true])
    })

    it("is its message's client when the reaction is given none", async () => {
      const client = createMockClient()
      const reaction = reactionTo(createMockMessage({ client } as never))

      expect([reaction.client === client, await heardOn(client, reaction)]).toEqual([true, true])
    })

    it('is the one client given to both', async () => {
      const client = createMockClient()
      const reaction = reactionTo(createMockMessage({ client } as never), { client })

      expect([reaction.client === client, reaction.message.client === client, await heardOn(client, reaction)]).toEqual([true, true, true])
    })

    it('stays the one given to the reaction where its message is already on another', async () => {
      const [own, other] = [createMockClient(), createMockClient()]
      const reaction = reactionTo(createMockMessage({ client: other } as never), { client: own })

      expect([reaction.client === own, reaction.message.client === other, await heardOn(own, reaction)]).toEqual([true, true, true])
    })

    it("keeps a real Client given to the reaction to itself: its message is on a mock client, and dispatch reaches neither", async () => {
      const client = new Client({ intents: [] })
      const reaction = createMockInteraction(MessageReaction, { client, emoji: { name: '⭐', id: null } } as never)

      expect([reaction.client === client, reaction.message.client === (client as never), await heardOn(reaction.message.client, reaction)]).toEqual([
        true,
        false,
        false,
      ])
      expect(reaction.count).toBe(1)
    })

    it("is its message's real Client, which dispatch routes, applying and delivering nothing", async () => {
      const ran: string[] = []
      @Controller()
      class Stars {
        @ReactionHandler('⭐')
        star() {
          ran.push('star')
        }
      }
      const client = new Client({ intents: [] })
      const message = createMockMessage({ client } as never)
      const reaction = reactionTo(message)
      const heard = vi.fn()
      client.on('messageReactionAdd', heard)

      await MeoCordTestingModule.create({ controllers: [Stars] }).compile().dispatch(reaction, { user: createMockUser() })

      expect([reaction.client === client, ran, heard.mock.calls.length]).toEqual([true, ['star'], 0])
      expect([reaction.count, reaction.users.cache.size, message.reactions.cache.size]).toEqual([1, 0, 0])
    })

    it("is its message's client when partial", async () => {
      const client = createMockClient()
      const reaction = reactionTo(createMockMessage({ client } as never), { count: null })

      expect([reaction.client === client, await heardOn(client, reaction)]).toEqual([true, true])
    })
  })

  it("rejects dispatch with what a client's listener throws, for a message and a reaction", async () => {
    const module = compile()
    const message = createMockMessage({ content: 'hello' })
    const failure = new Error('listener failed')
    message.client.on('messageCreate', () => {
      throw failure
    })
    message.client.on('messageReactionAdd', () => {
      throw failure
    })

    await expect(module.dispatch(message)).rejects.toBe(failure)
    await expect(module.dispatch(reactionTo(message), { user: createMockUser() })).rejects.toBe(failure)
  })

  it("leaves emit() to the module's @On handlers, delivering nothing to the client's listeners", async () => {
    const module = compile()
    const message = createMockMessage({ content: 'hello' })
    const heard = vi.fn()
    message.client.on('messageCreate', heard)

    await module.emit('messageCreate', message)

    expect(heard).not.toHaveBeenCalled()
  })

  // Every discord.js class with the methods, each mocked as a test would: a class added to discord.js fails here.
  // PartialGroupDMChannel leaves them out (discord.js 14.27.0, src/structures/PartialGroupDMChannel.js:119-125)
  it('run on every discord.js class that has them', async () => {
    const messageCollectors = ['BaseGuildTextChannel', 'BaseGuildVoiceChannel', 'DMChannel', 'NewsChannel', 'StageChannel', 'TextChannel', 'ThreadChannel', 'VoiceChannel']
    const having = (method: string) =>
      Object.entries(discord)
        .filter(([, value]) => typeof value === 'function' && method in ((value as { prototype?: object }).prototype ?? {}))
        .map(([name]) => name)
        .sort()

    expect(having('createMessageCollector')).toEqual(messageCollectors)
    expect(having('createReactionCollector')).toEqual(['Message'])
    for (const name of messageCollectors) {
      const channel = createMockChannel((discord as unknown as Record<string, never>)[name]) as unknown as TextChannel
      const collector = channel.createMessageCollector()
      expect([name, collector?.constructor.name]).toEqual([name, 'MessageCollector'])
      collector.stop()
    }
    const reactions = createMockMessage().createReactionCollector()
    expect(reactions?.constructor.name).toBe('ReactionCollector')
    reactions.stop()
  })

  it('stay mock functions that record each call and let a test set its own behaviour', () => {
    const channel = createMockChannel(TextChannel)
    const message = createMockMessage()

    const collector = channel.createMessageCollector({ time: 5_000 })
    vi.mocked(message.createReactionCollector).mockReturnValue('own' as never)

    expect(channel.createMessageCollector).toHaveBeenCalledWith({ time: 5_000 })
    expect(collector.constructor.name).toBe('MessageCollector')
    expect(message.createReactionCollector()).toBe('own')
    collector.stop()
  })

  it('leave a real Client to its own gateway: dispatch reaches none of its listeners and changes no reaction', async () => {
    const module = compile()
    const client = new Client({ intents: [] })
    const message = createMockMessage({ client: client as never, content: 'hello' })
    const reaction = reactionTo(message, { client })
    const heard = vi.fn()
    client.on('messageCreate', heard)
    client.on('messageReactionAdd', heard)

    await module.dispatch(message)
    await module.dispatch(reaction, { user: createMockUser() })

    expect(heard).not.toHaveBeenCalled()
    expect([reaction.count, reaction.users.cache.size, message.reactions.cache.size]).toEqual([1, 0, 0])
  })

  it('keep a mock on a real Client inert', async () => {
    const client = new Client({ intents: [] })
    const channel = createMockChannel(TextChannel, { client } as never)
    const message = createMockMessage({ client: client as never })

    expect(channel.createMessageCollector()).toBeUndefined()
    expect((await channel.awaitMessages()).size).toBe(0)
    expect(message.createReactionCollector()).toBeUndefined()
    expect((await message.awaitReactions()).size).toBe(0)
    expect(collectorWarnings()).toEqual([])
  })
})

describe("a mock's message and reaction collectors, without strict mocks", () => {
  it('stay inert, resolving at once to an empty collection, with one warning', async () => {
    const channel = createMockChannel(TextChannel)
    const message = createMockMessage()

    expect(channel.createMessageCollector({ max: 1 })).toBeUndefined()
    expect((await channel.awaitMessages({ time: 5_000 })).size).toBe(0)
    expect(message.createReactionCollector()).toBeUndefined()
    expect((await message.awaitReactions({ time: 5_000 })).size).toBe(0)
    expect(channel.createMessageCollector).toHaveBeenCalledWith({ max: 1 })
    expect(collectorWarnings()).toHaveLength(1)
    expect(collectorWarnings()[0]).toContain('useStrictMocks()')
  })

  it("dispatches to no client listener and leaves a reaction as the test made it", async () => {
    const module = compile()
    const message = createMockMessage({ content: 'hello' })
    const reaction = reactionTo(message, { count: 1, users: { cache: new Collection() } })
    const heard = vi.fn()
    message.client.on('messageCreate', heard)
    message.client.on('messageReactionAdd', heard)

    await module.dispatch(message)
    await module.dispatch(reaction, { user: createMockUser() })

    expect(heard).not.toHaveBeenCalled()
    expect([reaction.count, reaction.users.cache.size, message.reactions.cache.size]).toEqual([1, 0, 0])
  })

  it("leave a reaction's client as it was, not its message's", () => {
    const message = createMockMessage()

    expect(reactionTo(message).client === message.client).toBe(false)
  })

  it('stay inert on a real Client with no warning', async () => {
    const client = new Client({ intents: [] })
    const channel = createMockChannel(TextChannel, { client } as never)

    expect(channel.createMessageCollector()).toBeUndefined()
    expect(collectorWarnings()).toEqual([])
  })
})
