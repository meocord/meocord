import { ChatInputCommandInteraction } from 'discord.js'
import { Command, Controller, Interceptor, UseInterceptor } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { type CallHandler, type InterceptorInterface } from '@src/interface/index.js'
import { createMockInteraction, MeoCordTestingModule } from '@src/testing/index.js'

describe('class interceptors a controller inherits', () => {
  it('come from every class in the chain, unless the declaring class opts out', async () => {
    const log: string[] = []

    @Interceptor()
    class Outer implements InterceptorInterface {
      intercept(_context: unknown, next: CallHandler) {
        log.push('grandparent interceptor')
        return next.handle()
      }
    }

    @UseInterceptor(Outer)
    class Grandparent {}

    @Controller()
    class Parent extends Grandparent {
      @Command('plain', CommandType.SLASH)
      async plain(_interaction: ChatInputCommandInteraction) {
        log.push('handler')
      }
    }

    @Controller({ inheritStages: false })
    class Standalone extends Grandparent {
      @Command('alone', CommandType.SLASH)
      async alone(_interaction: ChatInputCommandInteraction) {
        log.push('alone')
      }
    }

    const module = MeoCordTestingModule.create({ controllers: [Parent, Standalone] }).compile()
    await module.invoke(Parent, 'plain', createMockInteraction(ChatInputCommandInteraction))
    await module.invoke(Standalone, 'alone', createMockInteraction(ChatInputCommandInteraction))

    expect(log).toEqual(['grandparent interceptor', 'handler', 'alone'])
  })
})
