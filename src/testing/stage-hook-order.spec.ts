import { vi } from 'vitest'
import { inject } from 'inversify'
import { Logger } from '@src/common/index.js'
import { forgetDeprecationWarnings } from '@src/common/deprecation.js'
import { Command, Controller, Guard, MeoCord, Observer, Pipe, Service, UseGuard, UsePipe } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { ChatInputCommandInteraction } from 'discord.js'
import { createMockInteraction, MeoCordTestingModule } from '@src/testing/index.js'
import { forgetStrictMocks, useStrictMocks } from '@src/testing/strict-mocks.js'

// A class only a stage or the presenter injects gets its hooks after the controllers and observers in the bot; strict
// mocks run them in that order here, and without them the order stays as it was, with one warning.

let order: string[]
let warned: string[]

beforeEach(() => {
  forgetStrictMocks()
  forgetDeprecationWarnings()
  order = []
  warned = []
  vi.spyOn(Logger.prototype, 'warn').mockImplementation((text: unknown) => void warned.push(String(text)))
})
afterEach(() => {
  forgetStrictMocks()
  vi.restoreAllMocks()
})

/** Removes `cls`'s hooks, for a case where it has none. */
function withoutHooks<T extends new (...args: any[]) => object>(cls: T, hooks: boolean): T {
  if (!hooks) for (const hook of ['onReady', 'onShutdown']) delete (cls.prototype as Record<string, unknown>)[hook]
  return cls
}

type Role = 'a global guard' | 'a method guard' | 'a pipe' | 'the presenter'

/** An app whose `role` injects a `Dep`, beside a controller and an observer, each with hooks unless told otherwise. */
function appWith(role: Role, { dep = true, others = true }: { dep?: boolean; others?: boolean } = {}) {
  @Service()
  class Dep {
    onReady() {
      order.push('ready Dep')
    }
    onShutdown() {
      order.push('shutdown Dep')
    }
  }
  withoutHooks(Dep, dep)
  @Guard()
  class DepGuard {
    constructor(@inject(Dep) readonly dep: Dep) {}
    canActivate() {
      return true
    }
  }
  @Pipe()
  class DepPipe {
    constructor(@inject(Dep) readonly dep: Dep) {}
    transform(value: unknown) {
      return value
    }
  }
  @Service()
  class DepPresenter {
    constructor(@inject(Dep) readonly dep: Dep) {}
    loading() {
      return { text: '…' }
    }
    error() {
      return { text: 'failed' }
    }
  }
  @Controller()
  class Ping {
    onReady() {
      order.push('ready Ping')
    }
    onShutdown() {
      order.push('shutdown Ping')
    }
    @Command('ping/{id}', CommandType.BUTTON)
    ping() {}
  }
  withoutHooks(Ping, others)
  const descriptor = Object.getOwnPropertyDescriptor(Ping.prototype, 'ping')!
  if (role === 'a method guard') UseGuard(DepGuard)(Ping.prototype, 'ping', descriptor)
  if (role === 'a pipe') UsePipe('id', DepPipe)(Ping.prototype, 'ping', descriptor)
  @Observer()
  class Audit {
    onReady() {
      order.push('ready Audit')
    }
    onShutdown() {
      order.push('shutdown Audit')
    }
    onSettled() {}
  }
  withoutHooks(Audit, others)

  @MeoCord({
    controllers: [Ping],
    observers: [Audit],
    clientOptions: { intents: [] },
    ...(role === 'a global guard' && { guards: [DepGuard] }),
    ...(role === 'the presenter' && { presenter: DepPresenter }),
  })
  class App {}
  return App
}

/** Readies and closes a module of `app`, as a test does around its calls. */
async function readyAndClose(app: new (...args: any[]) => unknown) {
  const module = await MeoCordTestingModule.fromApp(app).compile().init({ ready: true })
  await module.close()
}

const ROLES: Role[] = ['a global guard', 'a method guard', 'a pipe', 'the presenter']
const differs = () => warned.filter(text => text.includes("hooks run in another order here than in the bot"))

describe.each(ROLES)("the hooks of %s's dependency", role => {
  it('run after the controllers and observers under strict mocks, and shut down before them, as in the bot', async () => {
    useStrictMocks()
    await readyAndClose(appWith(role))

    expect(order).toEqual(['ready Ping', 'ready Audit', 'ready Dep', 'shutdown Dep', 'shutdown Audit', 'shutdown Ping'])
    expect(differs()).toEqual([])
  })

  it('keep their order without strict mocks, and warn once that the bot runs them later', async () => {
    await readyAndClose(appWith(role))
    await readyAndClose(appWith(role))

    expect(order.slice(0, 6)).toEqual(['ready Dep', 'ready Ping', 'ready Audit', 'shutdown Audit', 'shutdown Ping', 'shutdown Dep'])
    expect(differs()).toEqual([
      "Dep's lifecycle hooks run in another order here than in the bot, which runs those of a class only a stage or " +
        "the presenter injects after the controllers' and observers'. useStrictMocks() runs them in the bot's order here; " +
        'in the next major version (5.0) the testing module does without the call (https://github.com/meocord/meocord/issues/441).',
    ])
  })
})

describe('a stage dependency a listed service also injects', () => {
  it.each([true, false])('keeps its place beside the service, strict mocks %s', async strict => {
    @Service()
    class Shared {
      onReady() {
        order.push('ready Shared')
      }
      onShutdown() {
        order.push('shutdown Shared')
      }
    }
    @Service()
    class Listed {
      constructor(@inject(Shared) readonly shared: Shared) {}
    }
    @Guard()
    class SharedGuard {
      constructor(@inject(Shared) readonly shared: Shared) {}
      canActivate() {
        return true
      }
    }
    @Controller()
    class Ping {
      onReady() {
        order.push('ready Ping')
      }
      onShutdown() {
        order.push('shutdown Ping')
      }
      @Command('ping', CommandType.SLASH)
      ping() {}
    }
    @MeoCord({ controllers: [Ping], services: [Listed], guards: [SharedGuard], clientOptions: { intents: [] } })
    class App {}
    if (strict) useStrictMocks()

    await readyAndClose(App)

    expect(order).toEqual(['ready Shared', 'ready Ping', 'shutdown Ping', 'shutdown Shared'])
    expect(differs()).toEqual([])
  })
})

describe('without strict mocks, the order warning at close()', () => {
  it('reads a hook the dependency carries as a property, once it is made', async () => {
    @Service()
    class Dep {
      onShutdown = () => void order.push('shutdown Dep')
    }
    @Guard()
    class DepGuard {
      constructor(@inject(Dep) readonly dep: Dep) {}
      canActivate() {
        return true
      }
    }
    @Controller()
    class Ping {
      onShutdown() {
        order.push('shutdown Ping')
      }
      @Command('ping', CommandType.SLASH)
      ping() {}
    }
    @MeoCord({ controllers: [Ping], guards: [DepGuard], clientOptions: { intents: [] } })
    class App {}
    const module = await MeoCordTestingModule.fromApp(App).compile().init()
    await module.dispatch(createMockInteraction(ChatInputCommandInteraction, { commandName: 'ping' }))

    await module.close()

    expect(order).toEqual(['shutdown Ping', 'shutdown Dep'])
    expect(differs()).toEqual([expect.stringMatching(/^Dep's lifecycle hooks run in another order/)])
  })
})

describe('without strict mocks, no order warning', () => {
  it('when the dependency has no hooks', async () => {
    await readyAndClose(appWith('a global guard', { dep: false }))

    expect(order).toEqual(['ready Ping', 'ready Audit', 'shutdown Audit', 'shutdown Ping'])
    expect(differs()).toEqual([])
  })

  it('when the hooks that run are in the same order in both', async () => {
    await readyAndClose(appWith('a global guard', { others: false }))

    expect(order).toEqual(['ready Dep', 'shutdown Dep'])
    expect(differs()).toEqual([])
  })

  it('when no hook runs', async () => {
    const module = await MeoCordTestingModule.fromApp(appWith('a global guard')).compile().init()
    await module.close()

    expect(order).toEqual([])
    expect(differs()).toEqual([])
  })
})
