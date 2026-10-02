import { Guard, UseGuard } from '@src/decorator/guard.decorator.js'
import { MetadataKey } from '@src/enum/index.js'
import { Container } from 'inversify'
import { type GuardInterface } from '@src/interface/index.js'
import { BaseInteraction, ChatInputCommandInteraction, Message } from 'discord.js'
import { Command } from '@src/decorator/controller.decorator.js'
import { CommandType } from '@src/enum/index.js'
import { createMockInteraction } from '@src/testing/index.js'
import { META } from '@src/util/metadata-keys.js'

function makeFakeInteraction(): BaseInteraction {
  return Object.create(BaseInteraction.prototype) as BaseInteraction
}

function makeFakeMessage(): Message {
  return Object.create(Message.prototype) as Message
}

/** Attach a fresh container (with guards bound) to a controller class. */
function attachContainer(controllerClass: any, ...guardClasses: (new (...args: any[]) => any)[]): Container {
  const container = new Container()
  for (const cls of guardClasses) {
    container.bind(cls).toSelf().inTransientScope()
  }
  Reflect.defineMetadata(MetadataKey.Container, container, controllerClass)
  return container
}

describe('@Guard', () => {
  it('marks the class as inversify-injectable', () => {
    @Guard()
    class TestGuard implements GuardInterface {
      canActivate() {
        return true
      }
    }

    expect(Reflect.getMetadata(MetadataKey.Injectable, TestGuard)).toBe(true)
  })
})

describe('@UseGuard (method decorator)', () => {
  it('allows method execution when guard returns true', async () => {
    @Guard()
    class AllowGuard implements GuardInterface {
      canActivate() {
        return true
      }
    }

    class TestController {
      result = false

      @UseGuard(AllowGuard)
      async handle(_ctx: any) {
        this.result = true
      }
    }

    attachContainer(TestController, AllowGuard)
    const ctrl = new TestController()
    await ctrl.handle(makeFakeInteraction())
    expect(ctrl.result).toBe(true)
  })

  it('blocks method execution when guard returns false', async () => {
    @Guard()
    class DenyGuard implements GuardInterface {
      canActivate() {
        return false
      }
    }

    class TestController {
      result = false

      @UseGuard(DenyGuard)
      async handle(_ctx: any) {
        this.result = true
      }
    }

    attachContainer(TestController, DenyGuard)
    const ctrl = new TestController()
    await ctrl.handle(makeFakeInteraction())
    expect(ctrl.result).toBe(false)
  })

  it('supports async guards', async () => {
    @Guard()
    class AsyncGuard implements GuardInterface {
      async canActivate() {
        return Promise.resolve(true)
      }
    }

    class TestController {
      result = false

      @UseGuard(AsyncGuard)
      async handle(_ctx: any) {
        this.result = true
      }
    }

    attachContainer(TestController, AsyncGuard)
    const ctrl = new TestController()
    await ctrl.handle(makeFakeInteraction())
    expect(ctrl.result).toBe(true)
  })

  // An event handler's first argument can be anything the event carries, such as debug's string
  it('guards a call whose first argument is not a Discord object', async () => {
    const seen: unknown[] = []

    @Guard()
    class TestGuard implements GuardInterface {
      canActivate(first: unknown) {
        seen.push(first)
        return false
      }
    }

    const ran = vi.fn()
    class TestController {
      @UseGuard(TestGuard)
      async handle(_info: string) {
        ran()
      }
    }

    attachContainer(TestController, TestGuard)
    await new TestController().handle('heartbeat acknowledged')

    expect(seen).toEqual(['heartbeat acknowledged'])
    expect(ran).not.toHaveBeenCalled()
  })

  it('injects params into guard when using GuardWithParams', async () => {
    let receivedLimit: number | undefined

    @Guard()
    class ParamGuard implements GuardInterface {
      limit!: number

      canActivate() {
        receivedLimit = this.limit
        return true
      }
    }

    class TestController {
      @UseGuard({ provide: ParamGuard, params: { limit: 5 } })
      async handle(_ctx: any) {}
    }

    attachContainer(TestController, ParamGuard)
    const ctrl = new TestController()
    await ctrl.handle(makeFakeMessage())
    expect(receivedLimit).toBe(5)
  })

  it('runs all guards in order and stops on first denial', async () => {
    const order: string[] = []

    @Guard()
    class FirstGuard implements GuardInterface {
      canActivate() {
        order.push('first')
        return false
      }
    }

    @Guard()
    class SecondGuard implements GuardInterface {
      canActivate() {
        order.push('second')
        return true
      }
    }

    class TestController {
      @UseGuard(FirstGuard, SecondGuard)
      async handle(_ctx: any) {}
    }

    attachContainer(TestController, FirstGuard, SecondGuard)
    const ctrl = new TestController()
    await ctrl.handle(makeFakeInteraction())
    expect(order).toEqual(['first'])
    expect(order).not.toContain('second')
  })
})

describe('@UseGuard metadata', () => {
  const order: string[] = []

  @Guard()
  class ClassGuard implements GuardInterface {
    canActivate() {
      order.push('class')
      return true
    }
  }

  @Guard()
  class OuterGuard implements GuardInterface {
    canActivate() {
      order.push('outer')
      return true
    }
  }

  @Guard()
  class InnerGuard implements GuardInterface {
    canActivate() {
      order.push('inner')
      return true
    }
  }

  @UseGuard(ClassGuard)
  class TestController {
    @Command('ping', CommandType.SLASH)
    @UseGuard(OuterGuard)
    @UseGuard(InnerGuard)
    async ping(_ctx: any) {}
  }

  it('stores class guards before method guards, in the order they run', async () => {
    attachContainer(TestController, ClassGuard, OuterGuard, InnerGuard)
    await new TestController().ping(createMockInteraction(ChatInputCommandInteraction))

    expect(order).toEqual(['class', 'outer', 'inner'])
    expect(Reflect.getMetadata(MetadataKey.Guards, TestController.prototype, 'ping')).toEqual([
      ClassGuard,
      OuterGuard,
      InnerGuard,
    ])
  })

  it('keeps the class and method lists out of the public enum', () => {
    const keys = Reflect.getOwnMetadataKeys(TestController.prototype, 'ping')
    expect(keys).toEqual(expect.arrayContaining([MetadataKey.Guards, META.classGuards, META.methodGuards]))
    const published: string[] = [MetadataKey.Container, MetadataKey.AppOptions, MetadataKey.Guards, MetadataKey.CommandType]
    expect(published).not.toContain(META.classGuards)
    expect(published).not.toContain(META.methodGuards)
  })
})
