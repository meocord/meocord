import { ChatInputCommandInteraction } from 'discord.js'
import { vi } from 'vitest'
import { Logger, respond } from '@src/common/index.js'
import { Command, Controller, Defer, MeoCord } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { createMockInteraction, getResponse, MeoCordTestingModule } from '@src/testing/index.js'

const RAW_WARNING = 'An interaction under @Defer was answered with a raw discord.js call; answer through respond(interaction) so its state stays in step.'
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

@Controller()
class Notes {
  @Defer({ mode: 'auto' })
  @Command('slow', CommandType.SLASH)
  async slow() {
    await sleep(2000)
  }

  @Defer({ mode: 'auto' })
  @Command('themed', CommandType.SLASH)
  async themed(interaction: ChatInputCommandInteraction) {
    await respond(interaction).send({ content: 'through respond' })
  }

  @Defer({ mode: 'auto' })
  @Command('through', CommandType.SLASH)
  async through(interaction: ChatInputCommandInteraction) {
    await respond(interaction).send({ content: 'through respond' })
  }

  @Defer({ mode: 'auto' })
  @Command('none', CommandType.SLASH)
  none() {}

  @Defer({ mode: 'auto' })
  @Command('raw', CommandType.SLASH)
  async raw(interaction: ChatInputCommandInteraction) {
    await interaction.reply('raw')
  }
}

/** A user resolver slower than `@Defer`'s timer, so an answer through respond() waits for its theme past it. */
class SlowThemes {
  async user() {
    await sleep(2000)
    return { colors: { primary: '#0000D1' as const } }
  }
}

@MeoCord({ controllers: [Notes], clientOptions: { intents: [] }, themeFor: SlowThemes, themeForTimeoutMs: 3000 })
class App {}

describe("the raw-answer warning under @Defer({ mode: 'auto' })", () => {
  let warned: string[]
  beforeEach(() => {
    vi.useFakeTimers()
    warned = []
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(text => void warned.push(String(text)))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })
  const rawWarnings = () => warned.filter(text => text === RAW_WARNING)

  it('warns once for a raw reply at 500 ms in a handler that takes 2 s', async () => {
    const module = MeoCordTestingModule.create({ controllers: [Notes] }).compile()
    const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName: 'slow' })
    setTimeout(() => void interaction.reply('raw'), 500)

    const handled = module.dispatch(interaction)
    await vi.advanceTimersByTimeAsync(2000)
    await handled

    expect(rawWarnings()).toHaveLength(1)
  })

  it('warns once for a raw reply made while an answer through respond() waits for its theme past the timer', async () => {
    const module = MeoCordTestingModule.fromApp(App).compile()
    const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName: 'themed', user: { id: '200000000000000001' } } as never)
    setTimeout(() => void interaction.reply('raw'), 500)

    const handled = module.dispatch(interaction)
    await vi.advanceTimersByTimeAsync(3000)
    await handled

    expect(rawWarnings()).toHaveLength(1)
  })

  // What reads the answer's state after release() reads it as before: through `state`, which learns of a raw answer
  it.each([
    ['through', 'replied'],
    ['none', 'unanswered'],
    ['raw', 'replied'],
  ] as const)('leaves /%s, its handler done before the timer, %s', async (commandName, state) => {
    const module = MeoCordTestingModule.create({ controllers: [Notes] }).compile()
    const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName })

    await module.dispatch(interaction)
    await vi.advanceTimersByTimeAsync(2000)

    expect(getResponse(interaction).state).toBe(state)
    expect(rawWarnings()).toHaveLength(commandName === 'raw' ? 1 : 0)
  })
})
