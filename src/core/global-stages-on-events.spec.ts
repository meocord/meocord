import { AutocompleteInteraction, ChatInputCommandInteraction, type Message, MessageReaction } from 'discord.js'
import { vi } from 'vitest'
import {
  Autocomplete,
  Catch,
  Command,
  Controller,
  Guard,
  Interceptor,
  MeoCord,
  MessageHandler,
  On,
  ReactionHandler,
  UseGuard,
  UseInterceptor,
} from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { type ExecutionContext, Logger } from '@src/common/index.js'
import { forgetDeprecationWarnings } from '@src/common/deprecation.js'
import { type CallHandler, type ExceptionFilter, type GuardInterface, type InterceptorInterface } from '@src/interface/index.js'
import {
  createChatInputOptions,
  createMockInteraction,
  createMockMessage,
  createMockUser,
  inspectHandler,
  MeoCordTestingModule,
} from '@src/testing/index.js'
import { forgetStrictMocks, useStrictMocks } from '@src/testing/strict-mocks.js'

// With globalStagesOnEvents: false, the app's untyped guards and interceptors skip @On and @Once handlers alone.

/** Which stage saw which type of call, in order. */
const seen: string[] = []

@Guard()
class Untyped implements GuardInterface {
  canActivate(..._args: unknown[]) {
    seen.push(`guard:${current}`)
    return true
  }
}

@Guard({ types: ['event'] })
class OnEvents implements GuardInterface {
  canActivate() {
    seen.push('typed guard')
    return true
  }
}

@Interceptor()
class Timing implements InterceptorInterface {
  intercept(_context: ExecutionContext, next: CallHandler) {
    seen.push(`interceptor:${current}`)
    return next.handle()
  }
}

@Guard()
class Own implements GuardInterface {
  canActivate() {
    seen.push('own guard')
    return true
  }
}

@Interceptor()
class OwnTiming implements InterceptorInterface {
  intercept(_context: ExecutionContext, next: CallHandler) {
    seen.push('own interceptor')
    return next.handle()
  }
}

const caught: string[] = []

@Catch()
class Report implements ExceptionFilter {
  catch(error: Error) {
    caught.push(error.message)
  }
}

/** The kind of call being made, which the stages record. */
let current = ''

@Controller()
class Bot {
  @Command('ping', CommandType.SLASH)
  ping() {
    seen.push('ping')
  }

  @Autocomplete('ping')
  async suggest(interaction: AutocompleteInteraction) {
    await interaction.respond([])
  }

  @MessageHandler('hello', { prefix: false })
  hello(_message: Message) {
    seen.push('hello')
  }

  @ReactionHandler('⭐')
  star() {
    seen.push('star')
  }

  @On('guildCreate')
  joined() {
    seen.push('joined')
  }

  @On('guildDelete')
  @UseGuard(Own)
  @UseInterceptor(OwnTiming)
  left() {
    seen.push('left')
  }

  @On('guildUpdate')
  updated() {
    throw new Error('update failed')
  }

  // The app's untyped guard, listed on the handler too
  @On('threadCreate')
  @UseGuard(Untyped)
  opened() {
    seen.push('opened')
  }
}

const app = (globalStagesOnEvents?: boolean, guards: unknown[] = [Untyped]) => {
  @MeoCord({
    controllers: [Bot],
    clientOptions: { intents: [] },
    guards: guards as [],
    interceptors: [Timing],
    filters: [Report],
    ...(globalStagesOnEvents !== undefined && { globalStagesOnEvents }),
  })
  class App {}
  return App
}
const compile = (globalStagesOnEvents?: boolean, guards?: unknown[]) => {
  const App = app(globalStagesOnEvents, guards)
  return MeoCordTestingModule.create({ app: App, controllers: [Bot] }).compile()
}

/** Makes one call of each type through `module`. */
const calls = {
  event: (module: ReturnType<typeof compile>) => module.emit('guildCreate', {} as never),
  interaction: (module: ReturnType<typeof compile>) =>
    module.dispatch(Object.assign(createMockInteraction(ChatInputCommandInteraction, { commandName: 'ping' }), { options: createChatInputOptions({}) })),
  message: (module: ReturnType<typeof compile>) => module.dispatch(createMockMessage({ content: 'hello' })),
  reaction: (module: ReturnType<typeof compile>) =>
    module.dispatch(createMockInteraction(MessageReaction, { emoji: { name: '⭐' }, message: createMockMessage() } as never), { user: createMockUser() }),
  autocomplete: (module: ReturnType<typeof compile>) => module.dispatch(createMockInteraction(AutocompleteInteraction, { commandName: 'ping' })),
}

async function call(module: ReturnType<typeof compile>, type: keyof typeof calls): Promise<string[]> {
  seen.length = 0
  current = type
  await calls[type](module)
  return [...seen]
}

beforeEach(() => {
  seen.length = 0
  caught.length = 0
})

describe('@MeoCord({ globalStagesOnEvents: false })', () => {
  it('runs an untyped global guard and interceptor before no @On handler', async () => {
    expect(await call(compile(false), 'event')).toEqual(['joined'])
  })

  it.each([
    ['interaction', ['guard:interaction', 'interceptor:interaction', 'ping']],
    ['message', ['guard:message', 'interceptor:message', 'hello']],
    ['reaction', ['guard:reaction', 'interceptor:reaction', 'star']],
    // Interceptors never run for autocomplete
    ['autocomplete', ['guard:autocomplete']],
  ] as const)('still runs them for a call of type %s', async (type, expected) => {
    expect(await call(compile(false), type)).toEqual(expected)
  })

  it("keeps a global guard's declared types, 'event' included", async () => {
    expect(await call(compile(false, [OnEvents]), 'event')).toEqual(['typed guard', 'joined'])
  })

  it('leaves the guards and interceptors a handler names to run on its event', async () => {
    seen.length = 0
    await compile(false).emit('guildDelete', {} as never)

    expect(seen).toEqual(['own guard', 'own interceptor', 'left'])
  })

  it("leaves a global exception filter to handle an event handler's error", async () => {
    await compile(false).emit('guildUpdate', {} as never, {} as never)

    expect(caught).toEqual(['update failed'])
  })

  it("runs a guard listed both among the app's guards and on an @On handler once, as the handler's", async () => {
    current = 'event'
    await compile(false).emit('threadCreate', {} as never, true)

    expect(seen).toEqual(['guard:event', 'opened'])
  })

  it("stubs with overrideGuard only the handler's copy of that guard, the app's being skipped", async () => {
    const stubbed: string[] = []
    const module = MeoCordTestingModule.create({ app: app(false), controllers: [Bot] })
      .overrideGuard(Untyped)
      .useValue({ canActivate: () => (stubbed.push('stub'), true) })
      .compile()

    await module.emit('threadCreate', {} as never, true)

    expect(stubbed).toEqual(['stub'])
    expect(seen).toEqual(['opened'])
  })

  it("warns in default mode that inspectHandler lists the app's guards and interceptors dispatch skips for the handler", () => {
    forgetStrictMocks()
    forgetDeprecationWarnings()
    const warned: string[] = []
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation((text: unknown) => void warned.push(String(text)))
    try {
      expect(inspectHandler(Bot, 'joined', { app: app(false) })).toMatchObject({ guards: [Untyped], interceptors: [Timing] })
      expect(warned).toEqual([expect.stringContaining('for an event handler under globalStagesOnEvents: false')])
    } finally {
      warn.mockRestore()
    }
  })

  it('lists for inspectHandler, under useStrictMocks(), the stages dispatch runs for the handler', () => {
    forgetStrictMocks()
    useStrictMocks()
    try {
      expect(inspectHandler(Bot, 'joined', { app: app(false) })).toMatchObject({ guards: [], interceptors: [] })
      expect(inspectHandler(Bot, 'ping', { app: app(false) })).toMatchObject({ guards: [Untyped], interceptors: [Timing] })
      expect(inspectHandler(Bot, 'joined', { app: app(true) })).toMatchObject({ guards: [Untyped], interceptors: [Timing] })
    } finally {
      forgetStrictMocks()
    }
  })
})

describe('without globalStagesOnEvents: false', () => {
  it.each([undefined, true])('runs an untyped global guard and interceptor before an @On handler with the option %s', async option => {
    expect(await call(compile(option), 'event')).toEqual(['guard:event', 'interceptor:event', 'joined'])
  })

  it('takes only true or false', () => {
    expect(() => app('no' as never)).toThrow('App: @MeoCord({ globalStagesOnEvents }) takes true or false.')
  })
})
