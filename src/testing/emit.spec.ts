import { type GuildMember } from 'discord.js'
import { vi } from 'vitest'
import { Controller, Guard, MeoCord, On, Once, Service, UseGuard } from '@src/decorator/index.js'
import { type GuardInterface } from '@src/interface/index.js'
import { createMock, MeoCordTestingModule } from '@src/testing/index.js'
import { GuardDeniedError, UserError } from '@src/common/index.js'

describe('TestingModule.emit', () => {
  it('runs the handlers on controllers, class providers and their dependencies', async () => {
    const greeted: string[] = []

    @Service()
    class Audit {
      @On('guildMemberAdd')
      record(member: GuildMember) {
        greeted.push(`audit ${member.id}`)
      }
    }

    @Service()
    class Welcome {
      constructor(readonly audit: Audit) {}
      @On('guildMemberAdd')
      greet(member: GuildMember) {
        greeted.push(`welcome ${member.id}`)
      }
    }

    @Controller()
    class Members {
      constructor(readonly welcome: Welcome) {}
      @On('guildMemberAdd')
      count(member: GuildMember) {
        greeted.push(`members ${member.id}`)
      }
    }

    @Service()
    class Standalone {
      @On('guildMemberAdd')
      note(member: GuildMember) {
        greeted.push(`standalone ${member.id}`)
      }
    }

    const module = MeoCordTestingModule.create({
      controllers: [Members],
      providers: [{ provide: Standalone, useClass: Standalone }],
    }).compile()

    const { ran } = await module.emit('guildMemberAdd', createMock<GuildMember>({ id: '42' }))

    expect(ran).toBe(4)
    expect(greeted.sort()).toEqual(['audit 42', 'members 42', 'standalone 42', 'welcome 42'])
  })

  it('runs an @Once handler for the first event only', async () => {
    const warm = vi.fn()

    @Controller()
    class Warmup {
      @Once('clientReady')
      warm() {
        warm()
      }
    }

    const module = MeoCordTestingModule.create({ controllers: [Warmup] }).compile()
    const client = createMock<any>()

    expect((await module.emit('clientReady', client)).ran).toBe(1)
    expect((await module.emit('clientReady', client)).ran).toBe(0)
    expect(warm).toHaveBeenCalledTimes(1)
  })

  it('runs the app guards and the handler guards, and does not count a denied handler', async () => {
    const order: string[] = []

    @Guard()
    class GlobalGuard implements GuardInterface {
      canActivate() {
        order.push('global')
        return true
      }
    }

    @Guard()
    class Deny implements GuardInterface {
      canActivate() {
        order.push('deny')
        return false
      }
    }

    @Controller()
    class Members {
      @On('guildMemberAdd')
      @UseGuard(Deny)
      greet() {
        order.push('handler')
      }
    }

    @MeoCord({ controllers: [], guards: [GlobalGuard], clientOptions: { intents: [] } })
    class App {}

    const module = MeoCordTestingModule.create({ app: App, controllers: [Members] }).compile()
    const { ran } = await module.emit('guildMemberAdd', createMock<GuildMember>())

    expect(ran).toBe(0)
    expect(order).toEqual(['global', 'deny'])
  })

  it('rejects with the error when one handler throws, after the others have run', async () => {
    const ran = vi.fn()

    @Controller()
    class Members {
      @On('guildMemberAdd')
      fail() {
        throw new Error('boom')
      }
      @On('guildMemberAdd')
      greet() {
        ran()
      }
    }

    const module = MeoCordTestingModule.create({ controllers: [Members] }).compile()

    await expect(module.emit('guildMemberAdd', createMock<GuildMember>())).rejects.toThrow('boom')
    expect(ran).toHaveBeenCalled()
  })

  it('rejects with an AggregateError when several handlers throw', async () => {
    @Controller()
    class Members {
      @On('guildMemberAdd')
      first() {
        throw new Error('one')
      }
      @On('guildMemberAdd')
      second() {
        throw new Error('two')
      }
    }

    const module = MeoCordTestingModule.create({ controllers: [Members] }).compile()
    const error = await module.emit('guildMemberAdd', createMock<GuildMember>()).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(AggregateError)
    expect((error as AggregateError).errors.map(e => (e as Error).message)).toEqual(['one', 'two'])
  })

  // The bot's event fallback, which skips a refused event and answers a UserError, isn't run by emit
  it.each([
    ["a guard's GuardDeniedError", new GuardDeniedError('no events for you')],
    ["a handler's UserError", new UserError('slow down')],
  ])('rejects with %s, as with any error', async (_, error) => {
    @Guard()
    class Refuse implements GuardInterface {
      canActivate() {
        if (error instanceof GuardDeniedError) throw error
        return true
      }
    }

    @Controller()
    class Members {
      @On('guildMemberAdd')
      @UseGuard(Refuse)
      greet() {
        throw error
      }
    }

    const module = MeoCordTestingModule.create({ controllers: [Members] }).compile()

    await expect(module.emit('guildMemberAdd', createMock<GuildMember>())).rejects.toBe(error)
  })

  it('runs no handler for an event nothing handles', async () => {
    @Controller()
    class Members {
      @On('guildMemberAdd')
      greet() {}
    }

    const module = MeoCordTestingModule.create({ controllers: [Members] }).compile()

    expect(await module.emit('guildMemberRemove', createMock<GuildMember>())).toEqual({ ran: 0 })
  })

  // As in an app, where one class failing to resolve leaves the other listeners running
  it('runs the other handlers when a class cannot be resolved, then rejects with its error', async () => {
    const ran = vi.fn()

    @Controller()
    class Broken {
      constructor() {
        throw new Error('no database')
      }
      @Once('guildMemberAdd')
      greet() {}
    }

    @Controller()
    class Members {
      @On('guildMemberAdd')
      greet() {
        ran()
      }
    }

    const module = MeoCordTestingModule.create({ controllers: [Broken, Members] }).compile()

    await expect(module.emit('guildMemberAdd', createMock<GuildMember>())).rejects.toThrow('no database')
    expect(ran).toHaveBeenCalled()
  })
})
