import 'reflect-metadata'
import { vi } from 'vitest'
import { AutocompleteInteraction, type Message, type MessageReaction } from 'discord.js'
import { Autocomplete, Controller, Guard, MeoCord, MessageHandler, ReactionHandler, UseGuard } from '@src/decorator/index.js'
import { GuardDeniedError, MessageUsageError, UserError, ValidationError } from '@src/common/errors.js'
import { usageIssue } from '@src/common/meocord-text.js'
import { UnroutedExecutionContext } from '@src/common/execution-context.js'
import { type Logger } from '@src/common/logger.js'
import { createFallback } from '@src/core/fallback.js'
import { type GuardInterface } from '@src/interface/index.js'
import { MeoCordTestingModule } from '@src/testing/meocord-testing-module.js'
import { createChatInputOptions, createMock, createMockInteraction, createMockMessage, createMockUser } from '@src/testing/mock-interaction.js'

@Guard()
class Banned implements GuardInterface {
  canActivate(): boolean {
    throw new GuardDeniedError('You are banned from this bot.')
  }
}

@UseGuard(Banned)
@Controller()
class ShopController {
  @Autocomplete('shop', 'item')
  suggest(_interaction: AutocompleteInteraction) {
    return undefined
  }

  @ReactionHandler('⭐')
  star(_reaction: MessageReaction) {
    return undefined
  }
}

@Controller()
class SearchController {
  @Autocomplete('search', 'query')
  query(interaction: AutocompleteInteraction) {
    if (interaction.options.getFocused().length < 3) throw new UserError('Type at least three letters.')
  }

  @Autocomplete('search', 'page')
  page() {
    throw new ValidationError([{ message: 'Expected a number', path: ['page'] }])
  }
}

@Controller()
class DiceController {
  @MessageHandler('roll {sides:int}')
  roll(_message: Message, _params: { sides: number }) {
    return undefined
  }

  @MessageHandler('sort {order:asc|desc}')
  sort(_message: Message, _params: { order: 'asc' | 'desc' }) {
    return undefined
  }

  @MessageHandler('list {--bots}')
  list(_message: Message) {
    return undefined
  }
}

@MeoCord({ controllers: [DiceController], messages: { prefix: '!', help: true }, clientOptions: { intents: [] } })
class DiceApp {}

const LINK = '[Free Nitro](https://example.com/login)'

/** Everything a test wrote through console.error, as text. */
function captureErrors(): unknown[][] {
  const lines: unknown[][] = []
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void lines.push(args))
  return lines
}

afterEach(() => vi.restoreAllMocks())

describe('an expected refusal on autocomplete or a reaction', () => {
  const module = MeoCordTestingModule.create({ controllers: [ShopController, SearchController] }).compile()

  it.each([
    ['a guard denies it', 'shop', { focused: 'item', item: 'sw' }],
    ['the handler throws a UserError', 'search', { focused: 'query', query: 'sw' }],
    ['the handler throws a ValidationError', 'search', { focused: 'page', page: '' }],
  ])('closes the menu without logging an error when %s', async (_case, commandName, options) => {
    const errors = captureErrors()
    const interaction = createMockInteraction(AutocompleteInteraction, { commandName, options: createChatInputOptions(options) })

    await module.dispatch(interaction)

    expect(interaction.respond).toHaveBeenCalledWith([])
    expect(errors).toEqual([])
  })

  it('logs no error when a guard denies a reaction', async () => {
    const errors = captureErrors()
    const reaction = createMock<MessageReaction>({ emoji: { name: '⭐', id: null } as never, message: createMockMessage() as never })

    await module.dispatch(reaction, { user: createMockUser() })

    expect(errors).toEqual([])
  })
})

describe('message content in a log line', () => {
  const logger = () => ({ error: vi.fn(), warn: vi.fn(), debug: vi.fn(), log: vi.fn() }) as unknown as Logger & Record<'error' | 'debug', ReturnType<typeof vi.fn>>

  it('is quoted with its line breaks and control characters escaped', async () => {
    const log = logger()
    const message = createMockMessage({ content: 'hi\n[ERROR] [MeoCordApp] Fake line\r\u001b[31mred ' })

    await createFallback(log)(new Error('boom'), new UnroutedExecutionContext([message]))

    const [line] = log.error.mock.calls[0] as [string]
    expect(line).toBe('Error handling message "hi\\n[ERROR] [MeoCordApp] Fake line\\r\\u001b[31mred\\u2028":')
  })

  it('is cut short when it is long', async () => {
    const log = logger()
    const message = createMockMessage({ content: 'a'.repeat(4000) })

    await createFallback(log)(new Error('boom'), new UnroutedExecutionContext([message]))

    const [line] = log.error.mock.calls[0] as [string]
    expect(line).toBe(`Error handling message "${'a'.repeat(200)}…" (4000 characters):`)
  })

  it('escapes the words a usage error quotes, in its debug line', async () => {
    const log = logger()
    const issue = usageIssue({ key: 'meocord.usage.notValid', params: { label: 'sides', word: '6\u001b[2J', type: 'whole number' } })

    await createFallback(log)(new MessageUsageError('roll <sides>', [issue], { quiet: true }), new UnroutedExecutionContext([createMockMessage()]))

    const [line] = log.debug.mock.calls[0] as [string]
    // Escaped once: the issue's quotes and any backslash it holds stay as the reply shows them
    expect(line).toContain('sides: "6\\u001b[2J" is not a valid whole number')
    expect(line).not.toMatch(/[\u0000-\u001f]/)
  })
})

describe("a reply that quotes the user's words", () => {
  const module = MeoCordTestingModule.create({ app: DiceApp, controllers: [DiceController] }).compile()

  /** What the bot replied to `content`. */
  async function replyTo(content: string): Promise<string> {
    const message = createMockMessage({ content })
    await module.dispatch(message)
    return (message.reply.mock.calls[0]?.[0] as { content: string }).content
  }

  it("shows a param's markdown as written", async () => {
    expect(await replyTo(`!roll "${LINK}"`)).toContain('sides: "\\[Free Nitro](https://example.com/login)" is not a valid whole number')
  })

  it("shows a param's markdown as written on one line, though it was quoted across lines", async () => {
    expect(await replyTo('!roll "6\n# big"')).toContain('sides: "6 # big" is not a valid whole number')
  })

  it("shows a choice's markdown as written", async () => {
    expect(await replyTo('!sort **up**')).toContain('order: "\\*\\*up\\*\\*" is not one of asc, desc')
  })

  it("shows a flag's value's markdown as written", async () => {
    expect(await replyTo('!list --bots=**yes**')).toContain('\\*\\*yes\\*\\*')
  })

  it("shows the help query's markdown as written, on one line", async () => {
    expect(await replyTo(`!help ${LINK}\n# **now**`)).toBe(
      'No command is called "\\[Free Nitro](https://example.com/login) # \\*\\*now\\*\\*". Type !help to list them.',
    )
  })
})
