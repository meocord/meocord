import { vi } from 'vitest'
import {
  ButtonInteraction,
  ChatInputCommandInteraction,
  Client,
  type Interaction,
  InteractionCollector,
  InteractionType,
  ModalSubmitInteraction,
} from 'discord.js'
import { Command, Controller, MeoCord, Observer, On } from '@src/decorator/index.js'
import { type ExecutionContext, respond } from '@src/common/index.js'
import { CommandType } from '@src/enum/index.js'
import { type DispatchResult } from '@src/interface/index.js'
import { MeoCordFactory } from '@src/core/meocord-factory.js'
import { createDiscordError, createMockInteraction, getResponse, MeoCordTestingModule } from '@src/testing/index.js'

vi.mock('@src/util/meocord-config-loader.util.js', () => ({ loadMeoCordConfig: () => ({ discordToken: 'token' }) }))
vi.mock('@src/util/platform.util.js', () => ({ assertBuiltForThisPlatform: () => {} }))

@Controller()
class Routed {
  @Command('routed', CommandType.BUTTON)
  routed() {}
}

const compile = () => MeoCordTestingModule.create({ controllers: [Routed] }).compile()
const methods = (interaction: object) => getResponse(interaction as never).calls.map(call => call.method)
const contents = (interaction: object) =>
  getResponse(interaction as never).calls.map(call => JSON.stringify(call.payload ?? null))

let client: Client<true>

beforeEach(() => {
  vi.useFakeTimers({ now: Date.now() })
  // A client as a bot has it once online, which interactions come to
  client = new Client({ intents: [] }) as Client<true>
})
afterEach(async () => {
  vi.useRealTimers()
  await client.destroy()
})

/** As the gateway delivers it: MeoCord's listener first, then every other listener on the client, a collector's included. */
async function deliver(module: ReturnType<typeof compile>, interaction: object) {
  const dispatched = module.dispatch(interaction as never)
  client.emit('interactionCreate', interaction as never)
  await vi.advanceTimersByTimeAsync(0)
  return dispatched
}

describe('an unrouted component a collector answers', () => {
  it('is left to the collector, with no "Command not found!"', async () => {
    const click = createMockInteraction(ButtonInteraction, { customId: 'picked', client })
    new InteractionCollector(client, {}).on('collect', interaction => respond(interaction as ButtonInteraction).send({ content: 'collected' }))

    const done = deliver(compile(), click)
    await vi.advanceTimersByTimeAsync(3_000)
    const { handlers } = await done

    expect(methods(click)).toEqual(['update'])
    expect(contents(click).join()).not.toContain('Command not found')
    expect(handlers).toEqual([])
  })

  it('is left to a modal collector, as awaitModalSubmit uses', async () => {
    const submit = createMockInteraction(ModalSubmitInteraction, { customId: 'form', client, type: InteractionType.ModalSubmit })
    new InteractionCollector(client, { interactionType: InteractionType.ModalSubmit }).on('collect', interaction =>
      respond(interaction as ModalSubmitInteraction).send({ content: 'saved' }),
    )

    const done = deliver(compile(), submit)
    await vi.advanceTimersByTimeAsync(3_000)
    await done

    expect(contents(submit).join()).not.toContain('Command not found')
    expect(methods(submit)).toHaveLength(1)
  })

  it('is answered "Command not found!" after 1.5 s when another listener leaves it unanswered', async () => {
    const click = createMockInteraction(ButtonInteraction, { customId: 'dead', client })
    client.on('interactionCreate', () => {})

    const done = deliver(compile(), click)
    await vi.advanceTimersByTimeAsync(1_499)
    expect(methods(click)).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    await done

    expect(contents(click).join()).toContain('Command not found')
  })

  it('says nothing more when another answer reaches Discord first, at the end of the grace', async () => {
    const click = createMockInteraction(ButtonInteraction, { customId: 'raced', client })
    client.on('interactionCreate', () => {})
    // Answered directly with discord.js, in flight when the grace ends: Discord refuses MeoCord's answer
    click.reply.mockRejectedValueOnce(createDiscordError(40060))

    const done = deliver(compile(), click)
    await vi.advanceTimersByTimeAsync(1_500)
    await done

    expect(methods(click)).toEqual(['reply'])
  })

  it('says nothing when another answer comes while the answer waits on an async step, such as a themeFor lookup', async () => {
    @MeoCord({
      controllers: [Routed],
      clientOptions: { intents: [] },
      themeFor: { guild: async () => void (await new Promise(resolve => setTimeout(resolve, 10))) },
    })
    class SlowTheme {}
    const click = createMockInteraction(ButtonInteraction, { customId: 'late', client })
    Object.assign(click, { guildId: '100000000000000001' })
    // Answered directly with discord.js just after the grace, while MeoCord looks up the server's theme
    client.on('interactionCreate', interaction => void setTimeout(() => void (interaction as ButtonInteraction).update({ content: 'late' }), 1_505))

    const done = deliver(MeoCordTestingModule.create({ app: SlowTheme, controllers: [Routed] }).compile(), click)
    await vi.advanceTimersByTimeAsync(3_000)
    await done

    // The late answer alone: no "Command not found!", as a reply or a follow-up
    expect([click.update.mock.calls.length, click.reply.mock.calls.length, click.followUp.mock.calls.length]).toEqual([1, 0, 0])
  })

  it('is answered at once when nothing else listens', async () => {
    const click = createMockInteraction(ButtonInteraction, { customId: 'dead', client })

    await compile().dispatch(click)

    expect(contents(click).join()).toContain('Command not found')
  })

  it('leaves an unrouted command answered at once, whatever else listens', async () => {
    const command = createMockInteraction(ChatInputCommandInteraction, { commandName: 'gone', client })
    client.on('interactionCreate', () => {})

    await compile().dispatch(command)

    expect(contents(command).join()).toContain('Command not found')
  })
})

describe("an unrouted component an app's own @On('interactionCreate') answers", () => {
  // Such a listener is another that may answer, so the click is left to it as to a collector
  @Controller()
  class OwnRouter {
    @On('interactionCreate')
    async route(interaction: Interaction) {
      if (interaction.isButton() && interaction.customId === 'own/route') await respond(interaction).send({ content: 'routed by the app' })
    }
  }

  @MeoCord({ controllers: [Routed, OwnRouter], clientOptions: { intents: [] } })
  class App {}

  it('gets that answer alone, as the bot delivers it', async () => {
    vi.spyOn(Client.prototype, 'login').mockImplementation(function (this: Client) {
      client = this as Client<true>
      return Promise.resolve('token')
    })
    await MeoCordFactory.create(App).start()
    const click = createMockInteraction(ButtonInteraction, { customId: 'own/route', client })

    client.emit('interactionCreate', click)
    await vi.advanceTimersByTimeAsync(3_000)

    expect(methods(click)).toEqual(['update'])
    expect(contents(click).join()).not.toContain('Command not found')
  })
})

describe('what the observers hear of an unrouted component', () => {
  const settled: string[] = []

  @Observer()
  class Outcomes {
    onSettled(_context: ExecutionContext, { outcome }: DispatchResult) {
      settled.push(outcome)
    }
  }

  const observed = () => MeoCordTestingModule.create({ controllers: [Routed], observers: [Outcomes] }).compile()

  beforeEach(() => {
    settled.length = 0
  })

  it('is nothing for a click a collector answered, since MeoCord neither answered nor failed it', async () => {
    const click = createMockInteraction(ButtonInteraction, { customId: 'picked', client })
    new InteractionCollector(client, {}).on('collect', interaction => respond(interaction as ButtonInteraction).send({ content: 'collected' }))

    const done = deliver(observed(), click)
    await vi.advanceTimersByTimeAsync(3_000)
    await done

    expect(settled).toEqual([])
  })

  it("is 'not-found' for a click nothing answered, after the grace", async () => {
    const click = createMockInteraction(ButtonInteraction, { customId: 'dead', client })
    client.on('interactionCreate', () => {})

    const done = deliver(observed(), click)
    await vi.advanceTimersByTimeAsync(3_000)
    await done

    expect(settled).toEqual(['not-found'])
  })
})
