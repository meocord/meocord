import { Container, inject } from 'inversify'
import { AutocompleteInteraction, ChatInputCommandInteraction } from 'discord.js'
import { vi } from 'vitest'
import {
  Autocomplete,
  Command,
  Controller,
  Guard,
  Interceptor,
  MeoCord,
  Service,
  UseGuard,
  UseInterceptor,
} from '@src/decorator/index.js'
import { CommandType, MetadataKey } from '@src/enum/index.js'
import { type CallHandler, type GuardInterface, type InterceptorInterface } from '@src/interface/index.js'
import { ExecutionContext } from '@src/common/index.js'
import { MeoCordApp } from '@src/core/meocord.app.js'
import { bindGlobalStages, appStages, prepareHandlerStages } from '@src/core/handler-pipeline.js'
import {
  createChatInputOptions,
  createMockInteraction,
  inspectHandler,
  MeoCordTestingModule,
} from '@src/testing/index.js'

const log: string[] = []

function logInterceptor(name: string) {
  @Interceptor()
  class LogInterceptor implements InterceptorInterface {
    async intercept(_context: ExecutionContext, next: CallHandler) {
      log.push(`${name}:before`)
      const result = await next.handle()
      log.push(`${name}:after`)
      return result
    }
  }
  Object.defineProperty(LogInterceptor, 'name', { value: name })
  return LogInterceptor
}

const GlobalInterceptor = logInterceptor('global')
const ClassInterceptor = logInterceptor('class')
const MethodInterceptor = logInterceptor('method')
const OuterMethodInterceptor = logInterceptor('outer method')
const ChildInterceptor = logInterceptor('child')

@Guard()
class LogGuard implements GuardInterface {
  canActivate() {
    log.push('guard')
    return true
  }
}

@Guard()
class DenyGuard implements GuardInterface {
  canActivate() {
    log.push('deny')
    return false
  }
}

@Interceptor()
class SkipInterceptor implements InterceptorInterface {
  intercept() {
    log.push('skip')
    return 'cached'
  }
}

@Interceptor()
class ReplaceErrorInterceptor implements InterceptorInterface {
  async intercept(_context: ExecutionContext, next: CallHandler) {
    try {
      return await next.handle()
    } catch (error) {
      throw new Error(`replaced: ${(error as Error).message}`)
    }
  }
}

@Service()
class Clock {
  now() {
    return 42
  }
}

let paramsInstances = 0

@Interceptor()
class ParamsInterceptor implements InterceptorInterface {
  constructor(private readonly clock: Clock) {
    paramsInstances++
  }

  intercept(context: ExecutionContext, next: CallHandler) {
    log.push(`params:${context.getHandlerName()}:${context.getParams()?.label}:${this.clock.now()}`)
    return next.handle()
  }
}

@Controller()
@UseInterceptor(ClassInterceptor)
class ProfileController {
  @Command('profile', CommandType.SLASH)
  @UseGuard(LogGuard)
  @UseInterceptor(OuterMethodInterceptor)
  @UseInterceptor(MethodInterceptor)
  async profile(_interaction: ChatInputCommandInteraction) {
    log.push('handler')
  }

  @Command('denied', CommandType.SLASH)
  @UseGuard(DenyGuard)
  async denied(_interaction: ChatInputCommandInteraction) {
    log.push('handler')
  }

  @Command('cached', CommandType.SLASH)
  @UseInterceptor(SkipInterceptor)
  async cached(_interaction: ChatInputCommandInteraction) {
    log.push('handler')
  }

  @Command('fails', CommandType.SLASH)
  @UseInterceptor(ReplaceErrorInterceptor)
  async fails(_interaction: ChatInputCommandInteraction) {
    throw new Error('handler failed')
  }

  @Command('params', CommandType.SLASH)
  @UseInterceptor({ provide: ParamsInterceptor, params: { label: 'a' } })
  async params(_interaction: ChatInputCommandInteraction) {
    log.push('handler')
  }

  @Autocomplete('profile', 'name')
  async complete(interaction: AutocompleteInteraction) {
    log.push('complete')
    await interaction.respond([])
  }
}

@Controller()
@UseInterceptor(ChildInterceptor)
class ChildProfileController extends ProfileController {}

@Controller()
@UseGuard(LogGuard)
@UseInterceptor(ChildInterceptor)
class GuardedChildProfileController extends ProfileController {}

@MeoCord({ controllers: [ProfileController], clientOptions: { intents: [] }, interceptors: [GlobalInterceptor] })
class App {}

const slash = (commandName = 'profile') => {
  const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName })
  interaction.options = createChatInputOptions({})
  return interaction
}

const compile = (controller: new (...args: any[]) => unknown = ProfileController) =>
  MeoCordTestingModule.create({ app: App, controllers: [controller] }).compile()

describe('interceptors', () => {
  beforeEach(() => {
    log.length = 0
  })

  it('run after the guards, around the handler: global, then class, then method', async () => {
    await compile().invoke(ProfileController, 'profile', slash())

    expect(log).toEqual([
      'guard',
      'global:before',
      'class:before',
      'outer method:before',
      'method:before',
      'handler',
      'method:after',
      'outer method:after',
      'class:after',
      'global:after',
    ])
  })

  it('do not run when a guard denies', async () => {
    const { ran } = await compile().invoke(ProfileController, 'denied', slash('denied'))

    expect(ran).toBe(false)
    expect(log).toEqual(['deny'])
  })

  it('can skip the handler by not calling next.handle()', async () => {
    const { ran } = await compile().invoke(ProfileController, 'cached', slash('cached'))

    expect(ran).toBe(false)
    expect(log).toEqual(['global:before', 'class:before', 'skip', 'class:after', 'global:after'])
  })

  it('can replace the error the handler throws', async () => {
    await expect(compile().invoke(ProfileController, 'fails', slash('fails'))).rejects.toThrow(
      'replaced: handler failed',
    )
  })

  it('read their params and the call through the context, from one shared instance', async () => {
    const module = compile()
    const before = paramsInstances

    await module.invoke(ProfileController, 'params', slash('params'))
    await module.invoke(ProfileController, 'params', slash('params'))

    expect(log.filter(entry => entry.startsWith('params'))).toEqual(['params:params:a:42', 'params:params:a:42'])
    expect(paramsInstances - before).toBe(1)
  })

  it('do not run on a direct method call', async () => {
    await compile().get(ProfileController).profile(slash())
    expect(log).toEqual(['guard', 'handler'])
  })

  it('do not run for autocomplete handlers', async () => {
    const interaction = createMockInteraction(AutocompleteInteraction, { commandName: 'profile' })
    interaction.options = createChatInputOptions({ focused: 'name', name: 'a' })

    await compile().invoke(ProfileController, 'complete', interaction)
    expect(log).toEqual(['complete'])
  })

  it('apply a subclass class interceptor to inherited handlers, subclass first', async () => {
    await compile(ChildProfileController).invoke(ChildProfileController, 'cached', slash('cached'))
    await compile(GuardedChildProfileController).invoke(GuardedChildProfileController, 'cached', slash('cached'))

    const run = ['global:before', 'child:before', 'class:before', 'skip', 'class:after', 'child:after', 'global:after']
    expect(log).toEqual([...run, 'guard', ...run])
  })

  it('honour overrideInterceptor stubs', async () => {
    const module = MeoCordTestingModule.create({ app: App, controllers: [ProfileController] })
      .overrideInterceptor(SkipInterceptor)
      .useValue({ intercept: (_context, next) => next.handle() })
      .compile()

    const { ran } = await module.invoke(ProfileController, 'cached', slash('cached'))
    expect(ran).toBe(true)
    expect(log).toContain('handler')
  })

  it('are reported by inspectHandler in the order they run', () => {
    expect(inspectHandler(ProfileController, 'profile', { app: App }).interceptors).toEqual([
      GlobalInterceptor,
      ClassInterceptor,
      OuterMethodInterceptor,
      MethodInterceptor,
    ])
    expect(inspectHandler(GuardedChildProfileController, 'params').interceptors).toEqual([
      ChildInterceptor,
      ClassInterceptor,
      { provide: ParamsInterceptor, params: { label: 'a' } },
    ])
  })

  it('run under dispatch', async () => {
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

    await listeners.get('interactionCreate')?.(slash('cached'))
    expect(log).toEqual(['global:before', 'class:before', 'skip', 'class:after', 'global:after'])
  })
})

interface Metrics {
  count(name: string): void
}

@Service()
class MetricsService implements Metrics {
  readonly counted: string[] = []

  count(name: string) {
    this.counted.push(name)
  }
}

@Interceptor()
class MetricsInterceptor implements InterceptorInterface {
  constructor(@inject(MetricsService) private readonly metrics: Metrics) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    this.metrics.count(context.getHandlerName() ?? '')
    return next.handle()
  }
}

@Controller()
class MeteredController {
  @Command('metered', CommandType.SLASH)
  @UseInterceptor(MetricsInterceptor)
  async metered(_interaction: ChatInputCommandInteraction) {}
}

describe('interceptor dependencies', () => {
  it('binds a dependency injected by token behind an interface type', async () => {
    const module = MeoCordTestingModule.create({ controllers: [MeteredController] }).compile()

    await module.invoke(MeteredController, 'metered', slash('metered'))

    expect(module.get(MetricsService).counted).toEqual(['metered'])
  })
})

describe('interceptors shared across calls', () => {
  @Interceptor()
  class InjectsContext implements InterceptorInterface {
    constructor(readonly context: ExecutionContext) {}

    intercept(_context: ExecutionContext, next: CallHandler) {
      return next.handle()
    }
  }

  // Undecorated: @Interceptor() rejects a class without intercept at compile time
  class NoIntercept {}

  @Controller()
  class UsesContextInterceptor {
    @Command('x', CommandType.SLASH)
    @UseInterceptor(InjectsContext)
    async x(_interaction: ChatInputCommandInteraction) {}
  }

  @Controller()
  class UsesBrokenInterceptor {
    @Command('y', CommandType.SLASH)
    @UseInterceptor(NoIntercept as never)
    async y(_interaction: ChatInputCommandInteraction) {}
  }

  it('cannot inject ExecutionContext, which fails when the module compiles', () => {
    expect(() => MeoCordTestingModule.create({ controllers: [UsesContextInterceptor] }).compile()).toThrow(
      'InjectsContext: resolved once and shared, so it cannot inject ExecutionContext',
    )
  })

  it('must have an intercept method', async () => {
    const module = MeoCordTestingModule.create({ controllers: [UsesBrokenInterceptor] }).compile()

    await expect(module.invoke(UsesBrokenInterceptor, 'y', slash('y'))).rejects.toThrow(
      'Interceptor NoIntercept applied to y does not have a valid intercept method.',
    )
  })
})
