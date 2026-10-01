import { ButtonInteraction, ChatInputCommandInteraction, Message, type MessageReaction } from 'discord.js'
import { vi } from 'vitest'
import { Command, Controller, Cooldown, MessageHandler, On, Once, Pipe, ReactionHandler, UsePipe, Validate } from '@src/decorator/index.js'
import { handlerCooldowns, methodCooldowns } from '@src/core/cooldown-runner.js'
import { CommandType } from '@src/enum/index.js'
import { type PipeInterface, type StandardSchemaV1 } from '@src/interface/index.js'
import { CooldownError, cooldownMessage, CooldownStore, type CooldownLimit, MemoryCooldownStore } from '@src/common/index.js'
import { createChatInputOptions, createMockInteraction, inspectHandler, MeoCordTestingModule } from '@src/testing/index.js'

/** Applies a method decorator to a handler, as writing it above one does. */
const onHandler = (decorator: MethodDecorator) => () => {
  class Shop {
    buy() {}
  }
  decorator(Shop.prototype, 'buy', Object.getOwnPropertyDescriptor(Shop.prototype, 'buy')!)
}

const ran: string[] = []

const positive: StandardSchemaV1<unknown, { amount: number }> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: value =>
      (value as { amount: number }).amount > 0
        ? { value: value as { amount: number } }
        : { issues: [{ message: 'Must be positive', path: ['amount'] }] },
  },
}

@Pipe()
class FailingPipe implements PipeInterface<string, string> {
  transform(): string {
    throw new Error('no such account')
  }
}

const OWNER = 'owner-id'

@Controller()
class DailyController {
  @Command('daily', CommandType.SLASH)
  @Cooldown({ seconds: 10 })
  async daily(_interaction: ChatInputCommandInteraction) {
    ran.push('daily')
  }

  @Command('burst', CommandType.SLASH)
  @Cooldown({ seconds: 3 })
  @Cooldown({ uses: 3, seconds: 60 })
  async burst(_interaction: ChatInputCommandInteraction) {
    ran.push('burst')
  }

  // The long window first: a call the short one refuses must not spend a use of the long one
  @Command('longfirst', CommandType.SLASH)
  @Cooldown({ uses: 2, seconds: 60 })
  @Cooldown({ seconds: 3 })
  async longfirst(_interaction: ChatInputCommandInteraction) {
    ran.push('longfirst')
  }

  @Command('server', CommandType.SLASH)
  @Cooldown({ seconds: 10, per: 'guild' })
  async server(_interaction: ChatInputCommandInteraction) {
    ran.push('server')
  }

  @Command('everyone', CommandType.SLASH)
  @Cooldown({ seconds: 10, per: 'global' })
  async everyone(_interaction: ChatInputCommandInteraction) {
    ran.push('everyone')
  }

  @Command('room', CommandType.SLASH)
  @Cooldown({ seconds: 10, per: 'channel' })
  async room(_interaction: ChatInputCommandInteraction) {
    ran.push('room')
  }

  @Command('admin', CommandType.SLASH)
  @Cooldown({ seconds: 10, bypass: context => context.getInteraction()?.user.id === OWNER })
  async admin(_interaction: ChatInputCommandInteraction) {
    ran.push('admin')
  }

  @Command('pay', CommandType.SLASH)
  @Validate(positive)
  @Cooldown({ seconds: 10 })
  async pay(_interaction: ChatInputCommandInteraction, _params: { amount: number }) {
    ran.push('pay')
  }

  @Command('lookup/{uid}', CommandType.BUTTON)
  @UsePipe('uid', FailingPipe)
  @Cooldown({ seconds: 10 })
  async lookup(_interaction: ButtonInteraction, _params: { uid: string }) {
    ran.push('lookup')
  }

  @MessageHandler('!hi')
  @Cooldown({ seconds: 10, per: 'channel' })
  async hi(_message: Message) {
    ran.push('hi')
  }
}

const slash = (overrides: { user?: string; guild?: string | null; channel?: string } = {}, options = {}) =>
  createMockInteraction(ChatInputCommandInteraction, {
    user: { id: overrides.user ?? 'ada' } as never,
    guildId: (overrides.guild === undefined ? 'guild-1' : overrides.guild) as never,
    channelId: overrides.channel ?? 'channel-1',
    options: createChatInputOptions(options) as never,
  })

let module: ReturnType<typeof compile>
const compile = () => MeoCordTestingModule.create({ controllers: [DailyController] }).compile()

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  ran.length = 0
  module = compile()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('@Cooldown', () => {
  it('blocks a second call within the window, saying how long to wait', async () => {
    await module.invoke(DailyController, 'daily', slash())
    vi.advanceTimersByTime(4_000)

    const blocked = module.invoke(DailyController, 'daily', slash())

    await expect(blocked).rejects.toBeInstanceOf(CooldownError)
    await expect(blocked).rejects.toMatchObject({ retryAfterMs: 6_000, per: 'user', message: 'Slow down: try again in 6s.' })
    expect(ran).toEqual(['daily'])
  })

  it('allows the call again once the window has passed', async () => {
    await module.invoke(DailyController, 'daily', slash())
    vi.advanceTimersByTime(10_000)

    await module.invoke(DailyController, 'daily', slash())

    expect(ran).toEqual(['daily', 'daily'])
  })

  it('counts each user separately by default', async () => {
    await module.invoke(DailyController, 'daily', slash({ user: 'ada' }))
    await module.invoke(DailyController, 'daily', slash({ user: 'bo' }))

    expect(ran).toEqual(['daily', 'daily'])
  })

  it('applies stacked windows together, each sliding on its own', async () => {
    for (const _ of [1, 2, 3]) {
      await module.invoke(DailyController, 'burst', slash())
      vi.advanceTimersByTime(3_000)
    }
    await expect(module.invoke(DailyController, 'burst', slash())).rejects.toMatchObject({ retryAfterMs: 51_000 })

    vi.advanceTimersByTime(51_000)
    await module.invoke(DailyController, 'burst', slash())
    expect(ran).toHaveLength(4)
  })

  it('counts a call against all stacked cooldowns or none, so one refused spends no other', async () => {
    await module.invoke(DailyController, 'longfirst', slash())
    await expect(module.invoke(DailyController, 'longfirst', slash())).rejects.toMatchObject({ retryAfterMs: 3_000 })
    await expect(module.invoke(DailyController, 'longfirst', slash())).rejects.toBeInstanceOf(CooldownError)

    // Had the refused calls counted against the 60-second cooldown, its two uses would be gone
    vi.advanceTimersByTime(3_000)
    await module.invoke(DailyController, 'longfirst', slash())
    expect(ran).toEqual(['longfirst', 'longfirst'])
  })

  it('waits the longest wait among the cooldowns that refuse a call', async () => {
    await module.invoke(DailyController, 'longfirst', slash())
    vi.advanceTimersByTime(3_000)
    await module.invoke(DailyController, 'longfirst', slash())

    // Both refuse now: the 3-second one for 3s, the 60-second one for 57s
    await expect(module.invoke(DailyController, 'longfirst', slash())).rejects.toMatchObject({ retryAfterMs: 57_000, per: 'user' })
  })

  describe('scopes', () => {
    it("'guild' counts a server's users together, and each user alone outside a server", async () => {
      await module.invoke(DailyController, 'server', slash({ user: 'ada' }))
      await expect(module.invoke(DailyController, 'server', slash({ user: 'bo' }))).rejects.toMatchObject({ per: 'guild' })

      await module.invoke(DailyController, 'server', slash({ user: 'ada', guild: null }))
      await module.invoke(DailyController, 'server', slash({ user: 'bo', guild: null }))
      expect(ran).toEqual(['server', 'server', 'server'])
    })

    it("'channel' counts a channel's users together", async () => {
      await module.invoke(DailyController, 'room', slash({ user: 'ada', channel: 'a' }))
      await module.invoke(DailyController, 'room', slash({ user: 'bo', channel: 'b' }))
      await expect(module.invoke(DailyController, 'room', slash({ user: 'cy', channel: 'a' }))).rejects.toBeInstanceOf(
        CooldownError,
      )
    })

    it("'global' counts every call together", async () => {
      await module.invoke(DailyController, 'everyone', slash({ user: 'ada', guild: 'g1' }))
      await expect(module.invoke(DailyController, 'everyone', slash({ user: 'bo', guild: 'g2' }))).rejects.toMatchObject({
        per: 'global',
      })
    })
  })

  it('lets a bypassed caller through without spending a use', async () => {
    await module.invoke(DailyController, 'admin', slash({ user: OWNER }))
    await module.invoke(DailyController, 'admin', slash({ user: OWNER }))
    await module.invoke(DailyController, 'admin', slash({ user: 'ada' }))

    expect(ran).toEqual(['admin', 'admin', 'admin'])
  })

  // Counted last, so a caller whose input is refused can fix it and try again at once.
  it('spends nothing on input that fails validation or a pipe', async () => {
    await expect(module.invoke(DailyController, 'pay', slash({}, { amount: 0 }))).rejects.toThrow('Must be positive')
    await module.invoke(DailyController, 'pay', slash({}, { amount: 5 }))

    const click = () => createMockInteraction(ButtonInteraction, { customId: 'lookup/1', user: { id: 'ada' } as never })
    await expect(module.invoke(DailyController, 'lookup', click())).rejects.toThrow('no such account')
    await expect(module.invoke(DailyController, 'lookup', click())).rejects.toThrow('no such account')

    expect(ran).toEqual(['pay'])
  })

  it('limits message handlers too', async () => {
    const message = () =>
      Object.assign(Object.create(Message.prototype) as Message, {
        author: { id: 'ada' },
        guildId: 'g',
        channelId: 'c',
        content: '!hi',
      })

    await module.invoke(DailyController, 'hi', message())
    await expect(module.invoke(DailyController, 'hi', message())).rejects.toBeInstanceOf(CooldownError)
  })

  it('refuses a method-level @Cooldown on a reaction handler at startup', () => {
    @Controller()
    class ReactionController {
      @ReactionHandler('👍')
      @Cooldown({ seconds: 5 })
      async thumbs(_reaction: MessageReaction) {}
    }

    expect(() => MeoCordTestingModule.create({ controllers: [ReactionController] }).compile()).toThrow(
      'ReactionController.thumbs: @Cooldown is for interaction and message handlers, and this is a reaction handler.',
    )
  })

  it('refuses options it cannot count, where it applies', () => {
    for (const seconds of [0, -1, Number.NaN, Infinity, 0.0009, 1e300]) {
      expect(onHandler(Cooldown({ seconds }))).toThrow(`@Cooldown needs a number of seconds from 0.001 to 9007199254740, not ${seconds}.`)
    }
    expect(onHandler(Cooldown({ seconds: 5, uses: 1.5 }))).toThrow('whole number of uses')
    expect(onHandler(Cooldown({ seconds: 5, per: 'server' as never }))).toThrow("not 'server'")
    expect(onHandler(Cooldown({ seconds: 5, by: 'uid' as never }))).toThrow('@Cooldown takes by as a function of the call')
  })

  it('is reported by inspectHandler, with its defaults', () => {
    expect(inspectHandler(DailyController, 'burst').cooldowns).toEqual([
      { seconds: 3, uses: 1, per: 'user', bypass: false, by: false },
      { seconds: 60, uses: 3, per: 'user', bypass: false, by: false },
    ])
    expect(inspectHandler(DailyController, 'admin').cooldowns[0].bypass).toBe(true)
  })

  it('applies a controller-level @Cooldown to each handler separately', async () => {
    @Controller()
    @Cooldown({ seconds: 10 })
    class ProfileController {
      @Command('profile', CommandType.SLASH)
      async profile(_interaction: ChatInputCommandInteraction) {
        ran.push('profile')
      }

      @Command('stats', CommandType.SLASH)
      async stats(_interaction: ChatInputCommandInteraction) {
        ran.push('stats')
      }
    }
    const profiles = MeoCordTestingModule.create({ controllers: [ProfileController] }).compile()

    await profiles.invoke(ProfileController, 'profile', slash())
    await profiles.invoke(ProfileController, 'stats', slash())
    await expect(profiles.invoke(ProfileController, 'profile', slash())).rejects.toBeInstanceOf(CooldownError)
    expect(ran).toEqual(['profile', 'stats'])
  })

  it('counts in a store a test provides', async () => {
    const consume = vi.fn(async (_key: string, _limit: CooldownLimit) => ({ allowed: false, retryAfterMs: 2_500 }))
    const stubbed = MeoCordTestingModule.create({
      controllers: [DailyController],
      providers: [{ provide: CooldownStore, useValue: { consume } }],
    }).compile()

    await expect(stubbed.invoke(DailyController, 'daily', slash())).rejects.toMatchObject({ retryAfterMs: 2_500 })
    expect(consume).toHaveBeenCalledWith('DailyController.daily#0:user:user:ada', { uses: 1, windowMs: 10_000 })
  })
})

describe('a cooldown window', () => {
  it('reaches the store as a whole number of milliseconds, whatever the seconds', async () => {
    @Controller()
    class FractionController {
      @Command('fraction', CommandType.SLASH)
      @Cooldown({ seconds: 16.1 })
      @Cooldown({ seconds: 0.0015 })
      async fraction(_interaction: ChatInputCommandInteraction) {}
    }
    const consumeMany = vi.fn(async (_entries: readonly { key: string; limit: CooldownLimit }[]) => ({ allowed: true, retryAfterMs: 0 }))
    const stubbed = MeoCordTestingModule.create({
      controllers: [FractionController],
      providers: [{ provide: CooldownStore, useValue: { consumeMany } }],
    }).compile()

    await stubbed.invoke(FractionController, 'fraction', slash())

    expect(consumeMany.mock.calls[0][0].map(({ limit }) => limit.windowMs)).toEqual([16_100, 2])
  })
})

describe('MemoryCooldownStore', () => {
  // Nothing is awaited between checking and recording, so the last use goes to exactly one call.
  it('lets exactly `uses` of many concurrent calls through', async () => {
    const store = new MemoryCooldownStore()

    const verdicts = await Promise.all(Array.from({ length: 10 }, () => store.consume('k', { uses: 3, windowMs: 1_000 })))

    expect(verdicts.filter(verdict => verdict.allowed)).toHaveLength(3)
  })

  // Against the plain definition: keep the calls younger than the window, and allow one while fewer than `uses`
  it('decides every call as filtering all call times would, over thousands of calls and several windows', async () => {
    const store = new MemoryCooldownStore()
    const reference = new Map<string, number[]>()
    let seed = 7
    const random = () => (seed = (seed * 16_807) % 2_147_483_647) / 2_147_483_647

    for (let step = 0; step < 5_000; step++) {
      const key = `k${Math.floor(random() * 3)}`
      const limit = { uses: 1 + Math.floor(random() * 40), windowMs: 200 + Math.floor(random() * 800) }
      const now = Date.now()
      const times = (reference.get(key) ?? []).filter(time => now - time < limit.windowMs)
      const expected =
        times.length < limit.uses
          ? { allowed: true, retryAfterMs: 0 }
          : { allowed: false, retryAfterMs: times[times.length - limit.uses] + limit.windowMs - now }
      if (expected.allowed) times.push(now)
      reference.set(key, times)

      expect(await store.consume(key, limit)).toEqual(expected)
      vi.advanceTimersByTime(Math.floor(random() * 12))
    }
  })

  it('keeps counting when the clock steps back, rather than letting calls through twice', async () => {
    const store = new MemoryCooldownStore()
    const limit = { uses: 1, windowMs: 1_000 }
    await store.consume('k', limit)
    vi.setSystemTime(Date.now() - 5_000)

    expect((await store.consume('k', limit)).allowed).toBe(false)
  })

  it('drops keys whose calls have all left their window', async () => {
    const store = new MemoryCooldownStore()
    await store.consume('short', { uses: 1, windowMs: 1_000 })
    await store.consume('long', { uses: 1, windowMs: 120_000 })

    vi.advanceTimersByTime(60_000)

    expect(store.size).toBe(1)
  })
})

describe('cooldownMessage', () => {
  it('rounds up to whole seconds, and reads minutes past a minute', () => {
    expect(cooldownMessage(200)).toBe('Slow down: try again in 1s.')
    expect(cooldownMessage(12_000)).toBe('Slow down: try again in 12s.')
    expect(cooldownMessage(125_000)).toBe('Slow down: try again in 2m 5s.')
    expect(cooldownMessage(120_000)).toBe('Slow down: try again in 2m.')
  })
})


describe('classes that share a name', () => {
  // Cooldown counts and @Once tracking are keyed by class name, so two same-named classes would share them.
  const shopWithCooldown = () => {
    @Controller()
    class Shop {
      @Command('buy', CommandType.SLASH)
      @Cooldown({ seconds: 5 })
      async buy(_interaction: ChatInputCommandInteraction) {}
    }
    return Shop
  }
  // Each under its own command, since two handlers of one command would be refused for that
  const plainShop = (command = 'sell') => {
    @Controller()
    class Shop {
      @Command(command, CommandType.SLASH)
      async sell(_interaction: ChatInputCommandInteraction) {}
    }
    return Shop
  }
  const shopWithOnce = () => {
    @Controller()
    class Shop {
      @Once('clientReady')
      async ready() {}
    }
    return Shop
  }

  it('refuse to start when either counts a cooldown', () => {
    expect(() => MeoCordTestingModule.create({ controllers: [shopWithCooldown(), plainShop()] }).compile()).toThrow(
      'Shop: two classes have this name; @Cooldown and @Once tell classes apart by name, so they would share their counts. Rename one of them.',
    )
  })

  it('refuse to start when either has a @Once handler', () => {
    expect(() => MeoCordTestingModule.create({ controllers: [plainShop(), shopWithOnce()] }).compile()).toThrow('Shop: two classes have this name')
  })

  it('start when neither has a cooldown or a @Once handler', () => {
    expect(() => MeoCordTestingModule.create({ controllers: [plainShop(), plainShop('refund')] }).compile()).not.toThrow()
  })
})

describe('@Cooldown, rule by rule', () => {
  it('finds no cooldowns for a method a class does not have', () => {
    expect(handlerCooldowns(DailyController.prototype, 'missing')).toEqual([])
    expect(methodCooldowns(DailyController.prototype, 'missing')).toEqual([])
  })

  it('applies the class cooldowns of every class in the chain, base first, however deep the handler is declared', () => {
    @Cooldown({ seconds: 1 })
    class Root {
      rooted() {}
    }
    @Cooldown({ seconds: 2 })
    class Middle extends Root {
      declared() {}
    }
    @Cooldown({ seconds: 3 })
    class Leaf extends Middle {}

    expect(handlerCooldowns(Leaf.prototype, 'declared').map(({ seconds }) => seconds)).toEqual([1, 2, 3])
    expect(handlerCooldowns(Leaf.prototype, 'rooted').map(({ seconds }) => seconds)).toEqual([1, 2, 3])
  })

  it('stops at a class that sets inheritStages: false, for the handlers it declares', () => {
    @Cooldown({ seconds: 1 })
    class Root {
      rooted() {}
    }
    @Controller({ inheritStages: false })
    @Cooldown({ seconds: 2 })
    class Middle extends Root {
      declared() {}
    }
    @Cooldown({ seconds: 3 })
    class Leaf extends Middle {}

    expect(handlerCooldowns(Leaf.prototype, 'declared').map(({ seconds }) => seconds)).toEqual([2, 3])
    expect(handlerCooldowns(Leaf.prototype, 'rooted').map(({ seconds }) => seconds)).toEqual([1, 2, 3])
  })

  it('counts under the key of each scope, and a caller without a user as unknown', async () => {
    const keys: string[] = []
    const consume = vi.fn(async (key: string) => {
      keys.push(key)
      return { allowed: true, retryAfterMs: 0 }
    })

    @Controller()
    class Scoped {
      @Command('server', CommandType.SLASH)
      @Cooldown({ seconds: 5, per: 'guild' })
      async server(_interaction: ChatInputCommandInteraction) {}

      @Command('everyone', CommandType.SLASH)
      @Cooldown({ seconds: 5, per: 'global' })
      async everyone(_interaction: ChatInputCommandInteraction) {}

      @MessageHandler('!who')
      @Cooldown({ seconds: 5 })
      async who(_message: Message) {}
    }
    const scoped = MeoCordTestingModule.create({ controllers: [Scoped], providers: [{ provide: CooldownStore, useValue: { consume } }] }).compile()
    const anonymous = Object.assign(Object.create(Message.prototype) as Message, { author: undefined, guildId: 'g', channelId: 'c', content: '!who' })

    await scoped.invoke(Scoped, 'server', slash({ guild: 'g1' }))
    await scoped.invoke(Scoped, 'everyone', slash())
    await scoped.invoke(Scoped, 'who', anonymous)

    expect(keys).toEqual(['Scoped.server#0:guild:guild:g1', 'Scoped.everyone#0:global:global', 'Scoped.who#0:user:user:unknown'])
  })

  it("counts each message author separately by default", async () => {
    @Controller()
    class Greeter {
      @MessageHandler('!hello')
      @Cooldown({ seconds: 10 })
      async hello(_message: Message) {
        ran.push('hello')
      }
    }
    const greeter = MeoCordTestingModule.create({ controllers: [Greeter] }).compile()
    const from = (id: string) => Object.assign(Object.create(Message.prototype) as Message, { author: { id }, guildId: 'g', channelId: 'c', content: '!hello' })

    await greeter.invoke(Greeter, 'hello', from('ada'))
    await greeter.invoke(Greeter, 'hello', from('bo'))

    expect(ran).toEqual(['hello', 'hello'])
  })

  it("never counts a controller's cooldown against its event handlers", async () => {
    @Controller()
    @Cooldown({ seconds: 60 })
    class Members {
      @On('guildMemberAdd')
      greet() {
        ran.push('greet')
      }
    }
    const members = MeoCordTestingModule.create({ controllers: [Members] }).compile()

    await members.emit('guildMemberAdd', {} as never)
    await members.emit('guildMemberAdd', {} as never)

    expect(ran).toEqual(['greet', 'greet'])
  })

  it('refuses no uses, or fewer', () => {
    expect(onHandler(Cooldown({ seconds: 5, uses: 0 }))).toThrow('whole number of uses of at least 1, not 0')
    expect(onHandler(Cooldown({ seconds: 5, uses: -2 }))).toThrow('not -2')
  })
})

describe('MemoryCooldownStore, sweeping', () => {
  it('keeps a key while any of its calls is inside its window, and drops it the moment the last one leaves', async () => {
    const store = new MemoryCooldownStore()
    const start = Date.now()
    await store.consume('k', { uses: 3, windowMs: 60_000 })
    vi.advanceTimersByTime(50_000)
    await store.consume('k', { uses: 3, windowMs: 60_000 })

    store.sweep(start + 61_000)
    expect(store.size).toBe(1)
    store.sweep(start + 50_000 + 60_000 - 1)
    expect(store.size).toBe(1)
    store.sweep(start + 50_000 + 60_000)
    expect(store.size).toBe(0)
  })

  it('runs one sweeper however many keys it counts', async () => {
    const store = new MemoryCooldownStore()
    const before = vi.getTimerCount()

    for (const key of ['a', 'b', 'c']) await store.consume(key, { uses: 1, windowMs: 1_000 })

    expect(vi.getTimerCount()).toBe(before + 1)
  })
})
