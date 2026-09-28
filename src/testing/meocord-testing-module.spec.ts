import 'reflect-metadata'
import { vi } from 'vitest'
import { MeoCordTestingModule } from './meocord-testing-module.js'
import { createToken } from '@src/common/token.js'
import { Inject } from '@src/decorator/inject.decorator.js'
import { Service } from '@src/decorator/service.decorator.js'
import { Command } from '@src/decorator/controller.decorator.js'
import { Controller } from '@src/decorator/controller-class.decorator.js'
import { CommandType } from '@src/enum/index.js'
import { ButtonInteraction } from 'discord.js'
import { createMockInteraction } from './mock-interaction.js'

// A double covers only the methods under test, and a class with a private member cannot be an
// object literal. Types are checked in meocord-testing-module.test-d.ts; `providers` only at runtime.
describe('providers', () => {
  class NotificationService {
    private readonly prefix = '[bot] '

    async notify(message: string): Promise<string> {
      return this.prefix + message
    }

    async broadcast(message: string): Promise<string> {
      return this.prefix + message
    }
  }

  it('accepts a double covering only the methods under test, without a cast', () => {
    const notify = vi.fn()

    const module = MeoCordTestingModule.create({
      providers: [{ provide: NotificationService, useValue: { notify } }],
    }).compile()

    expect(module.get(NotificationService).notify).toBe(notify)
  })

  it('accepts the same shape through overrideProvider', () => {
    const notify = vi.fn()

    const module = MeoCordTestingModule.create({
      providers: [{ provide: NotificationService, useValue: new NotificationService() }],
    })
      .overrideProvider(NotificationService)
      .useValue({ notify })
      .compile()

    expect(module.get(NotificationService).notify).toBe(notify)
  })
})

describe('provided tokens', () => {
  it('injects values, classes and factories by a string, a symbol or a typed token', () => {
    const LIMITS = createToken<{ max: number }>('Limits')

    @Service()
    class Settings {
      constructor(
        @Inject('appName') readonly appName: string,
        @Inject(LIMITS) readonly limits: { max: number },
      ) {}
    }

    const module = MeoCordTestingModule.create({
      providers: [
        { provide: 'appName', useValue: 'Meo' },
        { provide: LIMITS, useFactory: (appName: string) => ({ max: appName.length }), inject: ['appName'] },
        { provide: Settings, useClass: Settings },
      ],
    }).compile()

    expect(module.get(Settings)).toMatchObject({ appName: 'Meo', limits: { max: 3 } })
    expect(module.get(LIMITS).max).toBe(3)
  })

  it('binds a provided class once, whichever provider in the list injects it first', () => {
    @Service()
    class Greeting {
      text() {
        return 'Hello'
      }
    }
    @Service()
    class Status {
      constructor(readonly greeting: Greeting) {}
    }
    @Controller()
    class StatusController {
      constructor(readonly status: Status) {}
    }

    for (const providers of [
      [
        { provide: Status, useClass: Status },
        { provide: Greeting, useClass: Greeting },
      ],
      [
        { provide: Greeting, useClass: Greeting },
        { provide: Status, useClass: Status },
      ],
    ]) {
      const module = MeoCordTestingModule.create({ controllers: [StatusController], providers }).compile()
      expect(module.get(Status).greeting.text()).toBe('Hello')
      expect(module.get(StatusController).status).toBe(module.get(Status))
    }

    // Only the injecting class listed: the class it injects is still bound as itself
    const alone = MeoCordTestingModule.create({ providers: [{ provide: Status, useClass: Status }] }).compile()
    expect(alone.get(Status).greeting.text()).toBe('Hello')
  })

  it('binds a provided class once when a factory listed before it injects it', () => {
    @Service()
    class Greeting {
      text() {
        return 'Hello'
      }
    }
    const MESSAGE = createToken<string>('Message')

    const module = MeoCordTestingModule.create({
      providers: [
        { provide: MESSAGE, useFactory: (greeting: Greeting) => `${greeting.text()}!`, inject: [Greeting] },
        { provide: Greeting, useClass: Greeting },
      ],
    }).compile()

    expect(module.get(MESSAGE)).toBe('Hello!')
  })

  it('awaits a factory that returns a promise in init(), and says so when get() comes first', async () => {
    @Service()
    class NotesStore {
      constructor(@Inject('database') readonly database: { ready: boolean }) {}
    }

    const module = MeoCordTestingModule.create({
      providers: [
        { provide: 'database', useFactory: async () => ({ ready: true }) },
        { provide: NotesStore, useClass: NotesStore },
      ],
    }).compile()

    expect(() => module.get(NotesStore)).toThrow(
      'NotesStore depends on a factory that returns a promise: await module.init() before get().',
    )
    expect((await module.init()).get(NotesStore).database).toEqual({ ready: true })
  })

  it('overrides a provider under a string token', () => {
    @Service()
    class NotesStore {
      constructor(@Inject('database') readonly database: unknown) {}
    }

    const module = MeoCordTestingModule.create({
      providers: [
        { provide: 'database', useFactory: () => ({ real: true }) },
        { provide: NotesStore, useClass: NotesStore },
      ],
    })
      .overrideProvider('database')
      .useValue({ real: false })
      .compile()

    expect(module.get(NotesStore).database).toEqual({ real: false })
  })

  it('names a class that injects a token the module does not provide', () => {
    @Service()
    class NotesStore {
      constructor(@Inject('database') readonly database: unknown) {}
    }

    expect(() => MeoCordTestingModule.create({ providers: [{ provide: NotesStore, useClass: NotesStore }] }).compile()).toThrow(
      "NotesStore: it injects 'database', which nothing provides: add a provider for it to the testing module's providers.",
    )
  })
})

describe('invoke with an asynchronous factory', () => {
  it('resolves the factory first, with no init() needed', async () => {
    @Controller()
    class PingController {
      constructor(@Inject('greeting') readonly greeting: string) {}

      @Command('ping', CommandType.BUTTON)
      async ping(interaction: ButtonInteraction) {
        await interaction.reply({ content: this.greeting })
      }
    }

    const module = MeoCordTestingModule.create({
      controllers: [PingController],
      providers: [{ provide: 'greeting', useFactory: async () => 'pong' }],
    }).compile()
    const interaction = createMockInteraction(ButtonInteraction, { customId: 'ping' })

    await module.invoke(PingController, 'ping', interaction)

    expect(interaction.reply).toHaveBeenCalledWith({ content: 'pong' })
  })
})
