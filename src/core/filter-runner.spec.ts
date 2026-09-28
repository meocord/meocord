import { Container } from 'inversify'
import { ButtonInteraction, ChatInputCommandInteraction } from 'discord.js'
import { vi } from 'vitest'
import {
  Catch,
  Command,
  Controller,
  Guard,
  Interceptor,
  MeoCord,
  UseFilter,
  UseGuard,
  UseInterceptor,
} from '@src/decorator/index.js'
import { CommandType, MetadataKey } from '@src/enum/index.js'
import { type ExceptionFilter, type GuardInterface, type InterceptorInterface } from '@src/interface/index.js'
import { ExecutionContext, GuardDeniedError } from '@src/common/index.js'
import { MeoCordApp } from '@src/core/meocord.app.js'
import { appStages, bindGlobalStages, prepareHandlerStages } from '@src/core/handler-pipeline.js'
import {
  createChatInputOptions,
  createMockInteraction,
  inspectHandler,
  MeoCordTestingModule,
} from '@src/testing/index.js'

const log: string[] = []

class NotFoundError extends Error {}
class ProfileNotFoundError extends NotFoundError {}
class RateLimitedError extends Error {}

function logFilter(name: string, ...types: (abstract new (...args: any[]) => unknown)[]) {
  @Catch(...types)
  class LogFilter implements ExceptionFilter {
    catch(error: unknown, context: ExecutionContext) {
      const params = context.getParams()?.label
      log.push(`${name}:${(error as Error).message}:${context.getHandlerName()}${params ? `:${params}` : ''}`)
    }
  }
  Object.defineProperty(LogFilter, 'name', { value: name })
  return LogFilter
}

const MethodNotFoundFilter = logFilter('method', ProfileNotFoundError)
const ClassNotFoundFilter = logFilter('class', NotFoundError)
const ClassRateFilter = logFilter('class rate', RateLimitedError)
const GlobalFilter = logFilter('global')
const FirstFilter = logFilter('first', NotFoundError)
const SecondFilter = logFilter('second', NotFoundError)
const ChildFilter = logFilter('child', NotFoundError)
const DeniedFilter = logFilter('denied', GuardDeniedError)

@Catch(RateLimitedError)
class BrokenFilter implements ExceptionFilter {
  catch() {
    throw new Error('filter failed')
  }
}

@Guard()
class ThrowingGuard implements GuardInterface {
  canActivate(): boolean {
    throw new GuardDeniedError('Owners only.')
  }
}

@Interceptor()
class ThrowingInterceptor implements InterceptorInterface {
  intercept() {
    throw new NotFoundError('from interceptor')
  }
}

@Controller()
@UseFilter(ClassNotFoundFilter, ClassRateFilter)
class ProfileController {
  @Command('profile', CommandType.SLASH)
  @UseFilter(MethodNotFoundFilter)
  async profile(_interaction: ChatInputCommandInteraction) {
    throw new ProfileNotFoundError('no profile')
  }

  @Command('lookup', CommandType.SLASH)
  @UseFilter(MethodNotFoundFilter)
  async lookup(_interaction: ChatInputCommandInteraction) {
    throw new NotFoundError('no lookup')
  }

  @Command('limited', CommandType.SLASH)
  async limited(_interaction: ChatInputCommandInteraction) {
    throw new RateLimitedError('slow down')
  }

  @Command('other', CommandType.SLASH)
  async other(_interaction: ChatInputCommandInteraction) {
    throw new Error('unexpected')
  }

  @Command('ordered', CommandType.SLASH)
  @UseFilter(FirstFilter, SecondFilter)
  async ordered(_interaction: ChatInputCommandInteraction) {
    throw new NotFoundError('ordered')
  }

  @Command('guarded', CommandType.SLASH)
  @UseGuard(ThrowingGuard)
  @UseFilter(DeniedFilter)
  async guarded(_interaction: ChatInputCommandInteraction) {
    log.push('handler')
  }

  @Command('intercepted', CommandType.SLASH)
  @UseInterceptor(ThrowingInterceptor)
  async intercepted(_interaction: ChatInputCommandInteraction) {
    log.push('handler')
  }

  @Command('params', CommandType.SLASH)
  @UseFilter({ provide: logFilter('with params'), params: { label: 'p' } })
  async params(_interaction: ChatInputCommandInteraction) {
    throw new Error('params')
  }

  @Command('fine', CommandType.SLASH)
  async fine(_interaction: ChatInputCommandInteraction) {
    log.push('handler')
  }
}

@Controller()
@UseFilter(ChildFilter)
class ChildProfileController extends ProfileController {}

@Controller()
@UseFilter(BrokenFilter)
class BrokenController {
  @Command('broken', CommandType.SLASH)
  async broken(_interaction: ChatInputCommandInteraction) {
    throw new RateLimitedError('slow down')
  }
}

@MeoCord({ controllers: [ProfileController], clientOptions: { intents: [] }, filters: [GlobalFilter] })
class App {}

const slash = (commandName = 'profile') => {
  const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName })
  interaction.options = createChatInputOptions({})
  return interaction
}

const compile = (controllers: (new (...args: any[]) => unknown)[] = [ProfileController], app?: typeof App) =>
  MeoCordTestingModule.create({ app, controllers }).compile()

describe('exception filters', () => {
  beforeEach(() => {
    log.length = 0
  })

  it('handle the handler error with the method filter first', async () => {
    const outcome = await compile([ProfileController], App).invoke(ProfileController, 'profile', slash())

    expect(log).toEqual(['method:no profile:profile'])
    expect(outcome).toEqual({ ran: true, error: expect.any(ProfileNotFoundError) })
  })

  it('fall back to the controller level when no method filter matches, then to global filters', async () => {
    const module = compile([ProfileController], App)

    await module.invoke(ProfileController, 'lookup', slash('lookup'))
    await module.invoke(ProfileController, 'limited', slash('limited'))
    await module.invoke(ProfileController, 'other', slash('other'))

    expect(log).toEqual(['class:no lookup:lookup', 'class rate:slow down:limited', 'global:unexpected:other'])
  })

  it('take the first matching filter within a level, in the order listed', async () => {
    await compile().invoke(ProfileController, 'ordered', slash('ordered'))
    expect(log).toEqual(['first:ordered:ordered'])
  })

  it('handle errors from guards and interceptors too', async () => {
    const module = compile()

    const guarded = await module.invoke(ProfileController, 'guarded', slash('guarded'))
    await module.invoke(ProfileController, 'intercepted', slash('intercepted'))

    expect(log).toEqual(['denied:Owners only.:guarded', 'class:from interceptor:intercepted'])
    expect(guarded.ran).toBe(false)
  })

  it('receive their params through the context', async () => {
    await compile().invoke(ProfileController, 'params', slash('params'))
    expect(log).toEqual(['with params:params:params:p'])
  })

  it('try the class declaring an inherited handler before the subclass', async () => {
    await compile([ChildProfileController]).invoke(ChildProfileController, 'lookup', slash('lookup'))
    expect(log).toEqual(['class:no lookup:lookup'])
    expect(inspectHandler(ChildProfileController, 'lookup').filters).toEqual([
      MethodNotFoundFilter,
      ClassNotFoundFilter,
      ClassRateFilter,
      ChildFilter,
    ])
  })

  it('leave a successful call alone', async () => {
    expect(await compile([ProfileController], App).invoke(ProfileController, 'fine', slash('fine'))).toEqual({
      ran: true,
    })
  })

  it('reject under invoke when no filter handles the error, since the fallback does not run there', async () => {
    await expect(compile().invoke(ProfileController, 'other', slash('other'))).rejects.toThrow('unexpected')
  })

  it('reject under invoke with the error a filter throws', async () => {
    await expect(compile([BrokenController]).invoke(BrokenController, 'broken', slash('broken'))).rejects.toThrow(
      'filter failed',
    )
  })

  it('honour overrideFilter stubs, still matched by the filter class', async () => {
    const stub = vi.fn()
    const module = MeoCordTestingModule.create({ controllers: [ProfileController] })
      .overrideFilter(ClassNotFoundFilter)
      .useValue({ catch: stub })
      .compile()

    await module.invoke(ProfileController, 'lookup', slash('lookup'))

    expect(stub).toHaveBeenCalledWith(expect.any(NotFoundError), expect.any(ExecutionContext))
    expect(log).toEqual([])
  })

  it('are listed by inspectHandler in the order they are tried', () => {
    expect(inspectHandler(ProfileController, 'profile', { app: App }).filters).toEqual([
      MethodNotFoundFilter,
      ClassNotFoundFilter,
      ClassRateFilter,
      GlobalFilter,
    ])
  })
})

describe('exception filters at startup', () => {
  it('must be decorated with @Catch', () => {
    class NotAFilter implements ExceptionFilter {
      catch() {}
    }

    @Controller()
    class UsesUndecorated {
      @Command('x', CommandType.SLASH)
      @UseFilter(NotAFilter)
      async x(_interaction: ChatInputCommandInteraction) {}
    }

    expect(() => compile([UsesUndecorated])).toThrow(
      'NotAFilter: used as an exception filter, but not decorated with @Catch().',
    )
  })

  it('cannot inject ExecutionContext, since one instance is shared', () => {
    @Catch()
    class ContextFilter implements ExceptionFilter {
      constructor(readonly context: ExecutionContext) {}
      catch() {}
    }

    @MeoCord({ controllers: [], clientOptions: { intents: [] }, filters: [ContextFilter] })
    class ContextApp {}

    expect(() => MeoCordTestingModule.create({ app: ContextApp }).compile()).toThrow(
      'ContextFilter: resolved once and shared, so it cannot inject ExecutionContext',
    )
  })
})

describe('exception filters under dispatch', () => {
  beforeEach(() => {
    log.length = 0
  })

  async function startApp() {
    const container = new Container()
    container.bind(ProfileController).toSelf().inSingletonScope()
    Reflect.defineMetadata(MetadataKey.Container, container, ProfileController)
    bindGlobalStages(container, appStages(App))
    prepareHandlerStages(container, [ProfileController])

    const listeners = new Map<string, (...args: unknown[]) => Promise<void>>()
    const client = {
      on: vi.fn((event: string, handler: (...args: unknown[]) => Promise<void>) => listeners.set(event, handler)),
      login: vi.fn().mockResolvedValue('token'),
      user: { setActivity: vi.fn() },
      application: null,
    }
    await new MeoCordApp([ProfileController], container, client as never, 'token').start()
    return (interaction: unknown) => listeners.get('interactionCreate')?.(interaction)
  }

  it('handle handler errors as under invoke', async () => {
    const emit = await startApp()
    const interaction = slash('other')

    await emit(interaction)

    expect(log).toEqual(['global:unexpected:other'])
    expect(interaction.reply).not.toHaveBeenCalled()
  })

  it('receive CommandNotFoundError, with no handler, at the global level', async () => {
    const emit = await startApp()

    await emit(createMockInteraction(ButtonInteraction, { customId: 'nothing/here' }))

    expect(log).toEqual([expect.stringMatching(/^global:No handler matched .*:undefined$/)])
  })

  it('leave CommandNotFoundError to the fallback when no global filter matches', async () => {
    const container = new Container()
    const client = {
      on: vi.fn(),
      login: vi.fn().mockResolvedValue('token'),
      user: { setActivity: vi.fn() },
      application: null,
    }
    const app = new MeoCordApp([], container, client as never, 'token')
    await app.start()
    const handler = client.on.mock.calls.find(([event]) => event === 'interactionCreate')?.[1] as (
      interaction: unknown,
    ) => Promise<void>
    const interaction = createMockInteraction(ButtonInteraction, { customId: 'nothing/here' })

    await handler(interaction)

    const [[payload]] = interaction.reply.mock.calls as [[{ embeds: { description: string }[] }]]
    expect(payload.embeds[0].description).toBe('Command not found!')
  })
})
