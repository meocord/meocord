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

  it("apply a subclass class interceptor to inherited handlers, inside the base class's", async () => {
    await compile(ChildProfileController).invoke(ChildProfileController, 'cached', slash('cached'))
    await compile(GuardedChildProfileController).invoke(GuardedChildProfileController, 'cached', slash('cached'))

    const run = ['global:before', 'class:before', 'child:before', 'skip', 'child:after', 'class:after', 'global:after']
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
      ClassInterceptor,
      ChildInterceptor,
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

const slow = () => new Promise(resolve => setTimeout(resolve, 20))

// Each starts the rest of the call with next.handle() and returns before it ends
@Interceptor()
class DropsHandle implements InterceptorInterface {
  intercept(_context: ExecutionContext, next: CallHandler) {
    void next.handle()
  }
}

@Interceptor()
class ChainsHandle implements InterceptorInterface {
  intercept(_context: ExecutionContext, next: CallHandler) {
    void next.handle().then(() => log.push('then'))
  }
}

@Interceptor()
class FinallyHandle implements InterceptorInterface {
  intercept(_context: ExecutionContext, next: CallHandler) {
    void next.handle().finally(() => log.push('finally'))
  }
}

@Interceptor()
class CatchesHandle implements InterceptorInterface {
  intercept(_context: ExecutionContext, next: CallHandler) {
    void next.handle().catch((error: Error) => log.push(`caught ${error.message}`))
  }
}

@Interceptor()
class SwallowsHandle implements InterceptorInterface {
  async intercept(_context: ExecutionContext, next: CallHandler) {
    try {
      await next.handle()
    } catch (error) {
      log.push(`swallowed ${(error as Error).message}`)
    }
  }
}

// Answers after 20 ms if the handler has not, leaving the handler to finish on its own
@Interceptor()
class TimesOut implements InterceptorInterface {
  intercept(_context: ExecutionContext, next: CallHandler) {
    return Promise.race([next.handle(), new Promise(resolve => setTimeout(() => resolve('timed out'), 20))])
  }
}

@Interceptor()
class CatchesCallback implements InterceptorInterface {
  async intercept(_context: ExecutionContext, next: CallHandler) {
    await next
      .handle()
      .then(() => {
        throw new Error('callback failed')
      })
      .catch((error: Error) => log.push(`caught ${error.message}`))
  }
}

@Controller()
class UnawaitedController {
  @Command('slowTimesOut', CommandType.SLASH)
  @UseInterceptor(TimesOut)
  async slowTimesOut() {
    await new Promise(resolve => setTimeout(resolve, 300))
  }

  @Command('hangTimesOut', CommandType.SLASH)
  @UseInterceptor(TimesOut)
  async hangTimesOut() {
    await new Promise(() => {})
  }

  @Command('catchesCallback', CommandType.SLASH)
  @UseInterceptor(CatchesCallback)
  async catchesCallback() {}

  @Command('drops', CommandType.SLASH)
  @UseInterceptor(DropsHandle)
  async drops() {
    await slow()
    throw new Error('database down')
  }

  @Command('dropsOk', CommandType.SLASH)
  @UseInterceptor(DropsHandle)
  async dropsOk() {
    await slow()
    log.push('handler done')
  }

  @Command('chains', CommandType.SLASH)
  @UseInterceptor(ChainsHandle)
  async chains() {
    await slow()
    throw new Error('database down')
  }

  @Command('finally', CommandType.SLASH)
  @UseInterceptor(FinallyHandle)
  async finally() {
    await slow()
    throw new Error('database down')
  }

  @Command('catches', CommandType.SLASH)
  @UseInterceptor(CatchesHandle)
  async catches() {
    await slow()
    throw new Error('database down')
  }

  @Command('swallows', CommandType.SLASH)
  @UseInterceptor(SwallowsHandle)
  async swallows() {
    await slow()
    throw new Error('database down')
  }
}

describe('an interceptor that returns before the call it started ends', () => {
  const module = () => MeoCordTestingModule.create({ controllers: [UnawaitedController] }).compile()
  beforeEach(() => {
    log.length = 0
  })

  it('leaves the call to end when the handler does', async () => {
    const { ran } = await module().invoke(UnawaitedController, 'dropsOk', slash('dropsOk'))

    expect(ran).toBe(true)
    expect(log).toEqual(['handler done'])
  })

  it.each(['drops', 'chains', 'finally'] as const)(
    'fails the call with what the handler throws when %s leaves it uncaught',
    async name => {
      await expect(module().invoke(UnawaitedController, name, slash(name))).rejects.toThrow('database down')
      expect(log).toEqual({ drops: [], chains: [], finally: ['finally'] }[name])
    },
  )

  it('leaves an error it catches, awaited or not, to it', async () => {
    const results = [
      await module().invoke(UnawaitedController, 'catches', slash('catches')),
      await module().invoke(UnawaitedController, 'swallows', slash('swallows')),
    ]

    expect(results.map(({ ran }) => ran)).toEqual([true, true])
    expect(log).toEqual(['caught database down', 'swallowed database down'])
  })

  it.each(['slowTimesOut', 'hangTimesOut'] as const)('leaves a call to end with the interceptor when it took the run on: %s', async name => {
    const startedAt = performance.now()

    const { ran } = await module().invoke(UnawaitedController, name, slash(name))

    expect(ran).toBe(true)
    expect(performance.now() - startedAt).toBeLessThan(200)
  })

  it('leaves an error a callback in its chain throws to the chain that catches it', async () => {
    const unhandled: unknown[] = []
    const collect = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', collect)
    try {
      await module().invoke(UnawaitedController, 'catchesCallback', slash('catchesCallback'))
      await new Promise(resolve => setTimeout(resolve, 20))
    } finally {
      process.off('unhandledRejection', collect)
    }

    expect(log).toEqual(['caught callback failed'])
    expect(unhandled).toEqual([])
  })

  it('reaches the fallback with an error it leaves uncaught at runtime, which answers the user', async () => {
    const container = new Container()
    container.bind(UnawaitedController).toSelf().inSingletonScope()
    Reflect.defineMetadata(MetadataKey.Container, container, UnawaitedController)
    prepareHandlerStages(container, [UnawaitedController])
    const listeners = new Map<string, (...args: unknown[]) => Promise<void>>()
    const client = {
      on: vi.fn((event: string, handler: (...args: unknown[]) => Promise<void>) => listeners.set(event, handler)),
      login: vi.fn().mockResolvedValue('token'),
      user: { setActivity: vi.fn() },
      application: null,
    }
    await new MeoCordApp([UnawaitedController], container, client as never, 'token').start()
    const interaction = slash('drops')

    await listeners.get('interactionCreate')?.(interaction)

    expect(interaction.reply).toHaveBeenCalledOnce()
  })
})
