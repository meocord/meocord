import 'reflect-metadata'
import * as discord from 'discord.js'
import {
  ButtonInteraction,
  ChatInputCommandInteraction,
  Client,
  DMChannel,
  ComponentType,
  type InteractionCollector,
  type InteractionResponse,
  type Message,
  type CollectedMessageInteraction,
  StringSelectMenuInteraction,
  TextChannel,
} from 'discord.js'
import { vi } from 'vitest'
import { Logger } from '@src/common/index.js'
import { forgetDeprecationWarnings } from '@src/common/deprecation.js'
import { Command, Controller, MessageHandler } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import {
  createMockChannel,
  createMockClient,
  createMockInteraction,
  createMockMessage,
  getResponse,
  MeoCordTestingModule,
  type TestingModule,
} from '@src/testing/index.js'
import { forgetStrictMocks, useStrictMocks } from '@src/testing/strict-mocks.js'

// A mock message's and a mock response's createMessageComponentCollector() and awaitMessageComponent() run discord.js's
// own under strict mocks (discord.js 14.27.0, src/structures/Message.js:691-732, InteractionResponse.js:49-72)

let warned: string[]
const collectorWarnings = () => warned.filter(text => text.includes('createMessageComponentCollector()'))

beforeEach(() => {
  forgetStrictMocks()
  forgetDeprecationWarnings()
  warned = []
  vi.spyOn(Logger.prototype, 'warn').mockImplementation((text: unknown) => void warned.push(String(text)))
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
})
afterEach(() => {
  vi.useRealTimers()
  forgetStrictMocks()
  vi.restoreAllMocks()
})

// What the handlers below collected, and why their collectors ended
let picked: string[]
let ended: string[]
beforeEach(() => {
  picked = []
  ended = []
})

/** Has a handler's collector answer each click it collects, and note why it ended. */
function watch(collector: InteractionCollector<CollectedMessageInteraction>): void {
  collector.on('collect', async click => {
    picked.push(click.customId)
    await click.update({ content: `Picked ${click.customId}.` })
  })
  collector.on('end', (_collected, reason) => void ended.push(reason))
}

@Controller()
class Panels {
  @Command('resource', CommandType.SLASH)
  async resource(interaction: ChatInputCommandInteraction) {
    const response = await interaction.reply({ content: 'Pick one.', withResponse: true })
    watch(response.resource!.message!.createMessageComponentCollector({ max: 1 }))
  }

  @Command('response', CommandType.SLASH)
  async response(interaction: ChatInputCommandInteraction) {
    watch((await interaction.reply({ content: 'Pick one.' })).createMessageComponentCollector({ max: 1 }))
  }

  @Command('awaited', CommandType.SLASH)
  async awaited(interaction: ChatInputCommandInteraction) {
    const response = await interaction.reply({ content: 'Pick one.' })
    const click = await response.awaitMessageComponent({ time: 5_000 })
    picked.push(click.customId)
    await click.update({ content: `Picked ${click.customId}.` })
  }

  @Command('deferred', CommandType.SLASH)
  async deferred(interaction: ChatInputCommandInteraction) {
    const response = await interaction.deferReply()
    await interaction.editReply({ content: 'Pick one.' })
    watch(response.createMessageComponentCollector({ max: 1 }))
  }

  @Command('open', CommandType.BUTTON)
  async open(interaction: ButtonInteraction) {
    watch((await interaction.update({ content: 'Pick one.' })).createMessageComponentCollector({ max: 1 }))
  }

  @Command('quiet', CommandType.BUTTON)
  async quiet(interaction: ButtonInteraction) {
    watch((await interaction.deferUpdate()).createMessageComponentCollector({ max: 1 }))
  }

  @Command('more', CommandType.BUTTON)
  async more(interaction: ButtonInteraction) {
    await interaction.deferUpdate()
    watch(interaction.message.createMessageComponentCollector({ max: 1 }))
  }

  @Command('routed', CommandType.BUTTON)
  async routed(interaction: ButtonInteraction) {
    await interaction.update({ content: 'Routed.' })
  }

  @Command('channel', CommandType.SLASH)
  async channel(interaction: ChatInputCommandInteraction) {
    await interaction.reply({ content: 'Pick one.' })
    watch(interaction.channel!.createMessageComponentCollector({ max: 1 }))
  }

  @Command('channelAwaited', CommandType.SLASH)
  async channelAwaited(interaction: ChatInputCommandInteraction) {
    await interaction.reply({ content: 'Pick one.' })
    const click = await interaction.channel!.awaitMessageComponent({ time: 5_000 })
    picked.push(click.customId)
    await click.update({ content: `Picked ${click.customId}.` })
  }

  @MessageHandler('panel')
  async panel(message: Message) {
    watch((await message.reply('Pick one.')).createMessageComponentCollector({ max: 1 }))
  }
}

const compile = () => MeoCordTestingModule.create({ controllers: [Panels] }).compile()
const slash = (commandName: string) => createMockInteraction(ChatInputCommandInteraction, { commandName })
const button = (customId: string, message: Message) => createMockInteraction(ButtonInteraction, { customId, message })
const sentText = (interaction: object) => JSON.stringify(getResponse(interaction as never).calls.map(call => call.payload ?? null))

describe("a mock's component collectors, under strict mocks", () => {
  beforeEach(() => useStrictMocks())

  describe.each([
    ['dispatch', (module: TestingModule, command: ChatInputCommandInteraction) => module.dispatch(command)],
    ['invoke', (module: TestingModule, command: ChatInputCommandInteraction) => module.invoke(Panels, command.commandName as 'resource', command)],
  ])('through %s', (_how, run) => {
    it.each(['resource', 'response', 'deferred'])("collect a click on the %s's message that dispatch delivers", async commandName => {
      const module = compile()
      const command = slash(commandName)
      await run(module, command)

      const click = button('red', (await command.fetchReply()) as Message)
      await module.dispatch(click)

      expect(picked).toEqual(['red'])
      expect(ended).toEqual(['limit'])
      expect(sentText(click)).toContain('Picked red.')
      expect(sentText(click)).not.toContain('Command not found')
    })

    it('resolve awaitMessageComponent with a click dispatched while the handler waits', async () => {
      const module = compile()
      const command = slash('awaited')
      const running = run(module, command)
      await vi.waitFor(() => expect(command.reply).toHaveBeenCalled())

      const click = button('blue', (await command.fetchReply()) as Message)
      await module.dispatch(click)
      await running

      expect(picked).toEqual(['blue'])
      expect(sentText(click)).toContain('Picked blue.')
    })
  })

  describe.each([
    ['a server text channel', () => createMockChannel(TextChannel)],
    ['a DM channel', () => createMockChannel(DMChannel)],
  ])("on an interaction's channel, %s", (_where, channelOf) => {
    const inChannel = (commandName: string) => createMockInteraction(ChatInputCommandInteraction, { commandName, channel: channelOf() } as never)

    it('collect a click built from the reply\'s message', async () => {
      const module = compile()
      const command = inChannel('channel')
      await module.dispatch(command)

      const click = button('red', (await command.fetchReply()) as Message)
      await module.dispatch(click)

      expect(picked).toEqual(['red'])
      expect(ended).toEqual(['limit'])
      expect(sentText(click)).toContain('Picked red.')
    })

    it("resolve awaitMessageComponent with a click built from the reply's message", async () => {
      const module = compile()
      const command = inChannel('channelAwaited')
      const running = module.dispatch(command)
      await vi.waitFor(() => expect(command.reply).toHaveBeenCalled())

      await module.dispatch(button('blue', (await command.fetchReply()) as Message))
      await running

      expect(picked).toEqual(['blue'])
    })

    it('leave a click in another channel uncollected', async () => {
      const module = compile()
      const command = inChannel('channel')
      await module.dispatch(command)

      const elsewhere = createMockMessage({ channel: channelOf(), client: command.client } as never)
      await module.dispatch(button('red', elsewhere))

      expect(picked).toEqual([])
    })
  })

  // Every discord.js class with the two methods, each mocked as a test would: a class added to discord.js fails here
  it('run on every discord.js class that has them', async () => {
    const command = slash('panel')
    const mocks: Record<string, () => Promise<object>> = {
      Message: async () => createMockMessage(),
      InteractionResponse: async () => (await command.reply({ content: 'Pick one.' })) as object,
      ...Object.fromEntries(
        ['BaseGuildTextChannel', 'BaseGuildVoiceChannel', 'DMChannel', 'NewsChannel', 'PartialGroupDMChannel', 'StageChannel', 'TextChannel', 'ThreadChannel', 'VoiceChannel'].map(
          name => [name, async () => createMockChannel((discord as unknown as Record<string, never>)[name]) as object],
        ),
      ),
    }
    const having = Object.entries(discord)
      .filter(([, value]) => typeof value === 'function' && 'createMessageComponentCollector' in ((value as { prototype?: object }).prototype ?? {}))
      .map(([name]) => name)
      .sort()

    expect(having).toEqual(Object.keys(mocks).sort())
    for (const name of having) {
      const target = (await mocks[name]!()) as { createMessageComponentCollector: () => InteractionCollector<CollectedMessageInteraction> }
      const collector = target.createMessageComponentCollector()
      expect([name, collector?.constructor.name]).toEqual([name, 'InteractionCollector'])
      collector.stop()
    }
  })

  it("collect a click on a message handler's reply", async () => {
    const module = compile()
    const message = createMockMessage({ content: 'panel' })
    await module.dispatch(message)

    const reply = (await vi.mocked(message.reply).mock.results[0]!.value) as Message
    await module.dispatch(button('green', reply))

    expect(picked).toEqual(['green'])
  })

  it.each(['open', 'quiet', 'more'])("collect a click on a component's message after %s", async customId => {
    const module = compile()
    const panel = createMockMessage({ content: 'Panel' })
    await module.dispatch(button(customId, panel))

    await module.dispatch(button('red', panel))

    expect(picked).toEqual(['red'])
  })

  it("give a click built from a message alone the message's client, so the collector sees it", async () => {
    const command = slash('panel')
    await command.reply({ content: 'Pick one.' })
    const message = (await command.fetchReply()) as Message

    const click = button('red', message)

    expect(click.client).toBe(message.client)
    expect(createMockInteraction(ButtonInteraction, { customId: 'red', message, client: createMockClient() }).client).not.toBe(message.client)
  })

  it('leave a component a route takes to the route, so no collector sees it', async () => {
    const module = compile()
    const command = slash('response')
    await module.dispatch(command)

    const click = button('routed', (await command.fetchReply()) as Message)
    await module.dispatch(click)

    expect(picked).toEqual([])
    expect(sentText(click)).toContain('Routed.')
  })

  it('collect each click on its own reply, with two collectors', async () => {
    const module = compile()
    const first = slash('response')
    const second = slash('response')
    await module.dispatch(first)
    await module.dispatch(second)

    await module.dispatch(button('second', (await second.fetchReply()) as Message))
    await module.dispatch(button('first', (await first.fetchReply()) as Message))

    expect(picked).toEqual(['second', 'first'])
  })

  it('stay mock functions that record each call and let a test set its own behaviour', async () => {
    const command = slash('panel')
    const response = (await command.reply({ content: 'Pick one.' })) as unknown as InteractionResponse
    const message = createMockMessage()

    const collector = response.createMessageComponentCollector({ time: 5_000 })
    vi.mocked(message.createMessageComponentCollector).mockReturnValue('own' as never)

    expect(response.createMessageComponentCollector).toHaveBeenCalledWith({ time: 5_000 })
    expect(collector.constructor.name).toBe('InteractionCollector')
    expect(message.createMessageComponentCollector()).toBe('own')
    collector.stop()
  })

  describe("discord.js's options and endings", () => {
    /** A reply with its message, and a click on the message by `userId`. */
    async function replied() {
      const command = slash('panel')
      const response = (await command.reply({ content: 'Pick one.' })) as unknown as InteractionResponse
      const message = (await command.fetchReply()) as Message
      return { response, message, client: message.client }
    }
    // One at a time, as the gateway delivers them: handleCollect awaits collect() before it emits 'collect'
    const emit = async (client: Client, ...interactions: object[]) => {
      for (const interaction of interactions) {
        client.emit('interactionCreate', interaction as never)
        await new Promise(resolve => setImmediate(resolve))
      }
    }

    it('keep max, filter and componentType', async () => {
      const { message, client } = await replied()
      const ids: string[] = []
      const collector = message.createMessageComponentCollector({
        componentType: ComponentType.StringSelect,
        filter: interaction => interaction.user.id === '100000000000000201',
        max: 1,
      })
      collector.on('collect', interaction => void ids.push(interaction.id))
      const reasons: string[] = []
      collector.on('end', (_collected, reason) => void reasons.push(reason))
      const select = (id: string, userId: string) =>
        createMockInteraction(StringSelectMenuInteraction, { customId: 'menu', message, id, user: { id: userId } as never })

      await emit(client, button('red', message), select('100000000000000301', '100000000000000202'), select('100000000000000302', '100000000000000201'), select('100000000000000303', '100000000000000201'))

      expect(ids).toEqual(['100000000000000302'])
      expect(reasons).toEqual(['limit'])
    })

    it("ends with discord.js's reasons: user on stop(), time and idle on theirs", async () => {
      const { response, message } = await replied()
      const reasons: string[] = []
      const ending = (collector: InteractionCollector<CollectedMessageInteraction>) =>
        new Promise<void>(resolve => collector.on('end', (_collected, reason) => void (reasons.push(reason), resolve())))
      const stopped = response.createMessageComponentCollector()
      const stop = ending(stopped)
      stopped.stop()
      await stop

      await ending(message.createMessageComponentCollector({ time: 10 }))
      await ending(message.createMessageComponentCollector({ idle: 10 }))

      expect(reasons).toEqual(['user', 'time', 'idle'])
    })

    it("rejects awaitMessageComponent with discord.js's error on its time", async () => {
      const { response } = await replied()

      await expect(response.awaitMessageComponent({ time: 10 })).rejects.toMatchObject({ code: 'InteractionCollectorError' })
    })

    it("runs its time in real milliseconds, not a test's fake timers, as discord.js takes setTimeout from node:timers", async () => {
      const { message } = await replied()
      vi.useFakeTimers()
      const reasons: string[] = []
      const collector = message.createMessageComponentCollector({ time: 20 })
      collector.on('end', (_collected, reason) => void reasons.push(reason))

      vi.advanceTimersByTime(60_000)
      expect(reasons).toEqual([])
      vi.useRealTimers()
      await new Promise(resolve => setTimeout(resolve, 40))

      expect(reasons).toEqual(['time'])
    })
  })

  // A real client's caches stay as the test left them: a click with its own client writes no guild or user to them
  it('give a click built from a message on a real Client a mock client of its own', () => {
    const client = new Client({ intents: [] })
    const message = createMockMessage({ client: client as never })
    const cached = () => [[...client.users.cache.keys()], [...client.guilds.cache.keys()]]
    const before = cached()

    const click = button('red', message)

    expect(click.client).not.toBe(client)
    expect(cached()).toEqual(before)
  })

  it('keep a mock on a real Client inert', async () => {
    const client = new Client({ intents: [] })
    const message = createMockMessage({ client: client as never })
    const channel = createMockChannel(TextChannel, { client } as never)

    expect(message.createMessageComponentCollector()).toBeUndefined()
    await expect(message.awaitMessageComponent()).resolves.toBeUndefined()
    expect(channel.createMessageComponentCollector()).toBeUndefined()
    await expect(channel.awaitMessageComponent()).resolves.toBeUndefined()
    expect(collectorWarnings()).toEqual([])
  })
})

describe("a mock's component collectors, without strict mocks", () => {
  // A reply resolves to no response here, so a message's and a channel's are the ones a test reaches
  it("stay inert and resolve to undefined, with one warning for a message's and a channel's", async () => {
    const message = createMockMessage()
    const channel = createMockChannel(TextChannel)

    expect(message.createMessageComponentCollector({ max: 1 })).toBeUndefined()
    await expect(message.awaitMessageComponent()).resolves.toBeUndefined()
    expect(channel.createMessageComponentCollector()).toBeUndefined()
    await expect(channel.awaitMessageComponent()).resolves.toBeUndefined()
    expect(message.createMessageComponentCollector).toHaveBeenCalledWith({ max: 1 })
    expect(collectorWarnings()).toHaveLength(1)
    expect(collectorWarnings()[0]).toContain('useStrictMocks()')
    expect(collectorWarnings()[0]).toContain('channel')
  })

  // Strict mocks keep these inert on a real Client too, so there is nothing to warn of
  it('stay inert on a real Client with no warning', async () => {
    const client = new Client({ intents: [] })
    const message = createMockMessage({ client: client as never })
    const channel = createMockChannel(TextChannel, { client } as never)

    expect(message.createMessageComponentCollector()).toBeUndefined()
    await expect(message.awaitMessageComponent()).resolves.toBeUndefined()
    expect(channel.createMessageComponentCollector()).toBeUndefined()
    await expect(channel.awaitMessageComponent()).resolves.toBeUndefined()
    expect(collectorWarnings()).toEqual([])
  })

  it("keeps a click's own client when it is built from a message alone", () => {
    const message = createMockMessage()

    expect(button('red', message).client).not.toBe(message.client)
  })
})
