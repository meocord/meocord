import { inspect, stripVTControlCharacters } from 'node:util'
import { ButtonInteraction, ChatInputCommandInteraction, Collection, MessageFlagsBitField } from 'discord.js'
import { vi } from 'vitest'
import {
  type CooldownBatchVerdict,
  type CooldownEntry,
  type CooldownLimit,
  CooldownStore,
  CooldownStoreError,
  type CooldownVerdict,
} from '@src/common/index.js'
import { respond } from '@src/common/response/response-state.js'
import { setPresenter } from '@src/common/response/presenter.js'
import { resetLogLevel } from '@src/common/log-level.js'
import { Command, Controller, Cooldown, MeoCord } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { type ResponsePresenter } from '@src/interface/index.js'
import { createMockInteraction, createMockMessage, MeoCordTestingModule } from '@src/testing/index.js'

/** A value whose inspection throws, as an application's code may throw it. */
const uninspectable = () => ({
  [inspect.custom]: () => {
    throw new Error('inspect.custom')
  },
})
const PLACEHOLDER = '[value could not be inspected: inspect.custom]'

/** An error whose message getter throws, so reading it as text throws too. */
const unreadableError = () =>
  Object.defineProperty(new Error(), 'message', {
    get() {
      throw new Error('message')
    },
  })

/** Each line printed, without colour and timestamp, prefixed with the console method that printed it. */
let printed: string[]

beforeEach(() => {
  vi.stubEnv('MEOCORD_LOG_LEVEL', 'debug')
  resetLogLevel()
  printed = []
  for (const method of ['log', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      const line = stripVTControlCharacters(args.map(String).join(' ')).replace(/^.*?UTC[+-]\d\d:\d\d /, '')
      printed.push(`${method} ${line}`)
    })
  }
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  resetLogLevel()
})

describe('a cooldown store that fails with a value MeoCord cannot read', () => {
  @Controller()
  class Daily {
    @Command('daily', CommandType.SLASH)
    @Cooldown({ seconds: 3 })
    daily() {}
  }

  /** A store whose every call rejects with what `fail` makes. */
  class FailingStore extends CooldownStore {
    constructor(private readonly fail: () => unknown) {
      super()
    }
    consume(key: string, limit: CooldownLimit): Promise<CooldownVerdict> {
      return this.consumeMany([{ key, limit }]) as never
    }
    consumeMany(_entries: readonly CooldownEntry[]): Promise<CooldownBatchVerdict> {
      return Promise.reject(this.fail())
    }
  }

  function moduleWith(store: CooldownStore, cooldownStoreFailure: 'deny' | 'allow') {
    @MeoCord({ controllers: [Daily], clientOptions: { intents: [] }, cooldownStoreFailure })
    class App {}
    return MeoCordTestingModule.create({ app: App, controllers: [Daily], providers: [{ provide: CooldownStore, useValue: store }] }).compile()
  }

  const call = () => createMockInteraction(ChatInputCommandInteraction, { commandName: 'daily' })

  it('refuses the call and logs the failure with a placeholder for a value whose inspection throws', async () => {
    const module = moduleWith(new FailingStore(uninspectable), 'deny')

    await expect(module.invoke(Daily, 'daily', call())).rejects.toBeInstanceOf(CooldownStoreError)

    expect(printed).toEqual([
      `error [ERROR] [Cooldown] The cooldown store FailingStore failed: [object Object]. Calls with a cooldown are refused until it answers again. ${PLACEHOLDER}`,
    ])
  })

  it.each([
    ['deny', 'error [ERROR] [Cooldown] The cooldown store FailingStore failed. Calls with a cooldown are refused until it answers again.'],
    ['allow', 'warn [WARN] [Cooldown] The cooldown store FailingStore failed. Calls run uncounted until it answers again.'],
  ] as const)("logs that it failed, without what, for an error whose message can't be read, with %s", async (policy, line) => {
    const module = moduleWith(new FailingStore(unreadableError), policy)

    const invoked = module.invoke(Daily, 'daily', call())
    if (policy === 'deny') await expect(invoked).rejects.toBeInstanceOf(CooldownStoreError)
    else await invoked

    expect(printed).toHaveLength(1)
    expect(printed[0].startsWith(line)).toBe(true)
  })
})

describe('a presenter that throws a value whose inspection throws', () => {
  const throwing = { loading: () => { throw uninspectable() }, error: () => { throw uninspectable() } } as unknown as ResponsePresenter

  it("answers an error with MeoCord's own view and logs the fault", async () => {
    const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName: 'broken' })
    setPresenter(interaction.client, throwing)

    await expect(respond(interaction).error(new Error('x'), { message: 'Broken.' })).resolves.toBeUndefined()

    expect(interaction.reply).toHaveBeenCalledOnce()
    expect(printed).toEqual([`error [ERROR] [Response] Could not write the error answer for command "broken": ${PLACEHOLDER}`])
  })

  it("locks with MeoCord's own loading view and warns of the fault", async () => {
    const message = Object.assign(createMockMessage(), {
      flags: new MessageFlagsBitField(0),
      embeds: [],
      components: [],
      attachments: new Collection(),
    })
    const interaction = createMockInteraction(ButtonInteraction, { customId: 'refresh', message } as never)
    setPresenter(interaction.client, throwing)

    await expect(respond(interaction).lock()).resolves.not.toThrow()

    expect(interaction.deferUpdate).toHaveBeenCalled()
    expect(printed).toEqual([`warn [WARN] [Response] The presenter's loading view could not be drawn for customId "refresh"; MeoCord's own is shown: ${PLACEHOLDER}`])
  })

  it('rejects a testing module’s dispatch with the value itself, and logs the fault', async () => {
    let thrown: unknown
    class Presenter implements ResponsePresenter {
      loading() {
        return { text: 'Working' }
      }
      error(): never {
        thrown = uninspectable()
        throw thrown
      }
    }
    @Controller()
    class Broken {
      @Command('broken', CommandType.SLASH)
      broken() {
        throw new Error('boom')
      }
    }
    @MeoCord({ controllers: [Broken], presenter: Presenter, clientOptions: { intents: [] } })
    class App {}
    const module = MeoCordTestingModule.fromApp(App).compile()

    const dispatched = module.dispatch(createMockInteraction(ChatInputCommandInteraction, { commandName: 'broken' }))

    const rejection = await dispatched.then(() => undefined, (error: unknown) => error)
    // Compared by identity: a matcher that prints the value on failure would itself throw on it
    expect(rejection === thrown).toBe(true)
    expect(printed).toContainEqual(`error [ERROR] [TestingModule] Could not write the answer for command "broken": ${PLACEHOLDER}`)
  })
})
