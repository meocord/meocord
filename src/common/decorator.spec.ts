import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js'
import { applyDecorators, SetMetadata } from '@src/common/index.js'
import { Command, CommandBuilder, Controller, UseGuard, Guard } from '@src/decorator/index.js'
import { getCommandMap } from '@src/decorator/controller.decorator.js'
import { CommandType, MetadataKey } from '@src/enum/index.js'
import { type GuardInterface } from '@src/interface/index.js'
import { createExecutionContext, createMockInteraction, inspectHandler, MeoCordTestingModule } from '@src/testing/index.js'

describe('SetMetadata', () => {
  it.each(['meocord:guards', 'meocord:anything', MetadataKey.Injectable, MetadataKey.ParamTypes])(
    'refuses %s, a key MeoCord or dependency injection keeps its own metadata under',
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

  // 'guards' was a key of MeoCord's own; a 4.0 bot that set it keeps its value, and its guards still run
  it.each(['above', 'below'])("stores 'guards' written %s @UseGuard, and the handler's guards still run", async order => {
    const ran: string[] = []
    @Guard()
    class Audit implements GuardInterface {
      canActivate() {
        ran.push('Audit')
        return true
      }
    }
    @Controller()
    class Shop {
      @Command('buy', CommandType.SLASH)
      @applyDecorators(...(order === 'above' ? [SetMetadata('guards', ['staff']), UseGuard(Audit)] : [UseGuard(Audit), SetMetadata('guards', ['staff'])]))
      async buy(_interaction: ChatInputCommandInteraction) {}
    }
    const module = MeoCordTestingModule.create({ controllers: [Shop] }).compile()

    const { ran: handlerRan } = await module.invoke(Shop, 'buy', createMockInteraction(ChatInputCommandInteraction, { commandName: 'buy' }))

    expect(handlerRan).toBe(true)
    expect(ran).toEqual(['Audit'])
    expect(createExecutionContext(Shop, 'buy').get('guards')).toEqual(['staff'])
  })

  // On a builder class, 'commandType' was the key @CommandBuilder kept the command's type under
  it("stores 'commandType', leaving the type @CommandBuilder gives its builder", () => {
    @SetMetadata('commandType', CommandType.BUTTON)
    @CommandBuilder(CommandType.SLASH)
    class PingBuilder {
      build() {
        return new SlashCommandBuilder().setName('ping').setDescription('Ping')
      }
    }
    @Controller()
    class Pinger {
      @Command('ping', PingBuilder)
      @SetMetadata('commandType', 'mine')
      async ping(_interaction: ChatInputCommandInteraction) {}
    }

    expect(getCommandMap(Pinger.prototype).ping?.[0]?.type).toBe(CommandType.SLASH)
    expect(Reflect.getMetadata('commandType', PingBuilder)).toBe(CommandType.BUTTON)
    expect(createExecutionContext(Pinger, 'ping').get('commandType')).toBe('mine')
  })

  it('stores any other key', () => {
    class Tagged {
      @SetMetadata('audit', true)
      method() {}
    }

    expect(Reflect.getMetadata('audit', Tagged.prototype, 'method')).toBe(true)
  })
})

// MeoCord's own keys, as the framework writes and reads them
describe('MetadataKey', () => {
  it('names the keys MeoCord keeps its guard list, command type and container under', () => {
    @Guard()
    class Allow implements GuardInterface {
      canActivate() {
        return true
      }
    }
    @CommandBuilder(CommandType.SLASH)
    class PingBuilder {
      build() {
        return new SlashCommandBuilder().setName('ping').setDescription('Ping')
      }
    }
    @Controller()
    class Pinger {
      @Command('ping', PingBuilder)
      @UseGuard(Allow)
      async ping(_interaction: ChatInputCommandInteraction) {}
    }
    MeoCordTestingModule.create({ controllers: [Pinger] }).compile()

    expect(Reflect.getMetadata(MetadataKey.Guards, Pinger.prototype, 'ping')).toEqual([Allow])
    expect(Reflect.getMetadata(MetadataKey.CommandType, PingBuilder)).toBe(CommandType.SLASH)
    expect(Reflect.getMetadata(MetadataKey.Container, Pinger)).toBeDefined()
    for (const key of [MetadataKey.Guards, MetadataKey.CommandType, MetadataKey.Container, MetadataKey.AppOptions]) {
      expect(key.startsWith('meocord:')).toBe(true)
    }
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
