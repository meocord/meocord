import 'reflect-metadata'
import { vi } from 'vitest'
import { type Message } from 'discord.js'
import { Logger } from '@src/common/logger.js'
import { Controller, MeoCord, MessageHandler } from '@src/decorator/index.js'
import { type MessageCommandOptions, type MessageHandlerOptions } from '@src/interface/index.js'
import { createMockGuild, createMockMessage, MeoCordTestingModule } from '@src/testing/index.js'

let warned: string[]
beforeEach(() => {
  warned = []
  vi.spyOn(Logger.prototype, 'warn').mockImplementation((text: unknown) => void warned.push(String(text)))
})
afterEach(() => vi.restoreAllMocks())

/**
 * An app of one handler with the given pattern and options, sent one message, with what ran and what was warned: the
 * testing module builds its dispatcher, which warns, as the first message is dispatched, as the bot does as it starts.
 */
async function appOf(pattern: string, own: MessageHandlerOptions = {}, messages: MessageCommandOptions = { prefix: '!' }, content = 'x') {
  const ran: string[] = []
  @Controller()
  class Mod {
    @MessageHandler(pattern, own)
    run(_message: Message, params: Record<string, unknown>) {
      ran.push(JSON.stringify(params))
    }
  }
  @MeoCord({ controllers: [Mod], clientOptions: { intents: [] }, messages })
  class App {}
  await MeoCordTestingModule.fromApp(App).compile().dispatch(createMockMessage({ content, guild: createMockGuild() }))
  return { ran, warned: [...warned] }
}

const EMPTY_APP =
  "@MeoCord({ messages: { prefix: [] } }): `[]` takes messages as they are, with no prefix; write `''` for that. In the next " +
  "major version (5.0), `[]` starts no command, as a prefix function's `[]` does."
const EMPTY_HANDLER =
  "Mod.run: @MessageHandler('ban {who}', { prefix: [] }): `[]` takes messages as they are, with no prefix; write `''` for " +
  'that, or `false` for no prefix and no mention. In the next major version (5.0), `[]` starts no command.'

// A static `[]` takes messages as they are, where a prefix function's `[]` starts none: 4.2 warns, and 5.0 changes it
describe('a static empty prefix list', () => {
  it("warns once for the app's, naming the option, and still takes a message with no prefix", async () => {
    const app = await appOf('ban {who}', {}, { prefix: [] }, 'ban bob')

    expect(app.warned).toEqual([EMPTY_APP])
    expect(app.ran).toEqual(['{"who":"bob"}'])
  })

  it("warns once for a handler's, naming it, and still takes a message with no prefix", async () => {
    const app = await appOf('ban {who}', { prefix: [] }, { prefix: '!' }, 'ban bob')

    expect(app.warned).toEqual([EMPTY_HANDLER])
    expect(app.ran).toEqual(['{"who":"bob"}'])
  })

  it.each([
    ['an empty string', { prefix: '' }, {}],
    ['a list of an empty string', { prefix: [''] }, {}],
    ['no prefix', {}, { prefix: false }],
    ['a prefix function', {}, { prefix: () => [] }],
    ['a list of prefixes', { prefix: ['?'] }, { prefix: ['!'] }],
  ] as [string, MessageCommandOptions, MessageHandlerOptions][])("doesn't warn for %s", async (_, messages, own) => {
    expect((await appOf('ban {who}', own, messages)).warned).toEqual([])
  })
})

// A command that reads flags in any case can only set the first of two flags that differ only in case
describe('two flags that differ only in case', () => {
  it('warn once, naming both, on a command that reads flags in any case, with its aliases too', async () => {
    expect((await appOf('opt {a} {--v} {--V}', { aliases: ['o'] })).warned).toEqual([
      "Mod.run: @MessageHandler('opt {a} {--v} {--V}'): {--v} and {--V} differ only in case, and this command reads flags in " +
        'any case, so --V always sets {--v} and {--V} is never set. Rename one, or set caseSensitive: true. The next major ' +
        'version (5.0) refuses this.',
    ])
  })

  it('warn for typed flags, quoted as written', async () => {
    expect((await appOf('typed {a} {--to:int?} {--To:int?}')).warned).toEqual([
      "Mod.run: @MessageHandler('typed {a} {--to:int?} {--To:int?}'): {--to:int?} and {--To:int?} differ only in case, and " +
        'this command reads flags in any case, so --To always sets {--to:int?} and {--To:int?} is never set. Rename one, or ' +
        'set caseSensitive: true. The next major version (5.0) refuses this.',
    ])
  })

  it("don't warn on a case-sensitive command, by the handler or the app, or for a param and a flag", async () => {
    expect((await appOf('opt {a} {--v} {--V}', { caseSensitive: true })).warned).toEqual([])
    expect((await appOf('opt {a} {--v} {--V}', {}, { prefix: '!', caseSensitive: true })).warned).toEqual([])
    expect((await appOf('opt {v} {--V}')).warned).toEqual([])
  })
})

// One method can carry several handlers, each with its own pattern and options
describe('handlers stacked on one method', () => {
  it('each warn for their own prefix and flags', async () => {
    @Controller()
    class Mod {
      @MessageHandler('four {a}', { prefix: [] })
      @MessageHandler('five {a} {--k} {--K}')
      run() {}
    }
    @MeoCord({ controllers: [Mod], clientOptions: { intents: [] }, messages: { prefix: '!' } })
    class App {}
    await MeoCordTestingModule.fromApp(App).compile().dispatch(createMockMessage({ content: 'x', guild: createMockGuild() }))

    expect([...warned].sort()).toEqual(
      [
        "Mod.run: @MessageHandler('four {a}', { prefix: [] }): `[]` takes messages as they are, with no prefix; write `''` for " +
          'that, or `false` for no prefix and no mention. In the next major version (5.0), `[]` starts no command.',
        "Mod.run: @MessageHandler('five {a} {--k} {--K}'): {--k} and {--K} differ only in case, and this command reads flags in " +
          'any case, so --K always sets {--k} and {--K} is never set. Rename one, or set caseSensitive: true. The next major ' +
          'version (5.0) refuses this.',
      ].sort(),
    )
  })
})
