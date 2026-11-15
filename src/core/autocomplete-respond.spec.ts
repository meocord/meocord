import { Container } from 'inversify'
import { AutocompleteInteraction } from 'discord.js'
import { vi } from 'vitest'
import { Logger } from '@src/common/index.js'
import { Autocomplete, Controller } from '@src/decorator/index.js'
import { MetadataKey } from '@src/enum/index.js'
import { MeoCordApp } from '@src/core/meocord.app.js'
import { bindGlobalStages, globalStagesOf } from '@src/core/handler-pipeline.js'
import { createDiscordError, createMockInteraction } from '@src/testing/index.js'

// A bot's autocomplete handler may call respond() without waiting for it: discord.js marks the interaction responded
// only once Discord has answered, so the close of an unanswered menu waits for that answer before judging.

/** How long Discord takes to answer a respond() here. */
const ANSWER_MS = 30

/** How the handler reads its answer's outcome: each way but `unawaited` lets it see a failure. */
const READS = {
  awaited: async (sent: Promise<unknown>) => void (await sent),
  'awaited in try/catch': async (sent: Promise<unknown>) => {
    try {
      await sent
    } catch {
      // Handled here
    }
  },
  '.catch()': (sent: Promise<unknown>) => void sent.catch(() => undefined),
  '.then(_, onRejected)': (sent: Promise<unknown>) => void sent.then(undefined, () => undefined),
  '.finally().catch()': (sent: Promise<unknown>) => void sent.finally(() => undefined).catch(() => undefined),
  'Promise.all().catch()': (sent: Promise<unknown>) => void Promise.all([sent]).catch(() => undefined),
  unawaited: (_sent: Promise<unknown>) => undefined,
}
let how: keyof typeof READS | 'none' | 'replaced' | 'twice' | 'throws' | 'thenable read' | 'thenable unread' = 'awaited'
/** What the handler's `respond()` gave it. */
let returned: unknown
/** What a handler's own respond, put in place of the interaction's, answered. */
let elsewhere: unknown[] = []

@Controller()
class Search {
  @Autocomplete('search')
  async suggest(interaction: AutocompleteInteraction) {
    if (how === 'none') return
    if (how === 'twice') {
      void interaction.respond([{ name: 'tea', value: 'tea' }])
      void interaction.respond([{ name: 'coffee', value: 'coffee' }])
      return
    }
    if (how === 'throws') {
      void interaction.respond([{ name: 'tea', value: 'tea' }])
      throw new Error('search failed')
    }
    if (how === 'thenable read' || how === 'thenable unread') {
      const sent = interaction.respond([{ name: 'tea', value: 'tea' }])
      if (how === 'thenable read') {
        try {
          await sent
        } catch {
          // Handled here
        }
      }
      // Still at work once the answer has failed
      await new Promise(resolve => setTimeout(resolve, 2 * ANSWER_MS))
      return
    }
    if (how === 'replaced') {
      // A handler that puts its own respond in place of the interaction's, which answers some other way
      interaction.respond = (async (choices: unknown) => void elsewhere.push(choices)) as typeof interaction.respond
      await interaction.respond([{ name: 'tea', value: 'tea' }])
      return
    }
    returned = interaction.respond([{ name: 'tea', value: 'tea' }])
    await READS[how](returned as Promise<unknown>)
  }
}

async function startBot(warnSlow?: boolean) {
  const container = new Container()
  // The stages an app without any has, with its warnSlow
  if (warnSlow !== undefined) bindGlobalStages(container, { ...globalStagesOf(new Container()), warnSlow })
  container.bind(Search).toSelf().inSingletonScope()
  Reflect.defineMetadata(MetadataKey.Container, container, Search)
  const listeners = new Map<string, (...args: unknown[]) => Promise<void>>()
  const client = {
    on: vi.fn((event: string, listener: (...args: unknown[]) => Promise<void>) => listeners.set(event, listener)),
    login: vi.fn().mockResolvedValue('token'),
    user: { setActivity: vi.fn() },
    application: null,
  }
  await new MeoCordApp([Search], container, client as never, 't').start()
  return (interaction: unknown) => listeners.get('interactionCreate')!(interaction)
}

/** An autocomplete whose respond() answers as discord.js's does: `responded` once Discord has, and once only. */
function typed(fails?: unknown) {
  const interaction = createMockInteraction(AutocompleteInteraction, { commandName: 'search' })
  const sent: unknown[] = []
  Object.defineProperty(interaction, 'responded', { value: false, writable: true })
  Object.defineProperty(interaction, 'respond', {
    configurable: true,
    writable: true,
    value: async (choices: unknown) => {
      sent.push(choices)
      await new Promise(resolve => setTimeout(resolve, ANSWER_MS))
      if (fails) throw fails
      if (interaction.responded) throw new Error('Interaction has already been acknowledged.')
      ;(interaction as { responded: boolean }).responded = true
    },
  })
  return { interaction, sent }
}

let warned: string[]
let errors: string[]
let debugged: string[]
/** What the process was told nobody handled, read by a listener of its own rather than the test runner's. */
let unhandled: unknown[]
const noteUnhandled = (reason: unknown) => void unhandled.push(reason)
/** Long enough for the process to tell of a rejection nobody handled. */
const settledRejections = () => new Promise(resolve => setTimeout(resolve, 0))

beforeEach(() => {
  warned = []
  errors = []
  debugged = []
  unhandled = []
  process.on('unhandledRejection', noteUnhandled)
  vi.spyOn(Logger.prototype, 'warn').mockImplementation((text: unknown) => void warned.push(String(text)))
  vi.spyOn(Logger.prototype, 'error').mockImplementation((text: unknown) => void errors.push(String(text)))
  vi.spyOn(Logger.prototype, 'debug').mockImplementation((text: unknown) => void debugged.push(String(text)))
})
afterEach(() => {
  process.off('unhandledRejection', noteUnhandled)
  how = 'awaited'
  vi.restoreAllMocks()
})

describe("an autocomplete handler's respond() in a bot", () => {
  it.each(['awaited', 'unawaited'] as const)('answers once, with nothing logged, %s', async handler => {
    how = handler
    const dispatch = await startBot()
    const { interaction, sent } = typed()

    await dispatch(interaction)

    expect(sent).toEqual([[{ name: 'tea', value: 'tea' }]])
    expect(warned.filter(text => text.startsWith('Search.suggest'))).toEqual([])
    expect(errors).toEqual([])
  })

  it('is closed with no choices when the handler never calls it', async () => {
    how = 'none'
    const dispatch = await startBot()
    const { interaction, sent } = typed()

    await dispatch(interaction)

    expect(sent).toEqual([[]])
    expect(warned).toEqual([expect.stringContaining('Search.suggest returned without answering its autocomplete, so MeoCord closed the menu')])
  })

  // An answer the handler didn't wait for is timed when it settles, and one that fails is reported rather than timed
  it.each([
    ['goes through', 1_980, undefined, ['Search.suggest took 2.0 s']],
    ['fails', 2_100, new Error('answer failed'), []],
  ] as const)('times an unawaited answer that %s when it settles', async (_how, lag, fails, expected) => {
    how = 'unawaited'
    const dispatch = await startBot()
    const { interaction } = typed(fails)
    // Created before the call, so the answer's own time decides which side of 2 s it lands
    Object.defineProperty(interaction, 'createdTimestamp', { value: Date.now() - lag })

    await dispatch(interaction)

    expect(warned.filter(text => text.startsWith('Search.suggest took')).map(text => text.slice(0, 'Search.suggest took 2.0 s'.length))).toEqual(expected)
  })

  it('reports an unawaited answer Discord refused as expired as the miss', async () => {
    how = 'unawaited'
    const dispatch = await startBot()
    const { interaction, sent } = typed(createDiscordError(10062))

    await dispatch(interaction)

    expect(sent).toHaveLength(1)
    expect(warned).toEqual([expect.stringMatching(/^Discord refused Search\.suggest's choices for \/search as expired, after \d+\.\d s by MeoCord's count/)])
    expect(errors).toEqual([])
  })

  it.each(Object.keys(READS).filter(read => read !== 'unawaited' && read !== 'awaited') as (keyof typeof READS)[])(
    'logs nothing of a failed answer the handler read by %s, whatever warnSlow says',
    async read => {
      for (const warnSlow of [undefined, false]) {
        for (const failure of [createDiscordError(10062), new Error('socket hang up')]) {
          how = read
          warned.length = 0
          errors.length = 0
          const dispatch = await startBot(warnSlow)
          const { interaction, sent } = typed(failure)

          await dispatch(interaction)

          expect(sent).toHaveLength(1)
          expect([...warned.filter(text => !text.startsWith('registerCommands')), ...errors]).toEqual([])
        }
      }
    },
  )

  it("gives the handler respond()'s promise as a Promise, and leaves the mock's record as it was", async () => {
    how = 'awaited'
    const dispatch = await startBot()
    const interaction = createMockInteraction(AutocompleteInteraction, { commandName: 'search' })

    await dispatch(interaction)

    expect(returned).toBeInstanceOf(Promise)
    for (const chained of [(returned as Promise<unknown>).then(), (returned as Promise<unknown>).catch(() => undefined), (returned as Promise<unknown>).finally()]) {
      expect(chained).toBeInstanceOf(Promise)
    }
    expect(await Promise.all([returned])).toEqual([await (interaction.respond as unknown as { mock: { results: { value: unknown }[] } }).mock.results[0].value])
    expect(vi.mocked(interaction.respond).mock.calls).toEqual([[[{ name: 'tea', value: 'tea' }]]])
    expect(vi.mocked(interaction.respond).mock.results[0].value).not.toBe(returned)
    expect(interaction.respond).toBe(vi.mocked(interaction.respond))
  })

  it('counts a respond() that gives no promise, as a stub may, as an answer', async () => {
    how = 'awaited'
    const dispatch = await startBot()
    const interaction = createMockInteraction(AutocompleteInteraction, { commandName: 'search' })
    const choices: unknown[] = []
    Object.defineProperty(interaction, 'respond', { configurable: true, writable: true, value: (given: unknown) => void choices.push(given) })

    await dispatch(interaction)

    expect(choices).toEqual([[{ name: 'tea', value: 'tea' }]])
    expect(warned.filter(text => text.startsWith('Search.suggest'))).toEqual([])
  })

  it('neither closes the menu nor warns when the handler put its own respond in place and answered through it', async () => {
    how = 'replaced'
    elsewhere = []
    const dispatch = await startBot()
    const { interaction, sent } = typed()
    const own = interaction.respond

    await dispatch(interaction)

    expect(elsewhere).toEqual([[{ name: 'tea', value: 'tea' }]])
    expect(sent).toEqual([])
    expect(interaction.respond).not.toBe(own)
    expect(warned.filter(text => text.startsWith('Search.suggest'))).toEqual([])
  })

  it('logs an unawaited answer that failed otherwise, without closing the menu', async () => {
    how = 'unawaited'
    const dispatch = await startBot()
    const { interaction, sent } = typed(new Error('socket hang up'))

    await dispatch(interaction)
    await settledRejections()

    expect(sent).toHaveLength(1)
    expect(errors).toEqual(["Could not send Search.suggest's choices:"])
    expect(warned).toEqual([])
    expect(unhandled).toEqual([])
  })

  it('logs a second unawaited answer Discord refused, after a first that went through', async () => {
    how = 'twice'
    const dispatch = await startBot()
    const { interaction, sent } = typed()

    await dispatch(interaction)
    await settledRejections()

    expect(sent).toHaveLength(2)
    expect(errors).toEqual(["Could not send Search.suggest's choices:"])
    expect(unhandled).toEqual([])
  })

  it('logs each of two unawaited answers that failed, once', async () => {
    how = 'twice'
    const dispatch = await startBot()
    const { interaction, sent } = typed(new Error('socket hang up'))

    await dispatch(interaction)
    await settledRejections()

    expect(sent).toHaveLength(2)
    expect(errors).toEqual(["Could not send Search.suggest's choices:", "Could not send Search.suggest's choices:"])
    expect(unhandled).toEqual([])
  })

  it.each(['thenable read', 'thenable unread'] as const)(
    'leaves no unhandled rejection behind a respond() that gives a thenable which fails, %s',
    async read => {
      how = read
      const dispatch = await startBot()
      const interaction = createMockInteraction(AutocompleteInteraction, { commandName: 'search' })
      // A thenable rather than a promise, as a stub may give, failing while the handler is still at work
      const thenable = { then: (_resolve: unknown, reject: (error: unknown) => void) => void setTimeout(() => reject(new Error('thenable failed')), ANSWER_MS) }
      Object.defineProperty(interaction, 'respond', { configurable: true, writable: true, value: () => thenable })

      await dispatch(interaction)
      await settledRejections()

      expect(unhandled).toEqual([])
      expect(errors).toEqual([])
    },
  )

  it('logs an unawaited answer that failed, once, when the handler then throws', async () => {
    how = 'throws'
    const dispatch = await startBot()
    const { interaction } = typed(new Error('socket hang up'))

    await dispatch(interaction)
    await settledRejections()

    expect(errors.filter(text => text === "Could not send Search.suggest's choices:")).toHaveLength(1)
    expect(unhandled).toEqual([])
  })
})
