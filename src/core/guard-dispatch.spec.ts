import { inject } from 'inversify'
import { ButtonInteraction, ChatInputCommandInteraction, type Message } from 'discord.js'
import { Command, Controller, Guard, Interceptor, MeoCord, On, Service, UseGuard, UseInterceptor } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { type CallHandler, type GuardInterface, type InterceptorInterface } from '@src/interface/index.js'
import { ExecutionContext } from '@src/common/index.js'
import { createMockInteraction, createMockMessage, MeoCordTestingModule } from '@src/testing/index.js'

// How dispatch lets a guarded handler through its own guard wrappers once, and no further.

const log: string[] = []
beforeEach(() => (log.length = 0))

function logGuard(name: string, allow: () => boolean = () => true) {
  @Guard()
  class LogGuard implements GuardInterface {
    canActivate() {
      log.push(name)
      return allow()
    }
  }
  return LogGuard
}

describe('a dispatched call', () => {
  it('passes each of stacked wrappers once, then a nested direct call runs every guard again', async () => {
    let depth = 0
    const Outer = logGuard('outer', () => depth === 0)
    const Inner = logGuard('inner')

    @Controller()
    class StackedController {
      @Command('stacked', CommandType.SLASH)
      @UseGuard(Outer)
      @UseGuard(Inner)
      async stacked(interaction: ChatInputCommandInteraction) {
        depth++
        log.push(`ran ${depth}`)
        if (depth === 1) await this.stacked(interaction)
      }
    }

    const module = MeoCordTestingModule.create({ controllers: [StackedController] }).compile()
    await module.invoke(StackedController, 'stacked', createMockInteraction(ChatInputCommandInteraction))

    // Dispatch runs both guards once; the nested call with the same interaction runs them again and is denied.
    expect(log).toEqual(['outer', 'inner', 'ran 1', 'outer'])
  })

  it('leaves no pass behind for a direct call made after it with the same interaction', async () => {
    let calls = 0
    const FirstOnly = logGuard('guard', () => ++calls === 1)

    @Controller()
    class OnceController {
      @Command('once', CommandType.SLASH)
      @UseGuard(FirstOnly)
      async once(_interaction: ChatInputCommandInteraction) {
        log.push('ran')
      }
    }

    const module = MeoCordTestingModule.create({ controllers: [OnceController] }).compile()
    const interaction = createMockInteraction(ChatInputCommandInteraction)
    await module.invoke(OnceController, 'once', interaction)
    await module.get(OnceController).once(interaction)

    expect(log).toEqual(['guard', 'ran', 'guard'])
  })

  it('guards an event handler whose first argument is not an object', async () => {
    const Debug = logGuard('debug guard')

    @Controller()
    @UseGuard(Debug)
    class DebugController {
      @On('debug')
      async onDebug(info: string) {
        log.push(`debug: ${info}`)
      }
    }

    const module = MeoCordTestingModule.create({ controllers: [DebugController] }).compile()
    const { ran } = await module.emit('debug', 'heartbeat')

    expect(ran).toBe(1)
    expect(log).toEqual(['debug guard', 'debug: heartbeat'])
  })
})

describe('context types', () => {
  it('skip a guard written for messages on an event whose first argument is a message', async () => {
    const MessagesOnly = logGuard('messages only')
    Reflect.decorate([Guard({ types: ['message'] })], MessagesOnly)

    @Controller()
    class Events {
      @On('messageCreate')
      async created(_message: Message) {
        log.push('event ran')
      }
    }
    @MeoCord({ controllers: [Events], clientOptions: { intents: [] }, guards: [MessagesOnly] })
    class App {}

    const module = MeoCordTestingModule.create({ app: App, controllers: [Events] }).compile()
    await module.emit('messageCreate', createMockMessage())

    expect(log).toEqual(['event ran'])
  })
})

describe('a guard', () => {
  it('without canActivate stops the call with an error naming it and the handler', async () => {
    @Guard()
    class Broken {}

    @Controller()
    class BrokenController {
      @Command('broken', CommandType.SLASH)
      @UseGuard(Broken as never)
      async broken(_interaction: ChatInputCommandInteraction) {}
    }

    const module = MeoCordTestingModule.create({ controllers: [BrokenController] }).compile()
    await expect(module.invoke(BrokenController, 'broken', createMockInteraction(ChatInputCommandInteraction))).rejects.toThrow(
      'Guard Broken applied to broken does not have a valid canActivate method.',
    )
  })

  it('that injects ExecutionContext receives the same service instances as the rest of the app', async () => {
    @Service()
    class Owners {
      has(id: string) {
        return id === 'owner'
      }
    }

    @Guard()
    class OwnerGuard implements GuardInterface {
      constructor(
        private readonly context: ExecutionContext,
        private readonly owners: Owners,
      ) {}
      canActivate() {
        log.push(`${this.context.getHandlerName()} ${this.owners === shared}`)
        return true
      }
    }

    @Controller()
    class OwnerController {
      constructor(readonly owners: Owners) {}

      @Command('owned', CommandType.BUTTON)
      @UseGuard(OwnerGuard)
      async owned(_interaction: ButtonInteraction) {}
    }

    const module = MeoCordTestingModule.create({ controllers: [OwnerController], providers: [{ provide: Owners, useClass: Owners }] }).compile()
    const shared = module.get(Owners)
    await module.invoke(OwnerController, 'owned', createMockInteraction(ButtonInteraction, { customId: 'owned' }))

    expect(log).toEqual(['owned true'])
  })
})

describe('a guard that injects only a service', () => {
  it('receives the app\'s instance of it', async () => {
    @Service()
    class Owners {}

    @Guard()
    class OwnersGuard implements GuardInterface {
      constructor(private readonly owners: Owners) {}
      canActivate() {
        log.push(`same instance: ${this.owners === shared}`)
        return true
      }
    }

    @Controller()
    class Guarded {
      @Command('guarded', CommandType.SLASH)
      @UseGuard(OwnersGuard)
      async guarded(_interaction: ChatInputCommandInteraction) {}
    }

    const module = MeoCordTestingModule.create({ controllers: [Guarded], providers: [{ provide: Owners, useClass: Owners }] }).compile()
    const shared = module.get(Owners)
    await module.invoke(Guarded, 'guarded', createMockInteraction(ChatInputCommandInteraction))

    expect(log).toEqual(['same instance: true'])
  })
})

describe('a shared stage', () => {
  it('without a name is called "A class" when refused for asking for ExecutionContext', () => {
    class Anonymous {
      constructor(@inject(ExecutionContext) readonly context: object) {}
      intercept(_context: ExecutionContext, next: CallHandler) {
        return next.handle()
      }
    }
    Interceptor()(Anonymous)
    Object.defineProperty(Anonymous, 'name', { value: '' })

    @Controller()
    class AnonymousStage {
      @Command('anonymous', CommandType.SLASH)
      @UseInterceptor(Anonymous)
      async anonymous(_interaction: ChatInputCommandInteraction) {}
    }

    expect(() => MeoCordTestingModule.create({ controllers: [AnonymousStage] }).compile()).toThrow(
      'A class: resolved once and shared, so it cannot inject ExecutionContext',
    )
  })

  it('that injects ExecutionContext through @inject is refused at startup', () => {
    @Interceptor()
    class Sneaky implements InterceptorInterface {
      // Typed as an interface-like shape, so only the @inject token names ExecutionContext
      constructor(@inject(ExecutionContext) readonly context: object) {}
      intercept(_context: ExecutionContext, next: CallHandler) {
        return next.handle()
      }
    }

    @Controller()
    class SneakyController {
      @Command('sneaky', CommandType.SLASH)
      @UseInterceptor(Sneaky)
      async sneaky(_interaction: ChatInputCommandInteraction) {}
    }

    expect(() => MeoCordTestingModule.create({ controllers: [SneakyController] }).compile()).toThrow(
      "Sneaky: resolved once and shared, so it cannot inject ExecutionContext: it would keep the first call's context for every later call.",
    )
  })
})
