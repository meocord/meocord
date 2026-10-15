import { ChatInputCommandInteraction, type GuildBan, type GuildMember } from 'discord.js'
import { vi } from 'vitest'
import {
  Catch,
  Command,
  Controller,
  Cooldown,
  Defer,
  Guard,
  Interceptor,
  MeoCord,
  On,
  Pipe,
  Service,
  UseFilter,
  UseGuard,
  UseInterceptor,
  UsePipe,
  Validate,
} from '@src/decorator/index.js'
import { CommandType, MetadataKey } from '@src/enum/index.js'
import {
  type CallHandler,
  type ExceptionFilter,
  type GuardInterface,
  type InterceptorInterface,
  type PipeInterface,
} from '@src/interface/index.js'
import { createChatInputOptions, createMockInteraction, createMockMember, inspectHandler, MeoCordTestingModule } from '@src/testing/index.js'

const log: string[] = []

function logGuard(name: string, allow = true) {
  @Guard()
  class LogGuard implements GuardInterface {
    canActivate() {
      log.push(name)
      return allow
    }
  }
  Object.defineProperty(LogGuard, 'name', { value: name })
  return LogGuard
}

const DenyGuard = logGuard('deny', false)
const BaseGuard = logGuard('base guard')
const ChildGuard = logGuard('child guard')

@Interceptor()
class Around implements InterceptorInterface {
  async intercept(_context: unknown, next: CallHandler) {
    log.push('before')
    const result = await next.handle()
    log.push('after')
    return result
  }
}

@Catch()
class Swallow implements ExceptionFilter {
  catch(error: Error) {
    log.push(`caught ${error.message}`)
  }
}

@Pipe()
class Upper implements PipeInterface<string, string> {
  transform(value: string) {
    return value.toUpperCase()
  }
}

const refuseAll = {
  '~standard': { version: 1 as const, vendor: 'spec', validate: () => ({ issues: [{ message: 'refused' }] }) },
}

@Controller()
class Base {
  @Command('guarded', CommandType.SLASH)
  @UseGuard(DenyGuard)
  async guarded(_interaction: ChatInputCommandInteraction) {
    log.push('guarded')
  }

  @Command('cooled', CommandType.SLASH)
  @Cooldown({ seconds: 60 })
  async cooled(_interaction: ChatInputCommandInteraction) {
    log.push('cooled')
  }

  @Command('deferred', CommandType.SLASH)
  @Defer()
  async deferred(interaction: ChatInputCommandInteraction) {
    log.push(`deferred ${interaction.deferred}`)
  }

  @Command('intercepted', CommandType.SLASH)
  @UseInterceptor(Around)
  async intercepted(_interaction: ChatInputCommandInteraction) {
    log.push('intercepted')
  }

  @Command('filtered', CommandType.SLASH)
  @UseFilter(Swallow)
  async filtered(_interaction: ChatInputCommandInteraction) {
    throw new Error('boom')
  }

  @Command('piped', CommandType.SLASH)
  @UsePipe('name', Upper)
  async piped(_interaction: ChatInputCommandInteraction, { name }: { name: string }) {
    log.push(`piped ${name}`)
  }

  @Command('validated', CommandType.SLASH)
  @Validate(refuseAll)
  async validated(_interaction: ChatInputCommandInteraction) {
    log.push('validated')
  }

  @Command('allowed', CommandType.SLASH)
  @UseGuard(BaseGuard)
  async allowed(_interaction: ChatInputCommandInteraction) {
    log.push('base body')
  }
}

@Controller()
class Override extends Base {
  override async guarded(interaction: ChatInputCommandInteraction) {
    log.push('override')
    return super.guarded(interaction)
  }

  override async cooled(interaction: ChatInputCommandInteraction) {
    return super.cooled(interaction)
  }

  override async deferred(interaction: ChatInputCommandInteraction) {
    return super.deferred(interaction)
  }

  override async intercepted(interaction: ChatInputCommandInteraction) {
    return super.intercepted(interaction)
  }

  override async filtered(interaction: ChatInputCommandInteraction) {
    return super.filtered(interaction)
  }

  override async piped(interaction: ChatInputCommandInteraction, params: { name: string }) {
    return super.piped(interaction, params)
  }

  override async validated(interaction: ChatInputCommandInteraction) {
    return super.validated(interaction)
  }

  @UseGuard(ChildGuard)
  override async allowed(interaction: ChatInputCommandInteraction) {
    log.push('override body')
    return super.allowed(interaction)
  }
}

@Controller()
class Redeclared extends Base {
  @Command('guarded', CommandType.SLASH)
  override async guarded(interaction: ChatInputCommandInteraction) {
    log.push('override')
    return super.guarded(interaction)
  }
}

@Controller()
class Grandchild extends Override {}

const slash = (commandName: string) =>
  createMockInteraction(ChatInputCommandInteraction, {
    commandName,
    user: { id: 'ada' } as never,
    options: createChatInputOptions({ name: 'bob' }) as never,
  })

const moduleOf = async (controller: new () => object) => {
  const module = MeoCordTestingModule.create({ controllers: [controller] }).compile()
  await module.init()
  return module
}

beforeEach(() => {
  log.length = 0
})

describe('an override without decorators keeps the method-level stages of the method it overrides', () => {
  it.each([
    ['guarded', ['deny']],
    ['cooled', ['cooled']],
    ['deferred', ['deferred true']],
    ['intercepted', ['before', 'intercepted', 'after']],
    ['filtered', ['caught boom']],
    ['piped', ['piped BOB']],
    ['validated', []],
  ])('%s', async (command, expected) => {
    const module = await moduleOf(Override)

    await module.dispatch(slash(command))
    // A second call from the same user, which the cooldown refuses
    if (command === 'cooled') await module.dispatch(slash(command))

    expect(log).toEqual(expected)
  })

  it('lists them in inspectHandler', () => {
    expect(inspectHandler(Override, 'guarded').guards).toEqual([DenyGuard])
    expect(inspectHandler(Override, 'cooled').cooldowns).toHaveLength(1)
    expect(inspectHandler(Override, 'intercepted').interceptors).toEqual([Around])
    expect(inspectHandler(Override, 'filtered').filters).toEqual([Swallow])
  })

  it('runs them on a direct call, before the override', async () => {
    const module = await moduleOf(Override)

    await module.get(Override).guarded(slash('guarded'))

    expect(log).toEqual(['deny'])
  })

  it('keeps them on a class that extends the override', async () => {
    const module = await moduleOf(Grandchild)

    await module.dispatch(slash('guarded'))

    expect(log).toEqual(['deny'])
  })

  it('keeps them when the override declares the route again', async () => {
    const module = await moduleOf(Redeclared)

    await module.dispatch(slash('guarded'))

    expect(log).toEqual(['deny'])
  })
})

describe('an override with guards of its own', () => {
  it('runs the base method guards, then its own, each once', async () => {
    const module = await moduleOf(Override)

    await module.dispatch(slash('allowed'))

    expect(log).toEqual(['base guard', 'child guard', 'override body', 'base body'])
  })

  it('runs each once on a direct call', async () => {
    const module = await moduleOf(Override)

    await module.get(Override).allowed(slash('allowed'))

    expect(log).toEqual(['base guard', 'child guard', 'override body', 'base body'])
  })
})

describe('the pass a guarded call gives its wrappers', () => {
  @Controller()
  class Delayed {
    waiting: (() => void)[] = []
    later?: () => Promise<unknown>

    release() {
      for (const resolve of this.waiting.splice(0)) resolve()
    }

    @Command('slow', CommandType.SLASH)
    @UseGuard(BaseGuard)
    async slow(interaction: ChatInputCommandInteraction) {
      log.push('slow')
      this.later = () => this.slow(interaction)
      await new Promise<void>(resolve => this.waiting.push(resolve))
    }
  }

  it('does not let a concurrent direct call with the same interaction through', async () => {
    const module = await moduleOf(Delayed)
    const controller = module.get(Delayed)
    const interaction = slash('slow')

    const dispatched = module.dispatch(interaction)
    await vi.waitFor(() => expect(log).toEqual(['base guard', 'slow']))
    const direct = controller.slow(interaction)
    await vi.waitFor(() => expect(log).toEqual(['base guard', 'slow', 'base guard', 'slow']))
    controller.release()
    await Promise.all([dispatched, direct])
  })

  it('closes when the call returns, so a call it leaves for later runs its guards', async () => {
    const module = await moduleOf(Delayed)
    const controller = module.get(Delayed)

    const dispatched = module.dispatch(slash('slow'))
    await vi.waitFor(() => expect(log).toEqual(['base guard', 'slow']))
    controller.release()
    await dispatched

    const later = controller.later!()
    await vi.waitFor(() => expect(log).toEqual(['base guard', 'slow', 'base guard', 'slow']))
    controller.release()
    await later
  })

  @Controller()
  class SelfCalling {
    calls = 0

    @Command('again', CommandType.SLASH)
    @UseGuard(BaseGuard)
    async again(interaction: ChatInputCommandInteraction) {
      log.push('again')
      if (++this.calls === 1) await this.again(interaction)
    }
  }

  it('lets a handler that calls itself with the same interaction through only after its guards run again', async () => {
    const module = await moduleOf(SelfCalling)

    await module.get(SelfCalling).again(slash('again'))

    expect(log).toEqual(['base guard', 'again', 'base guard', 'again'])
  })

  @Controller()
  class Rerouting extends Base {
    mode: 'reroute' | 'later' = 'reroute'
    later?: Promise<unknown>

    @UseGuard(ChildGuard)
    override async allowed(interaction: ChatInputCommandInteraction) {
      log.push('override body')
      if (this.mode === 'reroute') return super.allowed(slash('other'))
      // Called again later, outside the call that ran the guards
      this.later = new Promise(resolve => setTimeout(() => resolve(super.allowed(interaction)), 0))
    }
  }

  it('belongs to its interaction, so super called with another runs the guards for it', async () => {
    const module = await moduleOf(Rerouting)

    await module.dispatch(slash('allowed'))

    expect(log).toEqual(['base guard', 'child guard', 'override body', 'base guard', 'child guard', 'base body'])
  })

  it('closes when the call returns, so super called after it runs the guards', async () => {
    const module = await moduleOf(Rerouting)
    module.get(Rerouting).mode = 'later'

    await module.dispatch(slash('allowed'))
    await module.get(Rerouting).later

    expect(log).toEqual(['base guard', 'child guard', 'override body', 'base guard', 'child guard', 'base body'])
  })
})

describe('a service that overrides a guarded event handler', () => {
  @Service()
  class Greeter {
    @On('guildMemberAdd')
    @UseGuard(DenyGuard)
    async joined(_member: GuildMember) {
      log.push('greeted')
    }
  }

  @Service()
  class LoudGreeter extends Greeter {
    override async joined(member: GuildMember) {
      log.push('override')
      return super.joined(member)
    }
  }

  @MeoCord({ controllers: [], services: [LoudGreeter], clientOptions: { intents: [] } })
  class App {}

  it('runs the base method guard on a direct call, before the override, as emit does', async () => {
    const module = await MeoCordTestingModule.fromApp(App).compile().init()

    await module.emit('guildMemberAdd', createMockMember())
    await module.get(LoudGreeter).joined(createMockMember())

    expect(log).toEqual(['deny', 'deny'])
  })
})

describe('a service whose base has a class-level guard', () => {
  @Service()
  @UseGuard(DenyGuard)
  class Moderation {
    @On('guildBanAdd')
    async banned(_ban: GuildBan) {
      log.push('banned')
    }
  }

  @Service()
  class LoudModeration extends Moderation {
    override async banned(ban: GuildBan) {
      log.push('override')
      return super.banned(ban)
    }
  }

  // Overrides it in a class the app doesn't run itself, which another extends
  class QuietModeration extends Moderation {
    override async banned(ban: GuildBan) {
      log.push('quiet override')
      return super.banned(ban)
    }
  }

  @Service()
  class LatestModeration extends QuietModeration {}

  @MeoCord({ controllers: [], services: [LoudModeration, LatestModeration], clientOptions: { intents: [] } })
  class App {}

  it('runs the base class guard on a direct call to an override, as emit does', async () => {
    const module = await MeoCordTestingModule.fromApp(App).compile().init()

    await module.get(LoudModeration).banned({} as GuildBan)
    await module.get(LatestModeration).banned({} as GuildBan)

    expect(log).toEqual(['deny', 'deny'])
  })
})

describe("a class's own handlers and its base's class-level guards", () => {
  @Controller()
  @UseGuard(BaseGuard)
  class Staff {}

  @Controller()
  class Roster extends Staff {
    @Command('roster', CommandType.SLASH)
    async roster(_interaction: ChatInputCommandInteraction) {
      log.push('roster')
    }
  }

  it('publishes the guards once, however many modules are made from the class', async () => {
    await moduleOf(Roster)
    await moduleOf(Roster)

    expect(Reflect.getMetadata(MetadataKey.Guards, Roster.prototype, 'roster')).toEqual([BaseGuard])
  })
})

describe('the guards published under MetadataKey.Guards for an override', () => {
  @Controller()
  @UseGuard(DenyGuard)
  class Bans {
    @On('guildBanAdd')
    @UseGuard(BaseGuard)
    async banned(_ban: GuildBan) {}
  }

  @Controller()
  class LoggedBans extends Bans {
    override async banned(ban: GuildBan) {
      return super.banned(ban)
    }
  }

  it.each([
    ['without decorators, under a base class guard', LoggedBans, 'banned'],
    ['without decorators', Override, 'guarded'],
    ['with guards of its own', Override, 'allowed'],
  ] as const)('are the ones that run, %s', (_name, controller, method) => {
    expect(Reflect.getMetadata(MetadataKey.Guards, controller.prototype, method)).toEqual(
      inspectHandler(controller as new () => object, method as never).guards,
    )
  })
})
