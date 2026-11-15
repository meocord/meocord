import {
  AutocompleteInteraction,
  ButtonInteraction,
  ChatInputCommandInteraction,
  type Message,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from 'discord.js'
import { vi } from 'vitest'
import { createTranslator, defineCatalog, type ExecutionContext, GuardDeniedError, Logger } from '@src/common/index.js'
import { Autocomplete, Catch, Command, Controller, Defer, Guard, MeoCord, MessageHandler, Observer, On, UseFilter, UseGuard } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { type DispatchObserver, type DispatchResult, type ExceptionFilter, type GuardInterface } from '@src/interface/index.js'
import {
  createChatInputOptions,
  createMockInteraction,
  createMockMessage,
  getResponse,
  MeoCordTestingModule,
} from '@src/testing/index.js'

// With answerDenied, a guard's false on an interaction is answered as a thrown GuardDeniedError is.

const calls = (interaction: object) => getResponse(interaction as never).calls.map(call => call.method)
const said = (interaction: object) => JSON.stringify(getResponse(interaction as never).calls.at(-1)?.payload)

@Guard()
class Deny implements GuardInterface {
  canActivate() {
    return false
  }
}

@Guard()
class Explain implements GuardInterface {
  canActivate(): boolean {
    throw new GuardDeniedError('Members only.')
  }
}

const settled: DispatchResult[] = []

@Observer()
class Outcomes implements DispatchObserver {
  onSettled(_context: unknown, result: DispatchResult) {
    settled.push(result)
  }
}

const ran: string[] = []

@Controller()
class Cards {
  @Command('card/{id}', CommandType.BUTTON)
  @UseGuard(Deny)
  card() {
    ran.push('card')
  }

  @Command('slow/{id}', CommandType.BUTTON)
  @UseGuard(Deny)
  @Defer()
  slow() {
    ran.push('slow')
  }

  @Command('pick', CommandType.SELECT_MENU)
  @UseGuard(Deny)
  pick() {}

  @Command('note', CommandType.MODAL_SUBMIT)
  @UseGuard(Deny)
  note() {}

  @Command('ping', CommandType.SLASH)
  @UseGuard(Deny)
  ping() {}

  @Command('members', CommandType.SLASH)
  @UseGuard(Explain)
  members() {}

  @Autocomplete('ping')
  @UseGuard(Deny)
  suggest() {}

  @MessageHandler('hello', { prefix: false })
  @UseGuard(Deny)
  hello(_message: Message) {
    ran.push('hello')
  }

  @On('guildCreate')
  @UseGuard(Deny)
  joined() {
    ran.push('joined')
  }
}

const app = (answerDenied: boolean | undefined, i18n?: ReturnType<typeof createTranslator>) => {
  @MeoCord({ controllers: [Cards], clientOptions: { intents: [] }, ...(answerDenied !== undefined && { answerDenied }), ...(i18n && { i18n }) })
  class App {}
  return MeoCordTestingModule.create({ app: App, controllers: [Cards], observers: [Outcomes] }).compile()
}

const slash = (commandName: string, locale = 'en-US') =>
  Object.assign(createMockInteraction(ChatInputCommandInteraction, { commandName, locale: locale as never }), { options: createChatInputOptions({}) })

beforeEach(() => {
  settled.length = 0
  ran.length = 0
})

describe('@MeoCord({ answerDenied: true })', () => {
  it.each([
    ['a command', () => slash('ping')],
    ['a button', () => createMockInteraction(ButtonInteraction, { customId: 'card/1' })],
    ['a select menu', () => createMockInteraction(StringSelectMenuInteraction, { customId: 'pick' })],
    ['a modal', () => createMockInteraction(ModalSubmitInteraction, { customId: 'note' })],
  ])("answers a guard's false on %s privately, as a thrown GuardDeniedError", async (_label, make) => {
    const interaction = make()

    await app(true).dispatch(interaction)

    expect(calls(interaction)).toEqual(['reply'])
    expect(getResponse(interaction).calls[0].payload).toMatchObject({ flags: expect.anything() })
    expect(said(interaction)).toContain("You can't use this.")
    expect(settled).toEqual([expect.objectContaining({ outcome: 'denied', deniedBy: Deny, handled: true, error: expect.any(GuardDeniedError) })])
  })

  it('answers into the deferral of a call with @Defer, and runs nothing', async () => {
    const interaction = createMockInteraction(ButtonInteraction, { customId: 'slow/1', message: createMockMessage() })

    await app(true).dispatch(interaction)

    expect(calls(interaction)[0]).toBe('deferUpdate')
    expect(calls(interaction)).not.toContain('reply')
    expect(said(interaction)).toContain("You can't use this.")
    expect(ran).toEqual([])
  })

  it("answers in the user's language, from the app's catalog", async () => {
    const id = { meocord: { guard: { denied: 'Kamu tidak bisa memakai ini.' } } }
    const interaction = slash('ping', 'id')

    await app(true, createTranslator({ default: 'en-US', locales: { 'en-US': defineCatalog({}), id } })).dispatch(interaction)

    expect(said(interaction)).toContain('Kamu tidak bisa memakai ini.')
  })

  it('reaches a filter that catches GuardDeniedError', async () => {
    const caught: string[] = []
    @Catch(GuardDeniedError)
    class Denials implements ExceptionFilter<GuardDeniedError> {
      catch(error: GuardDeniedError, _context: ExecutionContext) {
        caught.push(error.message)
      }
    }
    @Controller()
    @UseFilter(Denials)
    class Filtered {
      @Command('ping', CommandType.SLASH)
      @UseGuard(Deny)
      ping() {}
    }
    @MeoCord({ controllers: [Filtered], clientOptions: { intents: [] }, answerDenied: true })
    class App {}
    const interaction = slash('ping')

    await MeoCordTestingModule.create({ app: App, controllers: [Filtered] }).compile().dispatch(interaction)

    expect(caught).toEqual(["You can't use this."])
    expect(calls(interaction)).toEqual([])
  })

  it("keeps a guard's own GuardDeniedError in its own words", async () => {
    const interaction = slash('members')

    await app(true).dispatch(interaction)

    expect(said(interaction)).toContain('Members only.')
    expect(said(interaction)).not.toContain("You can't use this.")
  })

  it('still closes an autocomplete with no choices', async () => {
    const interaction = createMockInteraction(AutocompleteInteraction, { commandName: 'ping' })

    await app(true).dispatch(interaction)

    expect(interaction.respond).toHaveBeenCalledWith([])
    expect(interaction.respond).toHaveBeenCalledTimes(1)
    expect(settled.map(({ outcome }) => outcome)).toEqual(['denied'])
  })

  it('leaves a message command silent', async () => {
    const message = createMockMessage({ content: 'hello' })

    await app(true).dispatch(message)

    expect(vi.mocked(message.reply)).not.toHaveBeenCalled()
    expect(vi.mocked(message.channel.send as (...args: unknown[]) => unknown)).not.toHaveBeenCalled()
    expect(settled.map(({ outcome, error }) => [outcome, error])).toEqual([['denied', undefined]])
  })

  it('treats a denied event as filtered, quietly', async () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    try {
      await app(true).emit('guildCreate', {} as never)

      expect(ran).toEqual([])
      expect(error).not.toHaveBeenCalled()
      expect(settled.map(({ outcome, error }) => [outcome, error])).toEqual([['denied', undefined]])
    } finally {
      error.mockRestore()
    }
  })

  it('has invoke reject with the denial and send nothing, as for a thrown GuardDeniedError', async () => {
    const interaction = slash('ping')

    const rejected: unknown = await app(true)
      .invoke(Cards, 'ping', interaction)
      .catch((error: unknown) => error)

    expect(rejected).toBeInstanceOf(GuardDeniedError)
    expect((rejected as GuardDeniedError).message).toBe("You can't use this.")
    expect(calls(interaction)).toEqual([])
  })
})

describe('@MeoCord({ answerDenied })', () => {
  it('takes only true or false', () => {
    expect(() => {
      @MeoCord({ controllers: [], clientOptions: { intents: [] }, answerDenied: 'yes' as never })
      class App {}
      return App
    }).toThrow('App: @MeoCord({ answerDenied }) takes true or false.')
  })
})

describe('without answerDenied', () => {
  it.each([undefined, false])("leaves a guard's false silent with answerDenied %s", async answerDenied => {
    const command = slash('ping')
    const button = createMockInteraction(ButtonInteraction, { customId: 'card/1' })

    await app(answerDenied).dispatch(command)
    await app(answerDenied).dispatch(button)

    expect(calls(command)).toEqual([])
    expect(calls(button)).toEqual(['deferUpdate'])
    expect(settled.map(({ outcome, error }) => [outcome, error])).toEqual([
      ['denied', undefined],
      ['denied', undefined],
    ])
  })

  it.each([undefined, false])("has invoke resolve a guard's false as not run with answerDenied %s", async answerDenied => {
    const interaction = slash('ping')

    await expect(app(answerDenied).invoke(Cards, 'ping', interaction)).resolves.toEqual({ ran: false })
    expect(calls(interaction)).toEqual([])
  })
})
