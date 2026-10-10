import { type MessageReaction, type User } from 'discord.js'
import { ChatInputCommandInteraction } from 'discord.js'
import { Command, Controller, Guard, Interceptor, ReactionHandler, UseGuard, UseInterceptor } from '@src/decorator/index.js'
import { CommandType, ReactionHandlerAction } from '@src/enum/index.js'
import { type CallHandler, type GuardInterface, type InterceptorInterface } from '@src/interface/index.js'
import { type ReactionEvent } from '@src/interface/index.js'
import { Logger } from '@src/common/logger.js'
import { forgetStrictMocks, useStrictMocks } from './strict-mocks.js'
import { createMock, createMockUser, MeoCordTestingModule } from './index.js'

const starred: string[] = []

@Controller()
class Stars {
  @ReactionHandler('⭐')
  async star(_reaction: MessageReaction, event: ReactionEvent) {
    starred.push(event.user.id)
  }

  @ReactionHandler('👀')
  async glance(_reaction: MessageReaction, _event: ReactionEvent) {
    starred.push('glance')
  }
}

@Guard()
class Allow implements GuardInterface {
  canActivate() {
    return true
  }
}

@Interceptor()
class Through implements InterceptorInterface {
  intercept(_context: unknown, next: CallHandler) {
    return next.handle()
  }
}

// The stages a reaction handler can stack; @UseGuard wraps the method, which would hide the arguments it takes
@Controller()
class Staged {
  @ReactionHandler('🔒')
  @UseGuard(Allow)
  async guarded(_reaction: MessageReaction, _event: ReactionEvent) {}

  @ReactionHandler('🔁')
  @UseInterceptor(Through)
  async intercepted(_reaction: MessageReaction, _event: ReactionEvent) {}

  @ReactionHandler('🧊')
  @UseGuard(Allow)
  @UseInterceptor(Through)
  @UseGuard(Allow)
  async stacked(_reaction: MessageReaction, _event: ReactionEvent) {}

  @Command('ping', CommandType.SLASH)
  @UseGuard(Allow)
  async ping(_interaction: ChatInputCommandInteraction) {}
}

const TAKES_TWO = 'Stars.glance takes 2 arguments, and invoke was given 1: pass its ReactionEvent after the reaction, as { user, action }.'

let warned: string[]
beforeEach(() => {
  forgetStrictMocks()
  starred.length = 0
  warned = []
  vi.spyOn(Logger.prototype, 'warn').mockImplementation((text: unknown) => void warned.push(String(text)))
})
afterEach(() => vi.restoreAllMocks())
afterAll(() => forgetStrictMocks())

const reaction = () => createMock<MessageReaction>({ emoji: { name: '👀' } as never })

describe('invoke given a reaction without its ReactionEvent', () => {
  it('warns once, naming what to pass, and calls the handler as before', async () => {
    const module = MeoCordTestingModule.create({ controllers: [Stars] }).compile()

    await module.invoke(Stars, 'glance', reaction())
    await module.invoke(Stars, 'glance', reaction())

    expect(starred).toEqual(['glance', 'glance'])
    expect(warned).toEqual([TAKES_TWO])
  })

  it('refuses it under useStrictMocks(), before the handler runs', async () => {
    useStrictMocks()
    const module = MeoCordTestingModule.create({ controllers: [Stars] }).compile()

    await expect(module.invoke(Stars, 'glance', reaction())).rejects.toThrow(TAKES_TWO)
    expect(starred).toEqual([])
  })

  it('takes the reaction and its event, in either mode, without a word', async () => {
    useStrictMocks()
    const module = MeoCordTestingModule.create({ controllers: [Stars] }).compile()
    const user = createMockUser({ id: '200000000000000001' }) as unknown as User

    await module.invoke(Stars, 'star', reaction(), { user, action: ReactionHandlerAction.ADD })

    expect(starred).toEqual(['200000000000000001'])
    expect(warned).toEqual([])
  })
})

describe('a handler behind the stages that wrap it', () => {
  it('keeps the length and name it was declared with', () => {
    const prototype = Staged.prototype as unknown as Record<string, (...args: unknown[]) => unknown>

    expect(['guarded', 'intercepted', 'stacked', 'ping'].map(name => [prototype[name]!.name, prototype[name]!.length])).toEqual([
      ['guarded', 2],
      ['intercepted', 2],
      ['stacked', 2],
      ['ping', 1],
    ])
  })

  it.each(['guarded', 'intercepted', 'stacked'] as const)('is refused given a reaction alone when %s, under useStrictMocks()', async method => {
    useStrictMocks()
    const module = MeoCordTestingModule.create({ controllers: [Staged] }).compile()

    await expect(module.invoke(Staged, method, reaction())).rejects.toThrow(`Staged.${method} takes 2 arguments, and invoke was given 1`)
  })

  it.each(['guarded', 'intercepted', 'stacked'] as const)('is warned about given a reaction alone when %s, by default', async method => {
    const module = MeoCordTestingModule.create({ controllers: [Staged] }).compile()

    await module.invoke(Staged, method, reaction())

    expect(warned).toEqual([expect.stringContaining(`Staged.${method} takes 2 arguments, and invoke was given 1`)])
  })
})
