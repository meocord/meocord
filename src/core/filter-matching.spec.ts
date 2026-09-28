import { ChatInputCommandInteraction } from 'discord.js'
import { Catch, Command, Controller, UseFilter } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { type ExceptionFilter } from '@src/interface/index.js'
import { createMockInteraction, MeoCordTestingModule } from '@src/testing/index.js'

const caught: string[] = []
beforeEach(() => (caught.length = 0))

class QuotaError extends Error {}
class BannedError extends Error {}

describe('filter matching', () => {
  it('handles an error of any type @Catch names, not only the first', async () => {
    @Catch(QuotaError, BannedError)
    class Account implements ExceptionFilter {
      catch(error: Error) {
        caught.push(error.constructor.name)
      }
    }

    @Controller()
    class AccountController {
      @Command('banned', CommandType.SLASH)
      @UseFilter(Account)
      async banned(_interaction: ChatInputCommandInteraction) {
        throw new BannedError('banned')
      }
    }

    const module = MeoCordTestingModule.create({ controllers: [AccountController] }).compile()
    const { error } = await module.invoke(AccountController, 'banned', createMockInteraction(ChatInputCommandInteraction))

    expect(error).toBeInstanceOf(BannedError)
    expect(caught).toEqual(['BannedError'])
  })

  it('takes class filters from every class in the chain, unless the declaring class opts out', async () => {
    @Catch()
    class Everything implements ExceptionFilter {
      catch() {
        caught.push('grandparent filter')
      }
    }

    @UseFilter(Everything)
    class Grandparent {}

    @Controller()
    class Parent extends Grandparent {
      @Command('fails', CommandType.SLASH)
      async fails(_interaction: ChatInputCommandInteraction) {
        throw new Error('unhandled')
      }
    }

    @Controller({ inheritStages: false })
    class Standalone extends Grandparent {
      @Command('alone', CommandType.SLASH)
      async alone(_interaction: ChatInputCommandInteraction) {
        throw new Error('unhandled')
      }
    }

    const module = MeoCordTestingModule.create({ controllers: [Parent, Standalone] }).compile()

    await expect(module.invoke(Parent, 'fails', createMockInteraction(ChatInputCommandInteraction))).resolves.toMatchObject({ ran: true })
    expect(caught).toEqual(['grandparent filter'])
    await expect(module.invoke(Standalone, 'alone', createMockInteraction(ChatInputCommandInteraction))).rejects.toThrow('unhandled')
  })
})

describe('a misused filter', () => {
  it('without @Catch is refused at startup, even when the class has no name', () => {
    @Controller()
    class AnonymousController {
      @Command('anonymous', CommandType.SLASH)
      @UseFilter(
        class {
          catch() {}
        },
      )
      async anonymous(_interaction: ChatInputCommandInteraction) {}
    }

    expect(() => MeoCordTestingModule.create({ controllers: [AnonymousController] }).compile()).toThrow(
      'A filter: used as an exception filter, but not decorated with @Catch().',
    )
  })

  it('without a catch method rejects with an error naming it', async () => {
    class Hollow {}
    // Applied by hand: @Catch's signature already rejects a class without catch() at compile time.
    Catch()(Hollow as never)

    @Controller()
    class HollowController {
      @Command('hollow', CommandType.SLASH)
      @UseFilter(Hollow as never)
      async hollow(_interaction: ChatInputCommandInteraction) {
        throw new Error('first')
      }
    }

    const module = MeoCordTestingModule.create({ controllers: [HollowController] }).compile()

    await expect(module.invoke(HollowController, 'hollow', createMockInteraction(ChatInputCommandInteraction))).rejects.toThrow(
      'Filter Hollow does not have a valid catch method.',
    )
  })
})
