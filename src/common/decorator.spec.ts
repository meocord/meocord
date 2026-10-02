import { type ChatInputCommandInteraction } from 'discord.js'
import { applyDecorators, SetMetadata } from '@src/common/index.js'
import { Command, Controller, UseGuard, Guard } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { type GuardInterface } from '@src/interface/index.js'
import { inspectHandler } from '@src/testing/index.js'

describe('SetMetadata', () => {
  it.each(['guards', 'commandType', 'design:paramtypes', 'inversify:container', 'meocord:app-options', '@inversifyjs/core/classIsInjectableFlagReflectKey'])(
    'refuses the key MeoCord keeps its own metadata under, %s',
    key => {
      const applied = () => {
        @SetMetadata(key, [])
        class Shop {}
        return Shop
      }
      expect(applied).toThrow(`Shop: SetMetadata cannot use the key "${key}"`)
      expect(applied).toThrow('createMetadata')
    },
  )

  // Written above @UseGuard, a value under 'guards' would replace the list dispatch reads, so the guard would never run
  it('cannot empty the guards a handler runs', () => {
    @Guard()
    class Deny implements GuardInterface {
      canActivate() {
        return false
      }
    }

    expect(() => {
      class Controller {
        @SetMetadata('guards', [])
        @UseGuard(Deny)
        async ping() {}
      }
      return Controller
    }).toThrow('SetMetadata cannot use the key "guards"')
  })

  it('stores any other key', () => {
    class Tagged {
      @SetMetadata('audit', true)
      method() {}
    }

    expect(Reflect.getMetadata('audit', Tagged.prototype, 'method')).toBe(true)
  })
})

describe('applyDecorators', () => {
  @Guard()
  class First implements GuardInterface {
    canActivate() {
      return true
    }
  }
  @Guard()
  class Second implements GuardInterface {
    canActivate() {
      return true
    }
  }
  const guardNames = <C extends new () => unknown>(Class: C, method: keyof InstanceType<C> & string) =>
    inspectHandler(Class, method).guards.map(entry => ('provide' in entry ? entry.provide : entry).name)

  it('applies its decorators as they apply stacked, the first written outermost', () => {
    @Controller()
    class Shop {
      @Command('stacked', CommandType.SLASH)
      @UseGuard(First)
      @UseGuard(Second)
      async stacked(_interaction: ChatInputCommandInteraction) {}

      @Command('composed', CommandType.SLASH)
      @applyDecorators(UseGuard(First), UseGuard(Second))
      async composed(_interaction: ChatInputCommandInteraction) {}
    }

    expect(guardNames(Shop, 'composed')).toEqual(['First', 'Second'])
    expect(guardNames(Shop, 'composed')).toEqual(guardNames(Shop, 'stacked'))
  })

  // A decorator that wraps a method or a class returns the replacement, as TypeScript uses it when stacked
  it('passes on the descriptor or class a decorator returns, to the next decorator and to TypeScript', () => {
    const calls: string[] = []
    const wrap =
      (label: string): MethodDecorator =>
      <T>(_target: object, _key: string | symbol, descriptor: TypedPropertyDescriptor<T>) => {
        const inner = descriptor.value as () => string
        return { ...descriptor, value: (() => `${label}(${inner()})`) as T }
      }
    const subclass: ClassDecorator = target => {
      calls.push((target as unknown as { name: string }).name)
      return class extends (target as unknown as new () => object) {
        replaced = true
      } as never
    }

    @applyDecorators(subclass)
    class Service {
      @applyDecorators(wrap('outer'), wrap('inner'))
      name() {
        return 'plain'
      }
    }

    expect(new Service().name()).toBe('outer(inner(plain))')
    expect((new Service() as { replaced?: boolean }).replaced).toBe(true)
    expect(calls).toEqual(['Service'])
  })
})
