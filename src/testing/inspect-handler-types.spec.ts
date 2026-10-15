import 'reflect-metadata'
import { vi } from 'vitest'
import { Logger } from '@src/common/logger.js'
import { forgetDeprecationWarnings } from '@src/common/deprecation.js'
import { Autocomplete, Command, Controller, Guard, Interceptor, MeoCord, MessageHandler, Observer, UseInterceptor } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { type CallHandler, type DispatchObserver, type GuardInterface, type InterceptorInterface } from '@src/interface/index.js'
import { type ExecutionContext } from '@src/common/execution-context.js'
import { inspectHandler } from '@src/testing/index.js'
import { forgetStrictMocks, useStrictMocks } from '@src/testing/strict-mocks.js'

let warned: string[]
beforeEach(() => {
  forgetStrictMocks()
  forgetDeprecationWarnings()
  warned = []
  vi.spyOn(Logger.prototype, 'warn').mockImplementation((text: unknown) => void warned.push(String(text)))
})
afterEach(() => vi.restoreAllMocks())
afterAll(() => forgetStrictMocks())

@Guard({ types: ['message'] })
class MessageOnly implements GuardInterface {
  canActivate() {
    return true
  }
}

@Guard()
class Everywhere implements GuardInterface {
  canActivate() {
    return true
  }
}

@Interceptor()
class Timing implements InterceptorInterface {
  intercept(_context: ExecutionContext, next: CallHandler) {
    return next.handle()
  }
}

@Observer({ types: ['message'] })
class MessageAudit implements DispatchObserver {
  onSettled() {}
}

@Observer()
class Audit implements DispatchObserver {
  onSettled() {}
}

@Controller()
class Moderation {
  @Command('ban', CommandType.SLASH)
  ban() {}

  @MessageHandler('warn')
  warn() {}

  @Autocomplete('ban', 'reason')
  @UseInterceptor(Timing)
  reasons() {}

  helper() {}
}

@MeoCord({ controllers: [Moderation], guards: [MessageOnly, Everywhere], observers: [MessageAudit, Audit], clientOptions: { intents: [] } })
class App {}

const W_EVERY_TYPE = /^inspectHandler\(\) here lists the guards, interceptors and observers of every context type for Moderation\.ban, where dispatch runs only those of its own; under useStrictMocks\(\)/

describe('inspectHandler() under useStrictMocks()', () => {
  beforeEach(() => useStrictMocks())

  it("lists the guards and observers dispatch runs for the handler's context type", () => {
    const slash = inspectHandler(Moderation, 'ban', { app: App })
    const message = inspectHandler(Moderation, 'warn', { app: App })

    expect([slash.guards, slash.observers]).toEqual([[Everywhere], [Audit]])
    expect([message.guards, message.observers]).toEqual([
      [MessageOnly, Everywhere],
      [MessageAudit, Audit],
    ])
    expect(warned).toEqual([])
  })

  it('lists no interceptors for an autocomplete, which runs none', () => {
    expect(inspectHandler(Moderation, 'reasons', { app: App }).interceptors).toEqual([])
  })

  it('lists every stage for a method no route reaches', () => {
    expect(inspectHandler(Moderation, 'helper', { app: App }).guards).toEqual([MessageOnly, Everywhere])
  })
})

describe('inspectHandler() in default mode', () => {
  it('lists every stage, as before, and warns once where dispatch runs fewer', () => {
    const slash = inspectHandler(Moderation, 'ban', { app: App })

    expect([slash.guards, slash.observers]).toEqual([
      [MessageOnly, Everywhere],
      [MessageAudit, Audit],
    ])
    expect(warned).toEqual([expect.stringMatching(W_EVERY_TYPE)])
  })

  it('warns of nothing where it lists what dispatch runs', () => {
    inspectHandler(Moderation, 'warn', { app: App })

    expect(warned).toEqual([])
  })
})
