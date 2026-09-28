import { vi } from 'vitest'
import { ButtonInteraction, type GuildMember, type Presence } from 'discord.js'
import { type HandlerCall } from '@src/common/execution-context.js'
import {
  Command,
  Controller,
  Guard,
  Interceptor,
  MeoCord,
  On,
  UseGuard,
  UseInterceptor,
} from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { type CallHandler, type GuardInterface, type InterceptorInterface } from '@src/interface/index.js'
import { createMock, createMockInteraction, MeoCordTestingModule } from '@src/testing/index.js'

const { built } = vi.hoisted(() => ({ built: [] as string[] }))

// Counts the contexts the pipeline builds, to prove the fast path builds none
vi.mock('@src/common/execution-context.js', async importOriginal => {
  const original = await importOriginal<typeof import('@src/common/execution-context.js')>()
  class CountedContext extends original.HandlerExecutionContext {
    constructor(call: HandlerCall) {
      super(call)
      built.push(call.type ?? 'unknown')
    }
  }
  return { ...original, HandlerExecutionContext: CountedContext }
})

describe('stage types', () => {
  beforeEach(() => {
    built.length = 0
  })

  it('skips a global guard declared for interactions on an event, and runs it on an interaction', async () => {
    const seen: string[] = []

    @Guard({ types: ['interaction'] })
    class InteractionOnly implements GuardInterface {
      canActivate() {
        seen.push('guard')
        return true
      }
    }

    @Controller()
    class Members {
      @On('guildMemberAdd')
      greet() {
        seen.push('event handler')
      }
      @Command('join', CommandType.BUTTON)
      async join(_interaction: ButtonInteraction) {
        seen.push('button handler')
      }
    }

    @MeoCord({ controllers: [], guards: [InteractionOnly], clientOptions: { intents: [] } })
    class App {}

    const module = MeoCordTestingModule.create({ app: App, controllers: [Members] }).compile()

    await module.emit('guildMemberAdd', createMock<GuildMember>())
    expect(seen).toEqual(['event handler'])

    await module.invoke(Members, 'join', createMockInteraction(ButtonInteraction))
    expect(seen).toEqual(['event handler', 'guard', 'button handler'])
  })

  it('applies the same rule to class-level and method-level stages', async () => {
    const seen: string[] = []

    @Guard({ types: ['message'] })
    class MessageOnly implements GuardInterface {
      canActivate() {
        seen.push('message guard')
        return false
      }
    }

    @Interceptor({ types: ['reaction'] })
    class ReactionOnly implements InterceptorInterface {
      intercept(_context: unknown, next: CallHandler) {
        seen.push('reaction interceptor')
        return next.handle()
      }
    }

    @Controller()
    @UseGuard(MessageOnly)
    class Members {
      @On('guildMemberAdd')
      @UseInterceptor(ReactionOnly)
      greet() {
        seen.push('handler')
      }
    }

    const module = MeoCordTestingModule.create({ controllers: [Members] }).compile()
    const { ran } = await module.emit('guildMemberAdd', createMock<GuildMember>())

    expect(ran).toBe(1)
    expect(seen).toEqual(['handler'])
  })

  it('runs a stage declaring "event" on an event, with the context type set', async () => {
    const types: string[] = []

    @Interceptor({ types: ['event'] })
    class EventTimer implements InterceptorInterface {
      intercept(context: { getType(): string }, next: CallHandler) {
        types.push(context.getType())
        return next.handle()
      }
    }

    @Controller()
    @UseInterceptor(EventTimer)
    class Members {
      @On('guildMemberAdd')
      greet() {}
    }

    const module = MeoCordTestingModule.create({ controllers: [Members] }).compile()
    await module.emit('guildMemberAdd', createMock<GuildMember>())

    expect(types).toEqual(['event'])
    // The counter sees contexts the pipeline builds, so the empty count below means none was built
    expect(built).toContain('event')
  })

  it('builds no context for an event no stage applies to', async () => {
    const intercepted = vi.fn()

    @Interceptor({ types: ['interaction'] })
    class InteractionTimer implements InterceptorInterface {
      intercept(_context: unknown, next: CallHandler) {
        intercepted()
        return next.handle()
      }
    }

    @Guard({ types: ['interaction'] })
    class InteractionGuard implements GuardInterface {
      canActivate() {
        return true
      }
    }

    @Controller()
    class Presences {
      @On('presenceUpdate')
      track(_before: Presence | null, _after: Presence) {}
    }

    @MeoCord({
      controllers: [],
      guards: [InteractionGuard],
      interceptors: [InteractionTimer],
      clientOptions: { intents: [] },
    })
    class App {}

    const module = MeoCordTestingModule.create({ app: App, controllers: [Presences] }).compile()
    const { ran } = await module.emit('presenceUpdate', null, createMock<Presence>())

    expect(ran).toBe(1)
    expect(intercepted).not.toHaveBeenCalled()
    expect(built).toEqual([])
  })

  it('refuses an empty list of types, which would leave the guard or interceptor never running', () => {
    expect(() => {
      @Guard({ types: [] })
      class NeverGuard implements GuardInterface {
        canActivate() {
          return false
        }
      }
      return NeverGuard
    }).toThrow('NeverGuard: @Guard({ types: [] }) lists no types, so it would never run')

    expect(() => {
      @Interceptor({ types: [] })
      class NeverInterceptor implements InterceptorInterface {
        intercept(_context: unknown, next: CallHandler) {
          return next.handle()
        }
      }
      return NeverInterceptor
    }).toThrow('NeverInterceptor: @Interceptor({ types: [] }) lists no types')
  })

  it('refuses an interceptor limited to autocomplete, which interceptors never run for', () => {
    expect(() => {
      @Interceptor({ types: ['autocomplete'] })
      class CompletionTimer implements InterceptorInterface {
        intercept(_context: unknown, next: CallHandler) {
          return next.handle()
        }
      }
      return CompletionTimer
    }).toThrow("CompletionTimer: @Interceptor({ types: ['autocomplete'] }) can never run")
  })

  it('lets a subclass inherit the types of the guard it extends', async () => {
    const seen: string[] = []

    @Guard({ types: ['interaction'] })
    class InteractionGuard implements GuardInterface {
      canActivate() {
        seen.push('guard')
        return true
      }
    }

    @Guard()
    class StricterGuard extends InteractionGuard {}

    @Controller()
    @UseGuard(StricterGuard)
    class Members {
      @On('guildMemberAdd')
      greet() {
        seen.push('greet')
      }
    }

    await MeoCordTestingModule.create({ controllers: [Members] }).compile().emit('guildMemberAdd', createMock<GuildMember>())

    expect(seen).toEqual(['greet'])
  })
})
