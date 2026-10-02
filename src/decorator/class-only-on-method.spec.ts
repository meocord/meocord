import { vi } from 'vitest'
import { applyDecorators } from '@src/common/index.js'
import { forgetDeprecationWarnings } from '@src/common/deprecation.js'
import { Logger } from '@src/common/logger.js'
import { Catch, CommandBuilder, Controller, Guard, Interceptor, MeoCord, Observer, Pipe, Service } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { isRefusal } from '@src/util/refusal.util.js'

const warnings = () => vi.mocked(Logger.prototype.warn).mock.calls.map(([line]) => String(line))

beforeEach(() => {
  forgetDeprecationWarnings()
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

const vias = ['directly', 'through applyDecorators'] as const

/** Applies a decorator to `Shop.buy`, directly or through `applyDecorators`, as `@decorator` above the method does. */
function onBuy(decorator: unknown, via: (typeof vias)[number]): object {
  const applied = (via === 'directly' ? decorator : applyDecorators(decorator as ClassDecorator)) as MethodDecorator
  class Shop {
    buy() {}
  }
  applied(Shop.prototype, 'buy', Object.getOwnPropertyDescriptor(Shop.prototype, 'buy')!)
  return Shop.prototype
}

describe('a decorator new in 4.1 that goes only on a class, applied to a method', () => {
  const classOnly: [string, () => unknown][] = [
    ['@Interceptor', () => Interceptor()],
    ['@Catch', () => Catch(Error)],
    ['@Pipe', () => Pipe()],
    ['@Observer', () => Observer()],
  ]

  it.each(classOnly.flatMap(([name, make]) => vias.map(via => [name, via, make] as const)))(
    'refuses %s applied %s, naming the method',
    (name, via, make) => {
      let thrown: unknown
      try {
        onBuy(make(), via)
      } catch (error) {
        thrown = error
      }

      expect((thrown as Error | undefined)?.message).toBe(`Shop.buy: ${name} goes on a class, not on a method.`)
      expect(isRefusal(thrown)).toBe(true)
    },
  )
})

describe('a decorator 4.0 had that goes only on a class, applied to a method', () => {
  const classOnly: [string, () => unknown][] = [
    ['@Service', () => Service()],
    ['@Guard', () => Guard()],
    ['@CommandBuilder', () => CommandBuilder(CommandType.SLASH)],
    ['@MeoCord', () => MeoCord({ controllers: [], clientOptions: { intents: [] } })],
    ['@Controller', () => Controller()],
  ]

  // 4.0 let it pass doing nothing, so a bot that starts with it keeps starting
  it.each(classOnly.flatMap(([name, make]) => vias.map(via => [name, via, make] as const)))(
    'applies nothing to %s applied %s, and warns once that 5.0 refuses it',
    (name, via, make) => {
      const prototype = onBuy(make(), via)
      onBuy(make(), via)

      expect(Reflect.getOwnMetadataKeys(prototype)).toEqual([])
      expect(warnings()).toEqual([
        `${name} on the method Shop.buy is deprecated; in the next major version (5.0) it is refused. Use ${name} on a class instead.`,
      ])
    },
  )
})
