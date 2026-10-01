import { vi } from 'vitest'
import { ChatInputCommandInteraction } from 'discord.js'
import { Logger } from '@src/common/logger.js'
import { Catch, Command, Controller, Guard, UseFilter, UseGuard } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { type ExceptionFilter, type GuardInterface } from '@src/interface/index.js'
import { createMockInteraction, MeoCordTestingModule } from '@src/testing/index.js'

const warnings = () => vi.mocked(Logger.prototype.warn).mock.calls.map(([line]) => String(line))

beforeEach(() => {
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('a stage class and the method its decorator runs', () => {
  // The method is checked on the instance the call resolves, where a property set in the constructor counts too
  it('runs a guard whose canActivate is an arrow-function property, with no warning', async () => {
    @Guard()
    class Open implements GuardInterface {
      canActivate = () => true
    }
    @Controller()
    class Doors {
      @Command('open', CommandType.SLASH)
      @UseGuard(Open)
      async open() {}
    }
    const module = MeoCordTestingModule.create({ controllers: [Doors] }).compile()

    const { ran } = await module.invoke(Doors, 'open', createMockInteraction(ChatInputCommandInteraction))

    expect(ran).toBe(true)
    expect(warnings()).toEqual([])
  })

  it('fails a call to a guard with no canActivate, naming the guard and the handler', async () => {
    @Guard()
    class Empty {}
    @Controller()
    class Doors {
      @Command('open', CommandType.SLASH)
      @UseGuard(Empty as never)
      async open() {}
    }
    const module = MeoCordTestingModule.create({ controllers: [Doors] }).compile()

    await expect(module.invoke(Doors, 'open', createMockInteraction(ChatInputCommandInteraction))).rejects.toThrow(
      'Guard Empty applied to open does not have a valid canActivate method.',
    )
  })
})

describe('@Catch given something that is not an error class', () => {
  it('warns as it applies, naming the filter and the position', () => {
    @Catch(undefined as never, Error)
    class Broken implements ExceptionFilter {
      catch() {}
    }
    void Broken

    expect(warnings()).toEqual([
      "Broken: @Catch's first entry, undefined, which matches no error, is deprecated; in the next major version (5.0) " +
        'it is refused. Use an error class, such as @Catch(CooldownError), instead.',
    ])
  })

  it('names an entry past the fifth by its number', () => {
    @Catch(Error, Error, Error, Error, Error, undefined as never)
    class Sixth implements ExceptionFilter {
      catch() {}
    }
    void Sixth

    expect(warnings()).toEqual([expect.stringMatching(/^Sixth: @Catch's entry 6, undefined, which matches no error, is deprecated/)])
  })

  it('matches by the classes it was given, so the handler error is reported as thrown', async () => {
    class StockError extends Error {}
    const caught: unknown[] = []
    @Catch(undefined as never, StockError)
    class Stock implements ExceptionFilter {
      catch(error: unknown) {
        caught.push(error)
      }
    }
    @Catch(undefined as never)
    class Nothing implements ExceptionFilter {
      catch(error: unknown) {
        caught.push(error)
      }
    }
    const thrown = new StockError('out of stock')
    const other = new Error('unrelated')
    @Controller()
    class ShopController {
      @Command('buy', CommandType.SLASH)
      @UseFilter(Nothing, Stock)
      async buy() {
        throw thrown
      }

      @Command('sell', CommandType.SLASH)
      @UseFilter(Nothing)
      async sell() {
        throw other
      }
    }
    const module = MeoCordTestingModule.create({ controllers: [ShopController] }).compile()

    const bought = await module.invoke(ShopController, 'buy', createMockInteraction(ChatInputCommandInteraction))

    expect(caught).toEqual([thrown])
    expect(bought.error).toBe(thrown)
    // No filter matches, so invoke rejects with the handler's own error rather than one from the matching
    await expect(module.invoke(ShopController, 'sell', createMockInteraction(ChatInputCommandInteraction))).rejects.toBe(other)
  })
})
