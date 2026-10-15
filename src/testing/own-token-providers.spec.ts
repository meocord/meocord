import 'reflect-metadata'
import { ChatInputCommandInteraction, Client } from 'discord.js'
import { vi } from 'vitest'
import { Logger } from '@src/common/logger.js'
import { forgetDeprecationWarnings } from '@src/common/deprecation.js'
import { CooldownStore, MemoryCooldownStore } from '@src/common/cooldown-store.js'
import { ExecutionContext } from '@src/common/execution-context.js'
import { createTranslator, Translator } from '@src/common/translator.js'
import { HandlerRegistry } from '@src/core/handler-registry.js'
import { ShardContext } from '@src/core/shard-context.js'
import { ThemeCache } from '@src/core/theme-resolvers.js'
import { Command, Controller, MeoCord } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { createMockInteraction, MeoCordTestingModule } from './index.js'
import { forgetStrictMocks, useStrictMocks } from './strict-mocks.js'

let warned: string[]
beforeEach(() => {
  forgetStrictMocks()
  forgetDeprecationWarnings()
  warned = []
  vi.spyOn(Logger.prototype, 'warn').mockImplementation((text: unknown) => void warned.push(String(text)))
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
})
afterEach(() => vi.restoreAllMocks())
afterAll(() => forgetStrictMocks())

const MODES = [
  ['in default mode', () => undefined],
  ['under useStrictMocks()', () => useStrictMocks()],
] as const
const i18n = createTranslator({ default: 'en-US', locales: { 'en-US': {} } })
const refusal = (name: string) => `App: @MeoCord({ providers }) cannot provide ${name}, which MeoCord binds itself.`

@Controller()
class Status {
  constructor(
    readonly registry: HandlerRegistry,
    readonly shards: ShardContext,
  ) {}

  @Command('status', CommandType.SLASH)
  status() {}
}

const appProviding = (token: unknown) => {
  @MeoCord({ controllers: [Status], providers: [{ provide: token as never, useValue: {} }], i18n, clientOptions: { intents: [] } })
  class App {}
  return App
}

describe("a testing module's override of a token it binds itself", () => {
  it.each(MODES)('stands in for HandlerRegistry and ShardContext, which a controller then injects, %s', async (_, mode) => {
    mode()
    // Empty doubles, told apart by identity
    const registry = {}
    const shards = {}
    const module = MeoCordTestingModule.create({ controllers: [Status] })
      .overrideProvider(HandlerRegistry)
      .useValue(registry)
      .overrideProvider(ShardContext)
      .useValue(shards)
      .compile()

    const { ran, error } = await module.invoke(Status, 'status', createMockInteraction(ChatInputCommandInteraction, { commandName: 'status' }))
    const status = module.get(Status)

    expect([ran, error]).toEqual([true, undefined])
    expect([status.registry, status.shards]).toEqual([registry, shards])
    expect(module.get(HandlerRegistry)).toBe(registry)
  })
})

describe("an app's own provider of a token MeoCord binds itself", () => {
  it.each(
    MODES.flatMap(([mode, set]) => [
      ['HandlerRegistry', mode, HandlerRegistry, set],
      ['ShardContext', mode, ShardContext, set],
    ] as const),
  )("is refused with the bot's words for %s, which the module binds too, %s", (name, _, token, mode) => {
    mode()

    expect(() => MeoCordTestingModule.fromApp(appProviding(token)).compile()).toThrow(refusal(name))
  })

  it.each([
    ['Client', Client],
    ['CooldownStore', CooldownStore],
    ['Translator', Translator],
  ] as const)('is refused for %s under useStrictMocks(), as the bot refuses it', (name, token) => {
    useStrictMocks()

    expect(() => MeoCordTestingModule.fromApp(appProviding(token)).compile()).toThrow(refusal(name))
  })

  it.each([
    ['Client', Client],
    ['CooldownStore', CooldownStore],
    ['Translator', Translator],
  ] as const)('compiles for %s in default mode, as before, with a warning', (name, token) => {
    MeoCordTestingModule.fromApp(appProviding(token)).compile()

    expect(warned).toEqual([`${refusal(name)} The testing module runs it; under useStrictMocks() compile() refuses it, as the bot does.`])
  })

  it.each(
    MODES.flatMap(([mode, set]) => [
      ['ThemeCache', mode, ThemeCache, set],
      ['ExecutionContext', mode, ExecutionContext, set],
    ] as const),
  )('warns for %s, as the bot does, %s', (name, _, token, mode) => {
    mode()
    MeoCordTestingModule.fromApp(appProviding(token)).compile()

    expect(warned).toEqual([`App: @MeoCord({ providers }) provides ${name}, which MeoCord binds itself; the next major version (5.0) refuses it. Remove the provider.`])
  })
})

describe("a test's own provider of Client or CooldownStore", () => {
  it('is allowed under useStrictMocks(), as documented', () => {
    useStrictMocks()
    const store = new MemoryCooldownStore()
    const module = MeoCordTestingModule.create({
      controllers: [Status],
      providers: [
        { provide: Client, useValue: {} },
        { provide: CooldownStore, useValue: store },
      ],
    }).compile()

    expect(module.get(CooldownStore)).toBe(store)
    expect(warned).toEqual([])
  })
})
