import {
  ApplicationCommandType,
  type AutocompleteInteraction,
  ButtonInteraction,
  ChatInputCommandInteraction,
  ContextMenuCommandBuilder,
  type Message,
  type MessageContextMenuCommandInteraction,
  ModalSubmitInteraction,
  SlashCommandBuilder,
  StringSelectMenuInteraction,
} from 'discord.js'
import {
  Autocomplete,
  Catch,
  Command,
  CommandBuilder,
  Controller,
  MeoCord,
  MessageHandler,
  Observer,
  On,
  ReactionHandler,
  Service,
  UseFilter,
  UseGuard,
} from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { createTranslator, defineCatalog, type ExecutionContext, GuardDeniedError, Logger, OwnerGuard, respond } from '@src/common/index.js'
import { type DispatchObserver, type DispatchResult, type ExceptionFilter } from '@src/interface/index.js'
import { createMockInteraction, createMockUser, getResponse, MeoCordTestingModule } from '@src/testing/index.js'
import { startupErrorsOf } from '@src/util/refusal.util.js'

// Discord user ids, as the customId and the guard compare them
const owner = '200000000000000001'
const stranger = '200000000000000002'

@Controller()
class Cards {
  @Command('card/{ownerId:snowflake}', CommandType.BUTTON)
  @UseGuard(OwnerGuard)
  async card(interaction: ButtonInteraction) {
    await respond(interaction).send('Your card.')
  }

  @Command('poll/{pollId}/{authorId:snowflake}', CommandType.BUTTON)
  @UseGuard({ provide: OwnerGuard, params: { param: 'authorId', message: 'Only the author can close this poll.' } })
  async close(interaction: ButtonInteraction) {
    await respond(interaction).send('Poll closed.')
  }

  @Command('pick/{ownerId:snowflake}', CommandType.SELECT_MENU)
  @UseGuard(OwnerGuard)
  async pick(interaction: StringSelectMenuInteraction) {
    await respond(interaction).send('Picked.')
  }

  @Command('rename/{ownerId:snowflake}', CommandType.MODAL_SUBMIT)
  @UseGuard(OwnerGuard)
  async rename(interaction: ModalSubmitInteraction) {
    await respond(interaction).send('Renamed.')
  }
}

// One of the component and modal classes, which the mock builds alike
const by = (kind: typeof ButtonInteraction | typeof StringSelectMenuInteraction | typeof ModalSubmitInteraction, userId: string, customId: string, locale = 'en-US') => {
  const user = createMockUser()
  user.id = userId
  return createMockInteraction(kind as typeof ButtonInteraction, { customId, user, locale: locale as never })
}

/** What the last answer an interaction got said, wherever the presenter put the text. */
const lastAnswer = (interaction: object) => JSON.stringify(getResponse(interaction as never).calls.at(-1)?.payload)

describe('OwnerGuard', () => {
  const module = MeoCordTestingModule.create({ controllers: [Cards] }).compile()

  it.each([
    ['a button', ButtonInteraction, 'card', `card/${owner}`],
    ['a select menu', StringSelectMenuInteraction, 'pick', `pick/${owner}`],
    ['a modal', ModalSubmitInteraction, 'rename', `rename/${owner}`],
  ] as const)('lets the owner of %s through', async (_, kind, method, customId) => {
    const { ran } = await module.invoke(Cards, method, by(kind, owner, customId) as never)

    expect(ran).toBe(true)
  })

  it.each([
    ['a button', ButtonInteraction, 'card', `card/${owner}`],
    ['a select menu', StringSelectMenuInteraction, 'pick', `pick/${owner}`],
    ['a modal', ModalSubmitInteraction, 'rename', `rename/${owner}`],
  ] as const)('denies anyone else on %s with GuardDeniedError, in MeoCord’s words', async (_, kind, method, customId) => {
    const denial = module.invoke(Cards, method, by(kind, stranger, customId) as never)

    await expect(denial).rejects.toThrow(GuardDeniedError)
    await expect(denial).rejects.toThrow('Only the user who opened this can use it.')
  })

  it('reads the param its params name, and answers in the words they give', async () => {
    await expect(module.invoke(Cards, 'close', by(ButtonInteraction, owner, `poll/42/${owner}`))).resolves.toMatchObject({ ran: true })
    await expect(module.invoke(Cards, 'close', by(ButtonInteraction, stranger, `poll/${stranger}/${owner}`))).rejects.toThrow(
      'Only the author can close this poll.',
    )
  })

  it('answers a stranger’s click privately through the fallback, and runs nothing', async () => {
    const click = by(ButtonInteraction, stranger, `card/${owner}`)

    await module.dispatch(click)

    const { calls } = getResponse(click)
    expect(calls).toHaveLength(1)
    expect(calls[0].payload).toMatchObject({ flags: expect.anything() })
    expect(lastAnswer(click)).toContain('Only the user who opened this can use it.')
    expect(lastAnswer(click)).not.toContain('Your card.')
  })

  it('tells a stranger in their own language, from the app’s catalog', async () => {
    const id = { meocord: { guard: { notOwner: 'Ini bukan milikmu.' } } }
    @MeoCord({ controllers: [Cards], i18n: createTranslator({ default: 'en-US', locales: { 'en-US': defineCatalog({}), id } }), clientOptions: { intents: [] } })
    class App {}
    const translated = MeoCordTestingModule.create({ app: App, controllers: [Cards] }).compile()

    const inIndonesian = by(ButtonInteraction, stranger, `card/${owner}`, 'id')
    const inEnglish = by(ButtonInteraction, stranger, `card/${owner}`, 'en-GB')
    await translated.dispatch(inIndonesian)
    await translated.dispatch(inEnglish)

    expect(lastAnswer(inIndonesian)).toContain('Ini bukan milikmu.')
    expect(lastAnswer(inEnglish)).toContain('Only the user who opened this can use it.')
  })

  it('reaches a filter that catches GuardDeniedError, and names itself to the observers as the guard that denied', async () => {
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
      @Command('card/{ownerId:snowflake}', CommandType.BUTTON)
      @UseGuard(OwnerGuard)
      async card(_interaction: ButtonInteraction) {}
    }
    const deniedBy: unknown[] = []
    @Observer()
    class Denied implements DispatchObserver {
      onSettled(_context: ExecutionContext, result: DispatchResult) {
        deniedBy.push(result.deniedBy)
      }
    }
    const filtered = MeoCordTestingModule.create({ controllers: [Filtered], observers: [Denied] }).compile()

    await filtered.dispatch(by(ButtonInteraction, stranger, `card/${owner}`))

    expect(caught).toEqual(['Only the user who opened this can use it.'])
    expect(deniedBy).toEqual([OwnerGuard])
  })
})

describe('OwnerGuard at startup', () => {
  const compile = (...controllers: (new (...args: any[]) => unknown)[]) => () => MeoCordTestingModule.create({ controllers }).compile()
  /** The message of every error a start collected before it stopped. */
  const refusals = (start: () => unknown): string[] => {
    try {
      start()
    } catch (error) {
      return startupErrorsOf(error as Error).map(({ message }) => message)
    }
    return []
  }

  it('refuses it on a slash command, even one with an option named like the param it reads', () => {
    @CommandBuilder(CommandType.SLASH)
    class CardBuilder {
      build(name: string) {
        return new SlashCommandBuilder()
          .setName(name)
          .setDescription('Show a card')
          .addUserOption(option => option.setName('owner').setDescription('Whose card'))
      }
    }
    @Controller()
    class Slash {
      @Command('card', CardBuilder)
      @UseGuard({ provide: OwnerGuard, params: { param: 'owner' } })
      async card(_interaction: ChatInputCommandInteraction) {}
    }

    expect(compile(Slash)).toThrow(
      "Slash.card: OwnerGuard is for component and modal handlers, whose customId carries the owner's id, and this is a slash command handler.",
    )
  })

  it('refuses it on a context menu', () => {
    @CommandBuilder(CommandType.CONTEXT_MENU)
    class ReportBuilder {
      build(name: string) {
        return new ContextMenuCommandBuilder().setName(name).setType(ApplicationCommandType.Message)
      }
    }
    @Controller()
    class Menu {
      @Command('Report', ReportBuilder)
      @UseGuard(OwnerGuard)
      async report(_interaction: MessageContextMenuCommandInteraction) {}
    }

    expect(compile(Menu)).toThrow('Menu.report: OwnerGuard is for component and modal handlers, whose customId carries the owner\'s id, and this is a context menu handler.')
  })

  it('refuses it written on a message handler or an event handler', () => {
    @Controller()
    class Messages {
      @MessageHandler('card {ownerId}')
      @UseGuard(OwnerGuard)
      async card(_message: Message) {}
    }
    @Controller()
    class Events {
      @On('messageCreate')
      @UseGuard(OwnerGuard)
      async created(_message: Message) {}
    }

    expect(refusals(compile(Messages))).toEqual([
      "Messages.card: OwnerGuard is for component and modal handlers, whose customId carries the owner's id, and this is a message handler.",
    ])
    expect(refusals(compile(Events))).toEqual([
      "Events.created: OwnerGuard is for component and modal handlers, whose customId carries the owner's id, and this is an event handler.",
    ])
  })

  // A class only a provider makes keeps a handler that fails a controller's checks from running, with a warning until 5.0
  it('skips an event handler with it on a class a provider makes, with a warning naming why', async () => {
    const heard: string[] = []
    @Service()
    class Events {
      @On('guildCreate')
      @UseGuard(OwnerGuard)
      async joined() {
        heard.push('joined')
      }
    }
    @MeoCord({ controllers: [], providers: [{ provide: 'EVENTS', useClass: Events }], clientOptions: { intents: [] } })
    class App {}
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    try {
      const module = await MeoCordTestingModule.fromApp(App).compile().init()
      await module.emit('guildCreate', {} as never)

      expect(heard).toEqual([])
      expect(warn.mock.calls.map(call => String(call[0]))).toContainEqual(
        expect.stringContaining("Events.joined: OwnerGuard is for component and modal handlers, whose customId carries the owner's id, and this is an event handler."),
      )
    } finally {
      warn.mockRestore()
    }
  })

  it('refuses it on a component whose route lacks the param', () => {
    @Controller()
    class Routes {
      @Command('card/{id:snowflake}', CommandType.BUTTON)
      @UseGuard(OwnerGuard)
      async card(_interaction: ButtonInteraction) {}
    }

    expect(compile(Routes)).toThrow(
      'Routes.card: OwnerGuard compares the user with the customId param "ownerId", and the route "card/{id:snowflake}" has none. ' +
        'Add {ownerId:snowflake} to the pattern, or name the param with { provide: OwnerGuard, params: { param } }.',
    )
  })

  it('refuses it on a component whose route lacks the param its params name', () => {
    @Controller()
    class Routes {
      @Command('poll/{pollId}/{ownerId:snowflake}', CommandType.BUTTON)
      @UseGuard({ provide: OwnerGuard, params: { param: 'authorId' } })
      async close(_interaction: ButtonInteraction) {}
    }

    expect(compile(Routes)).toThrow('Routes.close: OwnerGuard compares the user with the customId param "authorId", and the route "poll/{pollId}/{ownerId:snowflake}" has none.')
  })

  it('refuses it on a component one of whose routes lacks the param', () => {
    @Controller()
    class Routes {
      @Command('static-card', CommandType.BUTTON)
      @Command('static-card/{ownerId:snowflake}', CommandType.BUTTON)
      @UseGuard(OwnerGuard)
      async either(_interaction: ButtonInteraction) {}
    }

    expect(compile(Routes)).toThrow('Routes.either: OwnerGuard compares the user with the customId param "ownerId", and the route "static-card" has none.')
  })

  it('takes a component whose route has the param its params name', () => {
    @Controller()
    class Routes {
      @Command('poll/{pollId}/{authorId:snowflake}', CommandType.BUTTON)
      @UseGuard({ provide: OwnerGuard, params: { param: 'authorId' } })
      async close(_interaction: ButtonInteraction) {}
    }

    expect(compile(Routes)).not.toThrow()
  })

  // As a controller's own @Cooldown passes over the handlers it never counts
  it.each([
    [
      'an event handler',
      () => {
        @Controller()
        @UseGuard(OwnerGuard)
        class Panel {
          @Command('panel/{ownerId:snowflake}', CommandType.BUTTON)
          async open(_interaction: ButtonInteraction) {}

          @On('guildCreate')
          async joined() {}
        }
        return Panel
      },
    ],
    [
      'a message handler',
      () => {
        @Controller()
        @UseGuard(OwnerGuard)
        class Panel {
          @Command('panel/{ownerId:snowflake}', CommandType.BUTTON)
          async open(_interaction: ButtonInteraction) {}

          @MessageHandler('panel')
          async typed(_message: Message) {}
        }
        return Panel
      },
    ],
    [
      'a reaction handler',
      () => {
        @Controller()
        @UseGuard(OwnerGuard)
        class Panel {
          @Command('panel/{ownerId:snowflake}', CommandType.BUTTON)
          async open(_interaction: ButtonInteraction) {}

          @ReactionHandler('⭐')
          async starred() {}
        }
        return Panel
      },
    ],
  ])('passes a controller-level one over %s beside the controller’s components, which it never runs for', (_, make) => {
    expect(refusals(compile(make()))).toEqual([])
  })

  it('refuses a controller-level one on each handler of the controller it cannot guard', () => {
    @Controller()
    @UseGuard(OwnerGuard)
    class Panel {
      @Command('panel/{ownerId:snowflake}', CommandType.BUTTON)
      async open(_interaction: ButtonInteraction) {}

      @Command('panel', CommandType.SLASH)
      async show(_interaction: ChatInputCommandInteraction) {}
    }

    expect(refusals(compile(Panel))).toEqual([
      "Panel.show: OwnerGuard is for component and modal handlers, whose customId carries the owner's id, and this is a slash command handler.",
    ])
  })

  it('refuses a global one on a slash command, naming where it came from, and passes over the handlers it skips', () => {
    @Controller()
    class Mixed {
      @Command('panel/{ownerId:snowflake}', CommandType.BUTTON)
      async open(_interaction: ButtonInteraction) {}

      @Command('panel', CommandType.SLASH)
      async show(_interaction: ChatInputCommandInteraction) {}

      @Autocomplete('panel')
      async suggest(_interaction: AutocompleteInteraction) {}

      @MessageHandler('panel')
      async typed(_message: Message) {}

      @ReactionHandler('⭐')
      async starred() {}

      @On('messageCreate')
      async created(_message: Message) {}
    }
    @MeoCord({ controllers: [Mixed], guards: [OwnerGuard], clientOptions: { intents: [] } })
    class App {}

    // Every refusal the start collected, so a handler left out is one passed over
    expect(refusals(() => MeoCordTestingModule.create({ app: App, controllers: [Mixed] }).compile())).toEqual([
      "Mixed.show: OwnerGuard, from @MeoCord({ guards }), is for component and modal handlers, whose customId carries the owner's id, and this is a slash command handler.",
    ])
  })

  it('leaves a guard extending it to the app', () => {
    class AuthorGuard extends OwnerGuard {}
    @Controller()
    class Messages {
      @MessageHandler('card')
      @UseGuard(AuthorGuard)
      async card(_message: Message) {}
    }

    expect(compile(Messages)).not.toThrow()
  })
})
