import { describe, expectTypeOf, it } from 'vitest'
import { type ButtonInteraction, type Client, type Message, type MessageReaction, type User } from 'discord.js'
import { type DispatchedCall, type InvocationResult, MeoCordTestingModule, type TestingModule, type TestingModuleBuilder } from './meocord-testing-module.js'
import { ReactionHandlerAction } from '@src/enum/index.js'
import { createExecutionContext } from './execution-context.js'
import { getResponse } from './response.js'

/**
 * Runs under `vitest --typecheck`. The negative case uses `@ts-expect-error`,
 * which fails once the rejected form starts compiling.
 */

class NotificationService {
  private readonly prefix = '[bot] '

  async notify(message: string): Promise<string> {
    return this.prefix + message
  }

  async broadcast(message: string): Promise<string> {
    return this.prefix + message
  }
}

describe('overrideProvider', () => {
  // Asserted by calling it, not by inspecting the parameter type: `T` extends
  // `Partial<T>`, so `.parameter(0).toExtend<Partial<T>>()` holds under both
  // signatures and proves nothing. Passing a genuine partial is what fails when
  // the parameter tightens back to `T`.
  it('accepts a double covering only the methods under test', () => {
    MeoCordTestingModule.create({})
      .overrideProvider(NotificationService)
      .useValue({ notify: async () => 'ok' })
  })

  // Cannot distinguish `Partial<T>` from `T` — both reject it — but it does
  // catch a loosening to `Record<string, unknown>` or `any`.
  it('rejects a misspelled method name', () => {
    MeoCordTestingModule.create({})
      .overrideProvider(NotificationService)
      // @ts-expect-error `notifi` is not a method on NotificationService.
      .useValue({ notifi: () => Promise.resolve('') })
  })
})

class ProfileController {
  show(_interaction: ButtonInteraction, _params: { id: string }): Promise<void> {
    return Promise.resolve()
  }

  refresh(): Promise<void> {
    return Promise.resolve()
  }
}

describe('invoke', () => {
  const module = MeoCordTestingModule.create({ controllers: [ProfileController] }).compile()
  const interaction = {} as ButtonInteraction

  it('takes the handler arguments', () => {
    expectTypeOf(module.invoke(ProfileController, 'show', interaction, { id: '1' })).toEqualTypeOf<
      Promise<InvocationResult>
    >()
  })

  it('takes the interaction for a handler that declares no parameters, as dispatch passes it', () => {
    expectTypeOf(module.invoke(ProfileController, 'refresh', interaction)).toEqualTypeOf<Promise<InvocationResult>>()
    expectTypeOf(module.invoke(ProfileController, 'refresh')).toEqualTypeOf<Promise<InvocationResult>>()
  })

  it('rejects an unknown method and arguments the handler does not take', () => {
    // @ts-expect-error `hide` is not a method on ProfileController.
    void module.invoke(ProfileController, 'hide', interaction, { id: '1' })
    // @ts-expect-error `id` must be a string.
    void module.invoke(ProfileController, 'show', interaction, { id: 1 })
  })
})

describe('the testing helpers, misused', () => {
  it('rejects a method createExecutionContext cannot find', () => {
    // @ts-expect-error `hide` is not a method on ProfileController.
    void createExecutionContext(ProfileController, 'hide')
  })

  it('rejects arguments an event does not pass to emit', () => {
    const module = MeoCordTestingModule.create({}).compile()
    // @ts-expect-error guildMemberAdd passes a GuildMember
    void module.emit('guildMemberAdd', 'member')
    // @ts-expect-error not a client event
    void module.emit('memberJoined')
  })

  it('takes only an interaction in getResponse', () => {
    // @ts-expect-error a message has no response state
    void getResponse({} as Message)
  })
})

describe('TestingModule lifecycle', () => {
  const module = MeoCordTestingModule.create({}).compile()

  it('readies with true, or with the client and primary to pass the hooks', () => {
    expectTypeOf(module.init()).resolves.toEqualTypeOf<typeof module>()
    expectTypeOf(module.init({ ready: true })).resolves.toEqualTypeOf<typeof module>()
    void module.init({ ready: { client: {} as Client<true>, primary: false } })
    expectTypeOf(module.close()).toEqualTypeOf<Promise<void>>()
  })

  it('takes only a ready client', () => {
    // @ts-expect-error onReady receives a client that has logged in
    void module.init({ ready: { client: {} as Client<false> } })
  })
})

describe('TestingModule.dispatch', () => {
  const module = MeoCordTestingModule.create({}).compile()

  it('takes an interaction or a message alone, and a reaction with who reacted', () => {
    expectTypeOf(module.dispatch({} as ButtonInteraction)).resolves.toEqualTypeOf<DispatchedCall>()
    expectTypeOf(module.dispatch({} as Message)).resolves.toEqualTypeOf<DispatchedCall>()
    void module.dispatch({} as MessageReaction, { user: {} as User })
    void module.dispatch({} as MessageReaction, { user: {} as User, action: ReactionHandlerAction.REMOVE })
  })

  it('needs the user who reacted with a reaction', () => {
    // @ts-expect-error a reaction is dispatched with the user who reacted
    void module.dispatch({} as MessageReaction)
  })
})

describe('fromApp', () => {
  class App {}
  class Extra {}

  it('takes an app class and optional overrides, and returns the builder', () => {
    expectTypeOf(MeoCordTestingModule.fromApp(App)).toEqualTypeOf<TestingModuleBuilder>()
    MeoCordTestingModule.fromApp(App, { providers: [{ provide: 'token', useValue: 1 }], controllers: [Extra], observers: [] })
    expectTypeOf(MeoCordTestingModule.fromApp(App).compile()).toEqualTypeOf<TestingModule>()
  })

  it('refuses what fromApp does not take', () => {
    // @ts-expect-error the app is a class, not an instance
    MeoCordTestingModule.fromApp(new App())
    // @ts-expect-error services come from the app; a test replaces one by token in providers
    MeoCordTestingModule.fromApp(App, { services: [Extra] })
    // @ts-expect-error a provider is an object with provide, not a bare value
    MeoCordTestingModule.fromApp(App, { providers: [42] })
  })
})
