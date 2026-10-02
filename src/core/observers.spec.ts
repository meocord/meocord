import {
  AutocompleteInteraction,
  ButtonInteraction,
  ChatInputCommandInteraction,
  type GuildMember,
  Message,
  MessageReaction,
  ModalSubmitInteraction,
  User,
} from 'discord.js'
import {
  Autocomplete,
  Catch,
  Command,
  Controller,
  Cooldown,
  Guard,
  Interceptor,
  MeoCord,
  MessageHandler,
  Observer,
  On,
  ReactionHandler,
  Service,
  UseFilter,
  UseGuard,
  UseInterceptor,
  Validate,
} from '@src/decorator/index.js'
import { CommandType, ReactionHandlerAction } from '@src/enum/index.js'
import { type ExecutionContext, GuardDeniedError } from '@src/common/index.js'
import {
  type DispatchObserver,
  type DispatchResult,
  type ExceptionFilter,
  type GuardInterface,
  type InterceptorInterface,
  type ReactionEvent,
  type StandardSchemaV1,
} from '@src/interface/index.js'
import { createChatInputOptions, createMockInteraction, createModalFields, inspectHandler, MeoCordTestingModule } from '@src/testing/index.js'

/** What the observers were told, in order: which observer, which handler, and the result. */
const told: { observer: string; handler: string | undefined; type: string; result: DispatchResult }[] = []

@Service()
class Metrics {
  readonly outcomes: string[] = []
}

@Observer()
class MetricsObserver implements DispatchObserver {
  constructor(private readonly metrics: Metrics) {}

  onSettled(context: ExecutionContext, result: DispatchResult) {
    this.metrics.outcomes.push(result.outcome)
    told.push({ observer: 'metrics', handler: context.getHandlerName(), type: context.getType(), result })
  }
}

@Observer()
class AuditObserver implements DispatchObserver {
  async onSettled(context: ExecutionContext, result: DispatchResult) {
    await Promise.resolve()
    told.push({ observer: 'audit', handler: context.getHandlerName(), type: context.getType(), result })
  }
}

@Observer()
class BrokenObserver implements DispatchObserver {
  onSettled(): void {
    throw new Error('metrics backend down')
  }
}

@Guard()
class Deny implements GuardInterface {
  canActivate(): boolean {
    return false
  }
}

@Guard()
class Refuse implements GuardInterface {
  canActivate(): boolean {
    throw new GuardDeniedError('Staff only.')
  }
}

class Boom extends Error {}

@Catch(Boom)
class BoomFilter implements ExceptionFilter<Boom> {
  catch(): void {}
}

// Answers from a cache without calling the handler
@Interceptor()
class Cached implements InterceptorInterface {
  async intercept() {
    return 'cached'
  }
}

const positive: StandardSchemaV1<unknown, { amount: number }> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: value =>
      (value as { amount: number }).amount > 0 ? { value: value as { amount: number } } : { issues: [{ message: 'Must be positive', path: ['amount'] }] },
  },
}

@Controller()
class ShopController {
  @Command('buy', CommandType.SLASH)
  async buy(_interaction: ChatInputCommandInteraction) {}

  @Command('secret', CommandType.SLASH)
  @UseGuard(Deny)
  async secret(_interaction: ChatInputCommandInteraction) {}

  @Command('staff', CommandType.SLASH)
  @UseGuard(Refuse)
  async staff(_interaction: ChatInputCommandInteraction) {}

  @Command('daily', CommandType.SLASH)
  @Cooldown({ seconds: 60 })
  async daily(_interaction: ChatInputCommandInteraction) {}

  @Command('pay', CommandType.SLASH)
  @Validate(positive)
  async pay(_interaction: ChatInputCommandInteraction, _params: { amount: number }) {}

  @Command('crash', CommandType.SLASH)
  async crash(_interaction: ChatInputCommandInteraction) {
    throw new Error('database unavailable')
  }

  @Command('filtered', CommandType.SLASH)
  @UseFilter(BoomFilter)
  async filtered(_interaction: ChatInputCommandInteraction) {
    throw new Boom()
  }

  @Command('cached', CommandType.SLASH)
  @UseInterceptor(Cached)
  async cached(_interaction: ChatInputCommandInteraction) {}

  @Command('answered', CommandType.SLASH)
  async answered(interaction: ChatInputCommandInteraction) {
    await interaction.reply({ content: 'Done.' })
  }

  @Command('hanging', CommandType.SLASH)
  async hanging(interaction: ChatInputCommandInteraction) {
    // Deferred, and never followed up: the user is left with "thinking…"
    await interaction.deferReply()
  }

  @Command('self-denied', CommandType.SLASH)
  async selfDenied(_interaction: ChatInputCommandInteraction) {
    throw new GuardDeniedError('Not now.')
  }

  @Command('item/{id}', CommandType.BUTTON)
  async item(_interaction: ButtonInteraction, _params: { id: string }) {}

  @Command('review', CommandType.MODAL_SUBMIT)
  async review(_interaction: ModalSubmitInteraction, _params: { text: string }) {}

  @Autocomplete('buy', 'item')
  async suggest(_interaction: AutocompleteInteraction) {}

  @MessageHandler('!shop')
  async shop(_message: Message) {}

  @ReactionHandler('⭐')
  async star(_reaction: MessageReaction, _options: ReactionEvent) {}

  @On('guildMemberAdd')
  async welcome(_member: GuildMember) {}
}

@MeoCord({ controllers: [ShopController], clientOptions: { intents: [] }, observers: [MetricsObserver, AuditObserver] })
class ShopApp {}

const slash = () => createMockInteraction(ChatInputCommandInteraction, { options: createChatInputOptions({}) })
const results = () => told.filter(entry => entry.observer === 'metrics').map(entry => [entry.handler, entry.result.outcome])

let module: ReturnType<typeof compile>
const compile = () => MeoCordTestingModule.create({ app: ShopApp, controllers: [ShopController] }).compile()

beforeEach(() => {
  told.length = 0
  module = compile()
})

describe('observers, outcome by outcome', () => {
  it("tells them a call that ran as 'ran', with how long it took", async () => {
    await module.invoke(ShopController, 'buy', slash())

    expect(told.map(entry => [entry.observer, entry.handler, entry.result.outcome])).toEqual([
      ['metrics', 'buy', 'ran'],
      ['audit', 'buy', 'ran'],
    ])
    expect(told[0].result).toEqual({
      outcome: 'ran',
      startedAt: expect.any(Number),
      durationMs: expect.any(Number),
      response: 'unanswered',
      handled: false,
    })
    expect(told[0].result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it("tells them 'denied' for a guard returning false, with no error", async () => {
    await module.invoke(ShopController, 'secret', slash())

    expect(told[0].result).toEqual({
      outcome: 'denied',
      startedAt: expect.any(Number),
      durationMs: expect.any(Number),
      deniedBy: Deny,
      response: 'unanswered',
      handled: false,
    })
  })

  it("tells them 'denied' for GuardDeniedError, with the error", async () => {
    await expect(module.invoke(ShopController, 'staff', slash())).rejects.toThrow(GuardDeniedError)

    expect(told[0].result).toMatchObject({ outcome: 'denied', error: expect.any(GuardDeniedError), deniedBy: Refuse, handled: false })
  })

  it("tells them 'cooldown' for a call a cooldown refused", async () => {
    const first = slash()
    await module.invoke(ShopController, 'daily', first)
    // The same user again, whom the cooldown counts
    await expect(module.invoke(ShopController, 'daily', Object.assign(slash(), { user: first.user }))).rejects.toThrow()

    expect(results()).toEqual([
      ['daily', 'ran'],
      ['daily', 'cooldown'],
    ])
  })

  it("tells them 'invalid' for input that failed validation", async () => {
    await expect(module.invoke(ShopController, 'pay', slash(), { amount: -1 })).rejects.toThrow()

    expect(results()).toEqual([['pay', 'invalid']])
  })

  it("tells them 'error' for anything else, handled when a filter answered it", async () => {
    await expect(module.invoke(ShopController, 'crash', slash())).rejects.toThrow('database unavailable')
    await module.invoke(ShopController, 'filtered', slash())

    expect(told.filter(entry => entry.observer === 'metrics').map(entry => entry.result)).toEqual([
      {
        outcome: 'error',
        startedAt: expect.any(Number),
        durationMs: expect.any(Number),
        error: expect.objectContaining({ message: 'database unavailable' }),
        response: 'unanswered',
        handled: false,
      },
      {
        outcome: 'error',
        startedAt: expect.any(Number),
        durationMs: expect.any(Number),
        error: expect.any(Boom),
        response: 'unanswered',
        handled: true,
      },
    ])
  })

  it("counts an interceptor that answers without the handler as 'ran'", async () => {
    await module.invoke(ShopController, 'cached', slash())

    expect(results()).toEqual([['cached', 'ran']])
  })
})

describe('observers, dispatch kind by dispatch kind', () => {
  it('see commands, components, modals, autocomplete, messages, reactions and events', async () => {
    await module.invoke(ShopController, 'buy', slash())
    await module.invoke(ShopController, 'item', createMockInteraction(ButtonInteraction, { customId: 'item/7' }))
    await module.invoke(
      ShopController,
      'review',
      createMockInteraction(ModalSubmitInteraction, { customId: 'review', fields: createModalFields({ text: 'Good' }) }),
    )
    await module.invoke(ShopController, 'suggest', createMockInteraction(AutocompleteInteraction, { commandName: 'buy' }))
    const message = Object.assign(Object.create(Message.prototype) as Message, { content: '!shop', author: { id: 'ada', bot: false } })
    await module.invoke(ShopController, 'shop', message)
    await module.invoke(ShopController, 'star', Object.create(MessageReaction.prototype) as MessageReaction, {
      user: createMockInteraction(User),
      action: ReactionHandlerAction.ADD,
    })
    await module.emit('guildMemberAdd', {} as GuildMember)

    expect(told.filter(entry => entry.observer === 'metrics').map(entry => [entry.handler, entry.type, entry.result.outcome])).toEqual([
      ['buy', 'interaction', 'ran'],
      ['item', 'interaction', 'ran'],
      ['review', 'interaction', 'ran'],
      ['suggest', 'autocomplete', 'ran'],
      ['shop', 'message', 'ran'],
      ['star', 'reaction', 'ran'],
      ['welcome', 'event', 'ran'],
    ])
  })
})

describe('observers themselves', () => {
  it('are resolved from the container, with their dependencies injected', async () => {
    await module.invoke(ShopController, 'buy', slash())
    await module.invoke(ShopController, 'secret', slash())

    expect(module.get(Metrics).outcomes).toEqual(['ran', 'denied'])
  })

  it('run in the order listed, each isolated: one that throws leaves the rest to run', async () => {
    const isolated = MeoCordTestingModule.create({
      controllers: [ShopController],
      observers: [AuditObserver, BrokenObserver, MetricsObserver],
    }).compile()

    await expect(isolated.invoke(ShopController, 'buy', slash())).resolves.toEqual({ ran: true })

    expect(told.map(entry => entry.observer)).toEqual(['audit', 'metrics'])
  })

  it('are listed by inspectHandler for an app', () => {
    expect(inspectHandler(ShopController, 'buy', { app: ShopApp }).observers).toEqual([MetricsObserver, AuditObserver])
    expect(inspectHandler(ShopController, 'buy').observers).toEqual([])
  })

  it('refuse a class without onSettled', () => {
    expect(() => {
      // @ts-expect-error an observer needs onSettled
      @Observer()
      class NotAnObserver {}
      void NotAnObserver
    }).toThrow('NotAnObserver: an @Observer needs an onSettled method, and it has none.')
  })
})

describe('what the result carries', () => {
  it('names the guard that denied the call, whichever way it denied, and no other', async () => {
    await module.invoke(ShopController, 'secret', slash())
    await expect(module.invoke(ShopController, 'staff', slash())).rejects.toThrow(GuardDeniedError)
    await expect(module.invoke(ShopController, 'selfDenied', slash())).rejects.toThrow(GuardDeniedError)
    await module.invoke(ShopController, 'buy', slash())

    expect(told.filter(entry => entry.observer === 'metrics').map(entry => [entry.handler, entry.result.outcome, entry.result.deniedBy])).toEqual([
      ['secret', 'denied', Deny],
      ['staff', 'denied', Refuse],
      ['selfDenied', 'denied', undefined],
      ['buy', 'ran', undefined],
    ])
  })

  it('says where the interaction’s answer stood: replied, left deferred, or unanswered; nothing for a message', async () => {
    await module.invoke(ShopController, 'answered', slash())
    await module.invoke(ShopController, 'hanging', slash())
    await module.invoke(ShopController, 'buy', slash())
    const message = Object.assign(Object.create(Message.prototype) as Message, { content: '!shop', author: { id: 'ada', bot: false } })
    await module.invoke(ShopController, 'shop', message)

    expect(told.filter(entry => entry.observer === 'metrics').map(entry => [entry.handler, entry.result.response])).toEqual([
      ['answered', 'replied'],
      ['hanging', 'deferred'],
      ['buy', 'unanswered'],
      ['shop', undefined],
    ])
  })

  it('carries when the call started, in epoch milliseconds', async () => {
    const before = Date.now()
    await module.invoke(ShopController, 'buy', slash())
    const after = Date.now()

    const { startedAt, durationMs } = told[0].result
    expect(startedAt).toBeGreaterThanOrEqual(before - 5)
    expect(startedAt + durationMs).toBeLessThanOrEqual(after + 5)
  })
})

describe('@Observer({ types })', () => {
  @Observer({ types: ['message'] })
  class MessageObserver implements DispatchObserver {
    onSettled(context: ExecutionContext, result: DispatchResult) {
      told.push({ observer: 'messages', handler: context.getHandlerName(), type: context.getType(), result })
    }
  }

  // Inherits the parent's types
  @Observer()
  class ChildMessageObserver extends MessageObserver {}

  it('is told only about calls of its types, and a subclass inherits them', async () => {
    const typed = MeoCordTestingModule.create({ controllers: [ShopController], observers: [MessageObserver] }).compile()
    const message = Object.assign(Object.create(Message.prototype) as Message, { content: '!shop', author: { id: 'ada', bot: false } })

    await typed.invoke(ShopController, 'buy', slash())
    await typed.invoke(ShopController, 'shop', message)

    expect(told.map(entry => [entry.handler, entry.type])).toEqual([['shop', 'message']])

    told.length = 0
    const inherited = MeoCordTestingModule.create({ controllers: [ShopController], observers: [ChildMessageObserver] }).compile()
    await inherited.invoke(ShopController, 'buy', slash())
    await inherited.invoke(ShopController, 'shop', message)

    expect(told.map(entry => [entry.handler, entry.type])).toEqual([['shop', 'message']])
  })

  it('refuses a list that can match nothing', () => {
    expect(() => {
      @Observer({ types: [] })
      class Nothing implements DispatchObserver {
        onSettled(): void {
          // Never told about anything
        }
      }
      void Nothing
    }).toThrow('Nothing: @Observer({ types: [] }) lists no types, so it would never run.')
  })
})

describe('onStart', () => {
  const order: string[] = []
  const contexts = new WeakMap<ExecutionContext, string>()

  @Observer()
  class SpanObserver implements DispatchObserver {
    onStart(context: ExecutionContext) {
      order.push(`start ${context.getHandlerName()}`)
      contexts.set(context, 'span')
    }

    onSettled(context: ExecutionContext, { outcome }: DispatchResult) {
      order.push(`settled ${context.getHandlerName()} ${outcome} paired:${contexts.get(context) === 'span'}`)
    }
  }

  @Observer()
  class BrokenStart implements DispatchObserver {
    onStart(): void {
      throw new Error('tracer down')
    }

    onSettled(): void {
      order.push('broken settled')
    }
  }

  @Guard()
  class Recording implements GuardInterface {
    canActivate(): boolean {
      order.push('guard')
      return true
    }
  }

  @Controller()
  class TracedController {
    @Command('traced', CommandType.SLASH)
    @UseGuard(Recording)
    async traced(_interaction: ChatInputCommandInteraction) {
      order.push('handler')
    }
  }

  beforeEach(() => {
    order.length = 0
  })

  it('is called before the guards, and onSettled gets the same context object', async () => {
    const traced = MeoCordTestingModule.create({ controllers: [TracedController], observers: [SpanObserver] }).compile()

    await traced.invoke(TracedController, 'traced', slash())

    expect(order).toEqual(['start traced', 'guard', 'handler', 'settled traced ran paired:true'])
  })

  it('is isolated: one that throws leaves the call and the other observers to go on', async () => {
    const traced = MeoCordTestingModule.create({ controllers: [TracedController], observers: [BrokenStart, SpanObserver] }).compile()

    await expect(traced.invoke(TracedController, 'traced', slash())).resolves.toEqual({ ran: true })

    expect(order).toEqual(['start traced', 'guard', 'handler', 'broken settled', 'settled traced ran paired:true'])
  })
})
