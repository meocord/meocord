import 'reflect-metadata'
import {
  ButtonInteraction,
  Client,
  type Interaction,
  InteractionCollector,
  InteractionType,
  ModalSubmitInteraction,
} from 'discord.js'
import { vi } from 'vitest'
import { Logger, respond } from '@src/common/index.js'
import { forgetDeprecationWarnings } from '@src/common/deprecation.js'
import { Command, Controller } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { UNROUTED_COMPONENT_GRACE_MS } from '@src/core/dispatcher.js'
import { createMockClient, createMockInteraction, getResponse, MeoCordTestingModule } from '@src/testing/index.js'
import { forgetStrictMocks, useStrictMocks } from '@src/testing/strict-mocks.js'

let warned: string[]
const emitterWarnings = () => warned.filter(text => text.includes("A mock client's on()"))

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

@Controller()
class Saved {
  @Command('save', CommandType.BUTTON)
  async save(interaction: ButtonInteraction) {
    await respond(interaction).send('Saved.')
  }
}

const compile = () => MeoCordTestingModule.create({ controllers: [Saved] }).compile()
const methods = (interaction: object) => getResponse(interaction as never).calls.map(call => call.method)
const sentText = (interaction: object) => JSON.stringify(getResponse(interaction as never).calls.map(call => call.payload ?? null))
const click = (client: Client<true>, customId = 'picked') => createMockInteraction(ButtonInteraction, { customId, client })
/** The timers dispatch set for the bot's grace. */
const graceTimers = (setTimeoutSpy: { mock: { calls: unknown[][] } }) =>
  setTimeoutSpy.mock.calls.filter(([, delay]) => delay === UNROUTED_COMPONENT_GRACE_MS)

describe("a mock client's emitter, under strict mocks", () => {
  beforeEach(() => useStrictMocks())

  it('attaches, reaches and lists listeners, as discord.js does, and records each call', () => {
    const client = createMockClient()
    const heard = vi.fn()

    expect(client.on('interactionCreate', heard)).toBe(client)
    expect(client.listeners('interactionCreate')).toEqual([heard])
    expect(client.listenerCount('interactionCreate')).toBe(1)
    expect(client.emit('interactionCreate', 'event' as never)).toBe(true)
    expect(heard).toHaveBeenCalledWith('event')
    expect(client.on).toHaveBeenCalledWith('interactionCreate', heard)

    client.off('interactionCreate', heard)
    expect(client.listenerCount('interactionCreate')).toBe(0)
    expect(client.emit('interactionCreate', 'event' as never)).toBe(false)
  })

  it('runs a once listener once', () => {
    const client = createMockClient()
    const heard = vi.fn()
    client.once('interactionCreate', heard)

    client.emit('interactionCreate', 'first' as never)
    client.emit('interactionCreate', 'second' as never)

    expect(heard.mock.calls).toEqual([['first']])
  })

  it('lets a test set its own behaviour', () => {
    const client = createMockClient()
    client.listenerCount.mockReturnValue(7)

    expect(client.listenerCount('interactionCreate')).toBe(7)
  })

  it("gives a collector made on the client what is emitted, and lets it remove its listener when it ends", () => {
    const client = createMockClient()
    const collected = vi.fn()
    const collector = new InteractionCollector(client, {})
    collector.on('collect', collected)

    expect(client.listenerCount('interactionCreate')).toBe(1)
    collector.stop()
    expect(client.listenerCount('interactionCreate')).toBe(0)
  })
})

describe('an unrouted component on a mock client, under strict mocks', () => {
  beforeEach(() => useStrictMocks())

  it('is left to a collector that answers, with no "Command not found!" and no wait', async () => {
    const client = createMockClient()
    const picked = click(client)
    new InteractionCollector(client, {}).on('collect', interaction => respond(interaction as ButtonInteraction).send({ content: 'collected' }))
    const timers = vi.spyOn(globalThis, 'setTimeout')

    const { handlers } = await compile().dispatch(picked)

    expect(methods(picked)).toEqual(['update'])
    expect(sentText(picked)).not.toContain('Command not found')
    expect(handlers).toEqual([])
    expect(graceTimers(timers)).toEqual([])
  })

  it('waits one turn of the event loop for a collector that answers after one', async () => {
    const client = createMockClient()
    const picked = click(client)
    new InteractionCollector(client, {}).on('collect', async interaction => {
      await new Promise(resolve => setImmediate(resolve))
      await respond(interaction as ButtonInteraction).send({ content: 'collected' })
    })

    await compile().dispatch(picked)

    expect(methods(picked)).toEqual(['update'])
  })

  it('resolves under fake timers without advancing them', async () => {
    vi.useFakeTimers()
    const client = createMockClient()
    const picked = click(client)
    new InteractionCollector(client, {}).on('collect', interaction => respond(interaction as ButtonInteraction).send({ content: 'collected' }))

    await compile().dispatch(picked)

    expect(methods(picked)).toEqual(['update'])
  })

  it('is left to a modal collector, as awaitModalSubmit uses', async () => {
    const client = createMockClient()
    const submit = createMockInteraction(ModalSubmitInteraction, { customId: 'form', client, type: InteractionType.ModalSubmit })
    new InteractionCollector(client, { interactionType: InteractionType.ModalSubmit }).on('collect', interaction =>
      respond(interaction as ModalSubmitInteraction).send({ content: 'saved' }),
    )

    await compile().dispatch(submit)

    expect(sentText(submit)).not.toContain('Command not found')
    expect(sentText(submit)).toContain('saved')
  })

  it('is answered "Command not found!" when the other listeners leave it unanswered', async () => {
    const client = createMockClient()
    const dead = click(client, 'dead')
    const heard = vi.fn()
    client.on('interactionCreate', heard)

    await compile().dispatch(dead)

    expect(heard).toHaveBeenCalledWith(dead)
    expect(sentText(dead)).toContain('Command not found')
  })

  it('is answered at once when nothing else listens', async () => {
    const dead = click(createMockClient(), 'dead')

    await compile().dispatch(dead)

    expect(sentText(dead)).toContain('Command not found')
  })

  it('reaches the listeners in the order they were attached, a once listener once', async () => {
    const client = createMockClient()
    const order: string[] = []
    client.on('interactionCreate', () => void order.push('first'))
    client.once('interactionCreate', () => void order.push('once'))
    client.on('interactionCreate', () => void order.push('last'))
    const module = compile()

    await module.dispatch(click(client, 'one'))
    await module.dispatch(click(client, 'two'))

    expect(order).toEqual(['first', 'once', 'last', 'first', 'last'])
  })

  it('is not delivered to the listeners when a route takes it, unlike on a bot', async () => {
    const client = createMockClient()
    const heard = vi.fn()
    client.on('interactionCreate', heard)

    await compile().dispatch(click(client, 'save'))

    expect(heard).not.toHaveBeenCalled()
  })

  // dispatch delivers it, as the gateway would: a test that emits it too delivers it a second time
  it('reaches a listener twice when the test also emits it', async () => {
    const client = createMockClient()
    const picked = click(client)
    const heard = vi.fn()
    client.on('interactionCreate', heard)

    client.emit('interactionCreate', picked)
    await compile().dispatch(picked)

    expect(heard).toHaveBeenCalledTimes(2)
  })

  it('rejects with what a listener throws, once MeoCord has answered, and reaches no listener after it', async () => {
    const client = createMockClient()
    const dead = click(client, 'dead')
    const after = vi.fn()
    client.on('interactionCreate', () => {
      throw new Error('listener broke')
    })
    client.on('interactionCreate', after)

    await expect(compile().dispatch(dead)).rejects.toThrow('listener broke')
    expect(sentText(dead)).toContain('Command not found')
    expect(after).not.toHaveBeenCalled()
  })

  it('rejects with what a listener rejects with', async () => {
    const client = createMockClient()
    client.on('interactionCreate', async () => {
      throw new Error('listener rejected')
    })

    await expect(compile().dispatch(click(client, 'dead'))).rejects.toThrow('listener rejected')
  })

  it('keeps the bot wait on a real Client, delivering nothing', async () => {
    vi.useFakeTimers({ now: Date.now() })
    const client = new Client({ intents: [] }) as Client<true>
    const dead = createMockInteraction(ButtonInteraction, { customId: 'dead', client })
    const heard = vi.fn()
    client.on('interactionCreate', heard)

    const done = compile().dispatch(dead)
    await vi.advanceTimersByTimeAsync(UNROUTED_COMPONENT_GRACE_MS - 1)
    expect(methods(dead)).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    await done

    expect(heard).not.toHaveBeenCalled()
    expect(sentText(dead)).toContain('Command not found')
    await client.destroy()
  })
})

describe("a mock client's emitter, without strict mocks", () => {
  it('attaches nothing and returns undefined, as before, warning once', () => {
    const client = createMockClient()
    const heard = vi.fn()

    expect(client.on('interactionCreate', heard)).toBeUndefined()
    expect(client.listeners('interactionCreate')).toBeUndefined()
    expect(client.listenerCount('interactionCreate')).toBeUndefined()
    expect(client.emit('interactionCreate', 'event' as never)).toBeUndefined()
    expect(heard).not.toHaveBeenCalled()
    expect(emitterWarnings()).toHaveLength(1)
    expect(emitterWarnings()[0]).toContain('https://github.com/meocord/meocord/issues/441')
  })

  it("answers an unrouted component at once, and MeoCord's own read of the listeners doesn't warn", async () => {
    const dead = click(createMockClient(), 'dead')

    await compile().dispatch(dead)

    expect(sentText(dead)).toContain('Command not found')
    expect(emitterWarnings()).toEqual([])
  })

  it('keeps the bot wait where a test has the listeners read report one, delivering nothing', async () => {
    vi.useFakeTimers({ now: Date.now() })
    const client = createMockClient()
    const heard = vi.fn()
    client.listeners.mockReturnValue([heard])
    const dead = click(client, 'dead')
    const timers = vi.spyOn(globalThis, 'setTimeout')

    const done = compile().dispatch(dead)
    await vi.advanceTimersByTimeAsync(UNROUTED_COMPONENT_GRACE_MS)
    await done

    expect(graceTimers(timers)).toHaveLength(1)

    expect(heard).not.toHaveBeenCalled()
    expect(sentText(dead)).toContain('Command not found')
  })

  it('leaves a listener the test attached out of dispatch', async () => {
    const client = createMockClient()
    const heard = vi.fn()
    client.on('interactionCreate', heard as (interaction: Interaction) => void)

    await compile().dispatch(click(client, 'dead'))

    expect(heard).not.toHaveBeenCalled()
  })
})
