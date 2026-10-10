import { ChatInputCommandInteraction } from 'discord.js'
import { Catch, Command, Controller, Guard, Interceptor, MeoCord, UseFilter, UseGuard, UseInterceptor } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { type CallHandler, type ExceptionFilter, type GuardInterface, type InterceptorInterface } from '@src/interface/index.js'
import { Logger } from '@src/common/logger.js'
import { forgetDeprecationWarnings } from '@src/common/deprecation.js'
import { forgetStrictMocks, useStrictMocks } from './strict-mocks.js'
import { createMockInteraction, MeoCordTestingModule } from './index.js'

const ran: string[] = []

@Guard()
class Gate implements GuardInterface {
  canActivate() {
    ran.push('real gate')
    return false
  }
}

@Interceptor()
class Timing implements InterceptorInterface {
  intercept(_context: unknown, next: CallHandler) {
    ran.push('real timing')
    return next.handle()
  }
}

@Catch(Error)
class Report implements ExceptionFilter {
  catch() {
    ran.push('real report')
  }
}

@Controller()
class Ping {
  @Command('ping', CommandType.SLASH)
  @UseGuard(Gate)
  @UseInterceptor(Timing)
  @UseFilter(Report)
  async ping() {
    ran.push('ping')
    throw new Error('boom')
  }
}

const ping = () => createMockInteraction(ChatInputCommandInteraction, { commandName: 'ping' })
const stubs = {
  guard: { canActivate: () => (ran.push('gate stub'), true) },
  interceptor: { intercept: (_context: unknown, next: CallHandler) => (ran.push('timing stub'), next.handle()) },
  filter: { catch: () => void ran.push('report stub') },
}

let warned: string[]
beforeEach(() => {
  forgetStrictMocks()
  forgetDeprecationWarnings()
  ran.length = 0
  warned = []
  vi.spyOn(Logger.prototype, 'warn').mockImplementation((text: unknown) => void warned.push(String(text)))
})
afterEach(() => vi.restoreAllMocks())
afterAll(() => forgetStrictMocks())

describe('a stage that is also a provider', () => {
  @MeoCord({
    controllers: [Ping],
    providers: [{ provide: Gate, useClass: Gate }, { provide: Timing, useClass: Timing }, { provide: Report, useValue: new Report() }],
    clientOptions: { intents: [] },
  })
  class App {}

  it.each([
    ['given the app, which lists each stage in its providers', () => MeoCordTestingModule.fromApp(App)],
    ['listed in the module’s own providers', () => MeoCordTestingModule.create({ controllers: [Ping], providers: [{ provide: Gate, useValue: new Gate() }, { provide: Timing, useClass: Timing }, { provide: Report, useValue: new Report() }] })],
    [
      'replaced by overrideProvider as well',
      () =>
        MeoCordTestingModule.create({ controllers: [Ping] })
          .overrideProvider(Gate)
          .useValue({ canActivate: () => (ran.push('provider double'), false) })
          .overrideProvider(Report)
          .useValue({ catch: () => void ran.push('provider double') }),
    ],
  ])('is replaced by its override wherever it applies, %s', async (_, builder) => {
    const module = builder()
      .overrideGuard(Gate)
      .useValue(stubs.guard)
      .overrideInterceptor(Timing)
      .useValue(stubs.interceptor)
      .overrideFilter(Report)
      .useValue(stubs.filter)
      .compile()

    const { ran: handled } = await module.dispatch(ping())

    expect(handled).toBe(true)
    expect(ran).toEqual(['gate stub', 'timing stub', 'ping', 'report stub'])
  })
})

describe('a stage stub’s lifecycle hooks', () => {
  const hooked = () => ({ canActivate: () => true, onReady: vi.fn(), onShutdown: vi.fn() })
  const lifecycle = async (module: ReturnType<ReturnType<typeof MeoCordTestingModule.create>['compile']>) => {
    await module.init({ ready: true })
    await module.dispatch(ping())
    await module.close()
  }

  it('run where a provider of the stage would run them, as the bot runs a provider’s', async () => {
    const stub = hooked()
    const module = MeoCordTestingModule.create({ controllers: [Ping], providers: [{ provide: Gate, useClass: Gate }] }).overrideGuard(Gate).useValue(stub).compile()

    await lifecycle(module)

    expect([stub.onReady.mock.calls.length, stub.onShutdown.mock.calls.length]).toEqual([1, 1])
  })

  it('stay unrun for a stage only applied with @UseGuard, which the bot makes no lifecycle unit of', async () => {
    const stub = hooked()
    const module = MeoCordTestingModule.create({ controllers: [Ping] }).overrideGuard(Gate).useValue(stub).compile()

    await lifecycle(module)

    expect([stub.onReady.mock.calls.length, stub.onShutdown.mock.calls.length]).toEqual([0, 0])
  })
})

describe('a stub without its stage’s method', () => {
  const NO_METHOD = ['overrideGuard(Gate).useValue(…) has no canActivate method.', 'overrideInterceptor(Timing).useValue(…) has no intercept method.', 'overrideFilter(Report).useValue(…) has no catch method.']
  const empty = () =>
    MeoCordTestingModule.create({ controllers: [Ping] }).overrideGuard(Gate).useValue({}).overrideInterceptor(Timing).useValue({}).overrideFilter(Report).useValue({})

  it('is refused at compile() under useStrictMocks(), naming the stage and the method', () => {
    useStrictMocks()

    expect(() => empty().compile()).toThrow(NO_METHOD[0])
  })

  it('warns once each by default, however many modules compile it, and builds the module', () => {
    expect(() => [empty().compile(), empty().compile()]).not.toThrow()

    expect(warned).toEqual(NO_METHOD.map(text => expect.stringContaining(text)))
  })

  it('takes a method on the stub’s prototype, as useValue(new Stub()) gives one', () => {
    useStrictMocks()
    class AllowAll {
      canActivate() {
        return true
      }
    }

    expect(() => MeoCordTestingModule.create({ controllers: [Ping] }).overrideGuard(Gate).useValue(new AllowAll()).compile()).not.toThrow()
  })
})
