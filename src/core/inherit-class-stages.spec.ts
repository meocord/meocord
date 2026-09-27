import { ButtonInteraction, ChatInputCommandInteraction } from 'discord.js'
import { type ExecutionContext } from '@src/common/index.js'
import { Catch, Command, Controller, Cooldown, Guard, Interceptor, UseFilter, UseGuard, UseInterceptor } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { type CallHandler, type ExceptionFilter, type GuardInterface, type InterceptorInterface } from '@src/interface/index.js'
import { createMockInteraction, inspectHandler, MeoCordTestingModule } from '@src/testing/index.js'

/** What ran, in order: guards, interceptors and filters record their class name here. */
const ran: string[] = []

function guard(name: string, allow = true) {
  @Guard()
  class Recorded implements GuardInterface {
    canActivate() {
      ran.push(name)
      return allow
    }
  }
  Object.defineProperty(Recorded, 'name', { value: name })
  return Recorded
}

function interceptor(name: string) {
  @Interceptor()
  class Recorded implements InterceptorInterface {
    intercept(_context: ExecutionContext, next: CallHandler) {
      ran.push(name)
      return next.handle()
    }
  }
  Object.defineProperty(Recorded, 'name', { value: name })
  return Recorded
}

function filter(name: string) {
  @Catch()
  class Recorded implements ExceptionFilter {
    catch() {
      ran.push(name)
    }
  }
  Object.defineProperty(Recorded, 'name', { value: name })
  return Recorded
}

const click = (customId: string) => createMockInteraction(ButtonInteraction, { customId })

beforeEach(() => {
  ran.length = 0
})

describe('class stages declared on a base controller', () => {
  const StaffOnly = guard('StaffOnly', false)
  const Tag = interceptor('Tag')
  const Report = filter('Report')

  @Controller()
  @UseGuard(StaffOnly)
  abstract class GuardedBase {}

  @Controller()
  @UseInterceptor(Tag)
  abstract class TaggedBase {}

  @Controller()
  @UseFilter(Report)
  abstract class ReportedBase {}

  @Controller()
  @Cooldown({ seconds: 60 })
  abstract class LimitedBase {}

  @Controller()
  class Ban extends GuardedBase {
    @Command('ban/{id}', CommandType.BUTTON)
    async ban(_interaction: ButtonInteraction) {
      ran.push('ban')
    }
  }

  @Controller()
  class Tagged extends TaggedBase {
    @Command('tagged/{id}', CommandType.BUTTON)
    async run(_interaction: ButtonInteraction) {
      ran.push('run')
    }
  }

  @Controller()
  class Reported extends ReportedBase {
    @Command('reported/{id}', CommandType.BUTTON)
    async fail(_interaction: ButtonInteraction) {
      throw new Error('boom')
    }
  }

  @Controller()
  class Limited extends LimitedBase {
    @Command('limited', CommandType.SLASH)
    async daily(_interaction: ChatInputCommandInteraction) {
      ran.push('daily')
    }
  }

  const module = MeoCordTestingModule.create({ controllers: [Ban, Tagged, Reported, Limited] }).compile()

  it("guard the subclass's own handlers, dispatched and called directly", async () => {
    await expect(module.invoke(Ban, 'ban', click('ban/1'))).resolves.toEqual({ ran: false })
    expect(ran).toEqual(['StaffOnly'])

    ran.length = 0
    await module.get(Ban).ban(click('ban/1'))
    expect(ran).toEqual(['StaffOnly'])
    expect(inspectHandler(Ban, 'ban').guards).toEqual([StaffOnly])
  })

  it("wrap the subclass's own handlers with their interceptors", async () => {
    await module.invoke(Tagged, 'run', click('tagged/1'))
    expect(ran).toEqual(['Tag', 'run'])
    expect(inspectHandler(Tagged, 'run').interceptors).toEqual([Tag])
  })

  it("catch the subclass's own handlers' errors with their filters", async () => {
    const result = await module.invoke(Reported, 'fail', click('reported/1'))
    expect(result).toMatchObject({ ran: true, error: expect.any(Error) })
    expect(ran).toEqual(['Report'])
    expect(inspectHandler(Reported, 'fail').filters).toEqual([Report])
  })

  it("count the subclass's own handlers against their cooldowns", async () => {
    const call = () => createMockInteraction(ChatInputCommandInteraction, { commandName: 'limited', user: { id: '1' } as never })
    await module.invoke(Limited, 'daily', call())
    await expect(module.invoke(Limited, 'daily', call())).rejects.toThrow(/try again/)
    expect(inspectHandler(Limited, 'daily').cooldowns).toHaveLength(1)
  })
})

describe('the order of class stages across levels', () => {
  const [RootGuard, MiddleGuard, LeafGuard, MethodGuard] = ['RootGuard', 'MiddleGuard', 'LeafGuard', 'MethodGuard'].map(name =>
    guard(name),
  )
  const [RootTag, MiddleTag, LeafTag] = ['RootTag', 'MiddleTag', 'LeafTag'].map(interceptor)
  const [RootReport, LeafReport] = ['RootReport', 'LeafReport'].map(filter)

  @Controller()
  @UseGuard(RootGuard)
  @UseInterceptor(RootTag)
  @UseFilter(RootReport)
  class Root {
    @Command('root/{id}', CommandType.BUTTON)
    async inherited(_interaction: ButtonInteraction) {
      ran.push('inherited')
    }
  }

  @Controller()
  @UseGuard(MiddleGuard)
  @UseInterceptor(MiddleTag)
  class Middle extends Root {}

  @Controller()
  @UseGuard(LeafGuard)
  @UseInterceptor(LeafTag)
  @UseFilter(LeafReport)
  class Leaf extends Middle {
    @Command('leaf/{id}', CommandType.BUTTON)
    @UseGuard(MethodGuard)
    async own(_interaction: ButtonInteraction) {
      ran.push('own')
    }

    @Command('fails/{id}', CommandType.BUTTON)
    async fails(_interaction: ButtonInteraction) {
      throw new Error('boom')
    }
  }

  const module = MeoCordTestingModule.create({ controllers: [Leaf] }).compile()

  it("runs a handler's class stages subclass first, through every base, then the method's", async () => {
    await module.invoke(Leaf, 'own', click('leaf/1'))
    expect(ran).toEqual(['LeafGuard', 'MiddleGuard', 'RootGuard', 'MethodGuard', 'LeafTag', 'MiddleTag', 'RootTag', 'own'])
  })

  it('gives a handler declared on a base the same chain, as it had', async () => {
    await module.invoke(Leaf, 'inherited', click('root/1'))
    expect(ran).toEqual(['LeafGuard', 'MiddleGuard', 'RootGuard', 'LeafTag', 'MiddleTag', 'RootTag', 'inherited'])
  })

  it("tries class filters innermost first, a base's before its subclass's, as for an inherited handler", async () => {
    expect(inspectHandler(Leaf, 'fails').filters).toEqual([RootReport, LeafReport])
    expect(inspectHandler(Leaf, 'inherited').filters).toEqual([RootReport, LeafReport])
  })

  it('lists the resolved chain in inspectHandler', () => {
    expect(inspectHandler(Leaf, 'own').guards).toEqual([LeafGuard, MiddleGuard, RootGuard, MethodGuard])
    expect(inspectHandler(Leaf, 'own').interceptors).toEqual([LeafTag, MiddleTag, RootTag])
  })
})

describe('@Controller({ inheritStages: false })', () => {
  const BaseGuard = guard('BaseGuard')
  const OwnGuard = guard('OwnGuard')

  @Controller()
  @UseGuard(BaseGuard)
  class Base {
    @Command('base/{id}', CommandType.BUTTON)
    async inherited(_interaction: ButtonInteraction) {
      ran.push('inherited')
    }
  }

  @Controller({ inheritStages: false })
  @UseGuard(OwnGuard)
  class Standalone extends Base {
    @Command('standalone/{id}', CommandType.BUTTON)
    async own(_interaction: ButtonInteraction) {
      ran.push('own')
    }
  }

  @Controller()
  class BelowStandalone extends Standalone {
    @Command('below/{id}', CommandType.BUTTON)
    async deeper(_interaction: ButtonInteraction) {
      ran.push('deeper')
    }
  }

  // Both inherit base/{id}, so the bot would take only one of them: each gets its own module
  const module = MeoCordTestingModule.create({ controllers: [Standalone] }).compile()
  const below = MeoCordTestingModule.create({ controllers: [BelowStandalone] }).compile()

  it("gives the subclass's own handlers only its own class and method stages", async () => {
    await module.invoke(Standalone, 'own', click('standalone/1'))
    expect(ran).toEqual(['OwnGuard', 'own'])

    ran.length = 0
    await module.get(Standalone).own(click('standalone/1'))
    expect(ran).toEqual(['OwnGuard', 'own'])
  })

  it('leaves inherited handlers their base stages', async () => {
    await module.invoke(Standalone, 'inherited', click('base/1'))
    expect(ran).toEqual(['OwnGuard', 'BaseGuard', 'inherited'])
  })

  it('stops a further subclass at the class that opted out', async () => {
    await below.invoke(BelowStandalone, 'deeper', click('below/1'))
    expect(ran).toEqual(['OwnGuard', 'deeper'])
  })
})
