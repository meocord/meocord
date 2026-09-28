import { AutocompleteInteraction, ButtonInteraction, ChatInputCommandInteraction, ModalSubmitInteraction } from 'discord.js'
import {
  Autocomplete,
  Command,
  Controller,
  Guard,
  Interceptor,
  MessageHandler,
  On,
  Pipe,
  Service,
  UseGuard,
  UseInterceptor,
  UsePipe,
  Validate,
} from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { type CallHandler, type GuardInterface, type InterceptorInterface, type PipeInterface, type Piped, type StandardSchemaV1 } from '@src/interface/index.js'
import { type ExecutionContext, ValidationError } from '@src/common/index.js'
import { createChatInputOptions, createMockInteraction, createModalFields, MeoCordTestingModule } from '@src/testing/index.js'

const log: string[] = []

/**
 * A Standard Schema for an object of numbers and strings, as zod or valibot would give: `minutes` must
 * be a positive integer, `note` defaults to an empty string, `uid` must be digits.
 */
function schema<Output>(check: (input: Record<string, unknown>) => { value?: Output; issues?: { message: string; path: string[] }[] }, async = false): StandardSchemaV1<unknown, Output> {
  return {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: value => {
        log.push('validate')
        const result = check(value as Record<string, unknown>)
        const outcome = result.issues ? { issues: result.issues } : { value: result.value as Output }
        return async ? Promise.resolve(outcome) : outcome
      },
    },
  }
}

const reminder = schema<{ minutes: number; note: string }>(({ minutes, note }) =>
  typeof minutes === 'number' && Number.isInteger(minutes) && minutes > 0
    ? { value: { minutes, note: typeof note === 'string' ? note : '' } }
    : { issues: [{ message: 'Must be a positive whole number', path: ['minutes'] }] },
)

const profile = schema<{ uid: string }>(
  ({ uid }) => (typeof uid === 'string' && /^\d+$/.test(uid) ? { value: { uid } } : { issues: [{ message: 'Not a uid', path: ['uid'] }] }),
  true,
)

class Account {
  constructor(
    readonly uid: string,
    readonly region?: string,
  ) {}
}

@Service()
class AccountService {
  find(uid: string, region?: string) {
    return new Account(uid, region)
  }
}

@Pipe()
class AccountPipe implements PipeInterface<string, Account> {
  constructor(private readonly accounts: AccountService) {}

  transform(uid: string, context: ExecutionContext): Account {
    log.push(`account:${uid}`)
    return this.accounts.find(uid, context.getParams<{ region: string }>()?.region)
  }
}

@Pipe()
class TrimPipe implements PipeInterface<string, string> {
  transform(value: string): string {
    log.push('trim')
    return value.trim()
  }
}

@Pipe()
class PrefixPipe implements PipeInterface<string, string> {
  transform(value: string): string {
    log.push('prefix')
    return `#${value}`
  }
}

@Pipe()
class FailingPipe implements PipeInterface<string, string> {
  transform(): string {
    throw new Error('no such account')
  }
}

@Guard()
class Deny implements GuardInterface {
  canActivate() {
    log.push('deny')
    return false
  }
}

@Interceptor()
class Recorder implements InterceptorInterface {
  async intercept(_context: ExecutionContext, next: CallHandler) {
    log.push('before')
    try {
      return await next.handle()
    } catch (error) {
      log.push(`saw:${(error as Error).name}`)
      throw error
    }
  }
}

const received: unknown[] = []

@Controller()
class InputController {
  @Command('remind', CommandType.SLASH)
  @Validate(reminder)
  async remind(_interaction: ChatInputCommandInteraction, params: { minutes: number; note: string }) {
    log.push('handler')
    received.push(params)
  }

  @Command('profile/{uid}', CommandType.BUTTON)
  @Validate(profile, { pipes: { uid: { provide: AccountPipe, params: { region: 'eu' } } } })
  async profile(_interaction: ButtonInteraction, params: { uid: Account }) {
    received.push(params)
  }

  @Command('tag/{uid}', CommandType.BUTTON)
  @Validate(profile, { pipes: { uid: TrimPipe } })
  @UsePipe('uid', PrefixPipe)
  async tag(_interaction: ButtonInteraction, params: { uid: Piped<string> }) {
    received.push(params)
  }

  @Command('raw/{uid}', CommandType.BUTTON)
  @UsePipe('uid', TrimPipe, PrefixPipe)
  async raw(_interaction: ButtonInteraction, params: { uid: string }) {
    received.push(params)
  }

  @Command('broken/{uid}', CommandType.BUTTON)
  @UsePipe('uid', FailingPipe)
  async broken(_interaction: ButtonInteraction, _params: { uid: string }) {
    log.push('handler')
  }

  @Command('guarded', CommandType.SLASH)
  @UseGuard(Deny)
  @Validate(reminder)
  async guarded(_interaction: ChatInputCommandInteraction, _params: { minutes: number }) {
        void _params
      }

  @Command('intercepted', CommandType.SLASH)
  @UseInterceptor(Recorder)
  @Validate(reminder)
  async intercepted(_interaction: ChatInputCommandInteraction, _params: { minutes: number }) {
    log.push('handler')
  }

  @Command('feedback/{topic}', CommandType.MODAL_SUBMIT)
  async feedback(_interaction: ModalSubmitInteraction, params: Record<string, unknown>) {
    received.push(params)
  }

  @Autocomplete('remind')
  async suggest(_interaction: AutocompleteInteraction, params: Record<string, unknown>) {
    received.push(params)
  }
}

const module = () =>
  MeoCordTestingModule.create({ controllers: [InputController] }).compile()

const slash = (options: Record<string, string | number>) =>
  createMockInteraction(ChatInputCommandInteraction, { options: createChatInputOptions(options) as never })

const button = (customId: string) => createMockInteraction(ButtonInteraction, { customId })

/** A modal submitted with text inputs, as discord.js would build its fields. */
const modal = (customId: string, values: Record<string, string>) =>
  createMockInteraction(ModalSubmitInteraction, {
    customId,
    fields: createModalFields(values),
  })

beforeEach(() => {
  log.length = 0
  received.length = 0
})

describe('@Validate', () => {
  it("hands the handler the schema's output, with its defaults applied", async () => {
    const { ran } = await module().invoke(InputController, 'remind', slash({ minutes: 5 }))

    expect(ran).toBe(true)
    expect(received).toEqual([{ minutes: 5, note: '' }])
  })

  it('stops the call with a ValidationError listing each issue', async () => {
    const run = module().invoke(InputController, 'remind', slash({ minutes: -1 }))

    await expect(run).rejects.toThrow(ValidationError)
    await expect(run).rejects.toMatchObject({ issues: [{ message: 'Must be a positive whole number', path: ['minutes'] }] })
    expect(log).not.toContain('handler')
  })

  it('reports an issue whose path holds a symbol key, as Standard Schema allows', async () => {
    const tagged: StandardSchemaV1<unknown, { minutes: number }> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: () => ({ issues: [{ message: 'Unknown tag', path: ['tags', { key: Symbol('primary') }] }] }),
      },
    }
    @Controller()
    class TaggedController {
      @Command('tagged', CommandType.SLASH)
      @Validate(tagged)
      async tagged(_interaction: ChatInputCommandInteraction, _params: { minutes: number }) {}
    }

    const run = MeoCordTestingModule.create({ controllers: [TaggedController] }).compile().invoke(TaggedController, 'tagged', slash({}))

    await expect(run).rejects.toThrow(ValidationError)
    await expect(run).rejects.toThrow('tags.primary: Unknown tag')
  })

  it('awaits an asynchronous schema', async () => {
    await expect(module().invoke(InputController, 'profile', button('profile/abc'))).rejects.toThrow('uid: Not a uid')
  })

  it('does not run when a guard denies the call', async () => {
    const { ran } = await module().invoke(InputController, 'guarded', slash({ minutes: 5 }))

    expect(ran).toBe(false)
    expect(log).toEqual(['deny'])
  })

  // Interceptors wrap validation, so a timing or logging interceptor sees the failure as the handler's.
  it('runs inside the interceptors', async () => {
    await expect(module().invoke(InputController, 'intercepted', slash({ minutes: 0 }))).rejects.toThrow(ValidationError)

    expect(log).toEqual(['before', 'validate', 'saw:ValidationError'])
  })
})

describe('pipes', () => {
  it('replace a validated value, resolved from the container with their params', async () => {
    await module().invoke(InputController, 'profile', button('profile/42'))

    expect(received).toEqual([{ uid: new Account('42', 'eu') }])
  })

  it("run @Validate's own first, then @UsePipe's", async () => {
    await module().invoke(InputController, 'tag', button('tag/7'))

    expect(log).toEqual(['validate', 'trim', 'prefix'])
    expect(received).toEqual([{ uid: '#7' }])
  })

  it('run in order without a schema', async () => {
    await module().invoke(InputController, 'raw', button('raw/9'))

    expect(log).toEqual(['trim', 'prefix'])
    expect(received).toEqual([{ uid: '#9' }])
  })

  it('stop the call with what they throw', async () => {
    await expect(module().invoke(InputController, 'broken', button('broken/1'))).rejects.toThrow('no such account')
    expect(log).not.toContain('handler')
  })
})

describe('the input invoke builds when a test gives only the interaction', () => {
  it("takes a command's options", async () => {
    await module().invoke(InputController, 'remind', slash({ minutes: 3, note: 'tea' }))

    expect(received).toEqual([{ minutes: 3, note: 'tea' }])
  })

  it("takes an autocomplete's options, as dispatch passes them", async () => {
    const interaction = createMockInteraction(AutocompleteInteraction, { options: createChatInputOptions({ note: 'te' }) as never })
    await module().invoke(InputController, 'suggest', interaction)

    expect(received).toEqual([{ note: 'te' }])
  })

  it("takes the handler's customId params and a modal's fields together", async () => {
    await module().invoke(InputController, 'feedback', modal('feedback/bugs', { body: 'It crashed' }))

    expect(received).toEqual([{ topic: 'bugs', body: 'It crashed' }])
  })

  it('keeps the customId param when a modal field shares its name', async () => {
    await module().invoke(InputController, 'feedback', modal('feedback/bugs', { topic: 'typed by the user' }))

    expect(received).toEqual([{ topic: 'bugs' }])
  })

  it('passes params a test gives through unchanged', async () => {
    await module().invoke(InputController, 'feedback', modal('feedback/bugs', {}), { given: true })

    expect(received).toEqual([{ given: true }])
  })
})

describe('where they apply', () => {
  it('refuses a second @Validate on one handler, which would replace the first', () => {
    expect(() => {
      @Controller()
      class TwiceController {
        @Command('twice', CommandType.SLASH)
        @Validate(reminder)
        @Validate(reminder)
        async twice(_interaction: ChatInputCommandInteraction, _params: { minutes: number; note: string }) {}
      }
      return TwiceController
    }).toThrow('TwiceController.twice: more than one @Validate; one @Validate per handler: combine the schemas into one.')
  })

  it('refuses @Validate on a message handler without a pattern at startup', () => {
    @Controller()
    class MessageController {
      @MessageHandler()
      async ping(_message: unknown, _params?: unknown) {
        void _params
      }
    }

    // Applied by hand: a listener's one-argument signature already rejects @Validate at compile time.
    Validate(reminder)(MessageController.prototype, 'ping', Object.getOwnPropertyDescriptor(MessageController.prototype, 'ping') as never)

    expect(() => MeoCordTestingModule.create({ controllers: [MessageController] }).compile()).toThrow(
      'MessageController.ping is a message handler without a pattern; @Validate and @UsePipe apply only to interaction and patterned message handlers',
    )
  })
})

describe('on events', () => {
  it('refuses @Validate on an event handler at startup', () => {
    @Controller()
    class WelcomeController {
      @On('guildMemberAdd')
      async greet(_member: unknown, _params?: unknown) {}
    }
    // Applied by hand: an event handler's signature is the event's, which @Validate's types reject.
    Validate(reminder)(WelcomeController.prototype, 'greet', Object.getOwnPropertyDescriptor(WelcomeController.prototype, 'greet') as never)

    expect(() => MeoCordTestingModule.create({ controllers: [WelcomeController] }).compile()).toThrow(
      'WelcomeController.greet is an event handler',
    )
  })
})

describe('ValidationError', () => {
  it('names each issue by its path in its message', () => {
    const error = ValidationError.fromSchemaIssues([
      { message: 'Too long', path: ['note'] },
      { message: 'Required', path: [{ key: 'options' }, 0] },
      { message: 'Invalid input' },
    ])

    expect(error.message).toBe('note: Too long\noptions.0: Required\nInvalid input')
    expect(error.issues[1].path).toEqual(['options', 0])
  })
})
