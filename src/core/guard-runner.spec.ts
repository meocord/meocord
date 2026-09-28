import { Container, injectable } from 'inversify'
import { ChatInputCommandInteraction, Message } from 'discord.js'
import { vi } from 'vitest'
import { Command, Controller, Guard, MessageHandler, Service, UseGuard } from '@src/decorator/index.js'
import { CommandType, MetadataKey } from '@src/enum/index.js'
import { type GuardInterface } from '@src/interface/index.js'
import { createMetadata } from '@src/common/metadata.js'
import { ExecutionContext } from '@src/common/execution-context.js'
import { MeoCordApp } from '@src/core/meocord.app.js'
import { createChatInputOptions, createMockInteraction, createMockMessage, MeoCordTestingModule } from '@src/testing/index.js'

const log: string[] = []
const Label = createMetadata<string>('label')

@Guard()
class AllowA implements GuardInterface {
  canActivate() {
    log.push('A')
    return true
  }
}

@Guard()
class AllowB implements GuardInterface {
  canActivate() {
    log.push('B')
    return true
  }
}

@Guard()
class Deny implements GuardInterface {
  canActivate() {
    log.push('deny')
    return false
  }
}

@Guard()
class ContextGuard implements GuardInterface {
  constructor(private readonly context: ExecutionContext) {}

  canActivate() {
    log.push(`context:${this.context.get(Label)}:${this.context.getHandlerName()}:${this.context.getParams()?.min}`)
    return true
  }
}

@injectable()
class ContextReader {
  constructor(readonly context: ExecutionContext) {}
}

@Guard()
class TransitiveGuard implements GuardInterface {
  constructor(private readonly reader: ContextReader) {}

  canActivate() {
    log.push(`transitive:${this.reader.context.getHandlerName()}`)
    return true
  }
}

/** A user decorator that answers without calling the method it wraps. */
function SkipsHandler(): MethodDecorator {
  return (_target, _key, descriptor: PropertyDescriptor) => {
    descriptor.value = async () => log.push('skipped')
  }
}

@Controller()
@UseGuard(AllowA)
class GuardedController {
  @Command('stacked', CommandType.SLASH)
  @UseGuard(AllowA)
  @UseGuard(AllowB)
  async stacked(_interaction: ChatInputCommandInteraction) {
    log.push('stacked')
  }

  @Command('outer', CommandType.SLASH)
  async outer(interaction: ChatInputCommandInteraction) {
    log.push('outer')
    await this.inner(interaction)
  }

  @UseGuard(Deny)
  async inner(_interaction: ChatInputCommandInteraction) {
    log.push('inner')
  }

  @Command('context', CommandType.SLASH)
  @Label('method label')
  @UseGuard({ provide: ContextGuard, params: { min: 1 } }, TransitiveGuard)
  async context(_interaction: ChatInputCommandInteraction) {
    log.push('context')
  }

  @MessageHandler('hi')
  @UseGuard(AllowB)
  async hi(_message: Message) {
    log.push('hi')
  }

  @MessageHandler('skip')
  @UseGuard(AllowB)
  @SkipsHandler()
  @UseGuard(AllowA)
  async skip(_message: Message) {
    log.push('skip')
  }
}

@Controller()
class DenyingController {
  @Command('denied', CommandType.SLASH)
  @UseGuard(AllowA, Deny, AllowB)
  async denied(_interaction: ChatInputCommandInteraction) {
    log.push('denied')
  }
}

function createClient() {
  const listeners = new Map<string, ((...args: any[]) => Promise<void>)[]>()
  return {
    on: vi.fn((event: string, handler: (...args: any[]) => Promise<void>) => {
      listeners.set(event, [...(listeners.get(event) ?? []), handler])
    }),
    login: vi.fn().mockResolvedValue('token'),
    user: { setActivity: vi.fn() },
    application: null,
    emit: (event: string, ...args: unknown[]) => Promise.all((listeners.get(event) ?? []).map(h => h(...args))),
  }
}

async function startApp() {
  const container = new Container()
  const controllers: (new () => object)[] = [GuardedController, DenyingController]
  for (const controller of controllers) {
    container.bind(controller).toSelf().inSingletonScope()
    Reflect.defineMetadata(MetadataKey.Container, container, controller)
  }
  const client = createClient()
  await new MeoCordApp(controllers, container, client as any, 'token').start()
  return { container, client }
}

const slash = (commandName: string) => {
  const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName })
  interaction.options = createChatInputOptions({})
  return interaction
}

describe('guards under dispatch', () => {
  beforeEach(() => {
    log.length = 0
  })

  it('runs each guard of stacked @UseGuard once, class guards first', async () => {
    const { client } = await startApp()
    await client.emit('interactionCreate', slash('stacked'))

    expect(log).toEqual(['A', 'A', 'B', 'stacked'])
  })

  it('stops at the first guard that denies, without running the handler', async () => {
    const { client } = await startApp()
    await client.emit('interactionCreate', slash('denied'))

    expect(log).toEqual(['A', 'deny'])
  })

  it('runs the guards of a guarded method the handler calls directly', async () => {
    const { client } = await startApp()
    await client.emit('interactionCreate', slash('outer'))

    expect(log).toEqual(['A', 'outer', 'deny'])
  })

  it('runs the guards again when a cached message is later passed to a direct call', async () => {
    const { client, container } = await startApp()
    const message = createMockMessage()
    Object.assign(message, { content: 'hi' })
    Object.assign(message.author, { bot: false })

    await client.emit('messageCreate', message)
    expect(log).toEqual(['A', 'B', 'hi'])

    log.length = 0
    await container.get(GuardedController).hi(message)
    expect(log).toEqual(['A', 'B', 'hi'])
  })

  it('clears passes that a wrapper never took, so a later direct call runs every guard', async () => {
    const { client, container } = await startApp()
    const message = createMockMessage()
    Object.assign(message, { content: 'skip' })
    Object.assign(message.author, { bot: false })

    await client.emit('messageCreate', message)
    expect(log).toEqual(['A', 'B', 'A', 'skipped'])

    // A direct call runs the chain dispatch runs, so the guards below the skipping decorator run too
    log.length = 0
    await container.get(GuardedController).skip(message)
    expect(log).toEqual(['A', 'B', 'A', 'skipped'])
  })

  it('injects the call context into guards that ask for it, without binding them in the root', async () => {
    const { client, container } = await startApp()
    await client.emit('interactionCreate', slash('context'))

    expect(log).toEqual(['A', 'context:method label:context:1', 'transitive:context', 'context'])
    expect(container.isBound(ContextGuard)).toBe(false)
    expect(container.isBound(ContextReader)).toBe(false)
  })

  it('gives concurrent calls their own context', async () => {
    const seen: unknown[] = []
    let release!: () => void
    const gate = new Promise<void>(resolve => (release = resolve))

    @Guard()
    class SlowGuard implements GuardInterface {
      constructor(private readonly context: ExecutionContext) {}

      async canActivate() {
        await gate
        seen.push(this.context.getInteraction())
        return true
      }
    }

    @Controller()
    class SlowController {
      @Command('slow', CommandType.SLASH)
      @UseGuard(SlowGuard)
      async slow(_interaction: ChatInputCommandInteraction) {}
    }

    const container = new Container()
    container.bind(SlowController).toSelf().inSingletonScope()
    Reflect.defineMetadata(MetadataKey.Container, container, SlowController)
    const client = createClient()
    await new MeoCordApp([SlowController], container, client as any, 'token').start()

    const [first, second] = [slash('slow'), slash('slow')]
    const running = Promise.all([client.emit('interactionCreate', first), client.emit('interactionCreate', second)])
    release()
    await running

    expect(seen).toHaveLength(2)
    expect(seen[0]).toBe(first)
    expect(seen[1]).toBe(second)
  })
})

describe('guards on a direct call', () => {
  beforeEach(() => {
    log.length = 0
  })

  it('run as in 4.0, with the call context available to guards that inject it', async () => {
    const module = MeoCordTestingModule.create({ controllers: [GuardedController] }).compile()
    const controller = module.get(GuardedController)

    await controller.context(slash('context'))
    expect(log).toEqual(['A', 'context:method label:context:1', 'transitive:context', 'context'])
  })

  it('honour overrideGuard stubs', async () => {
    const module = MeoCordTestingModule.create({ controllers: [DenyingController] })
      .overrideGuard(Deny)
      .useValue({ canActivate: () => true })
      .compile()

    await module.get(DenyingController).denied(slash('denied'))
    expect(log).toEqual(['A', 'B', 'denied'])
  })
})

describe('classes shared across calls', () => {
  it('cannot inject ExecutionContext', () => {
    @Service()
    class ContextService {
      constructor(readonly context: ExecutionContext) {}
    }

    @Controller()
    class UsesContextService {
      constructor(readonly service: ContextService) {}
    }

    @Controller()
    class InjectsContext {
      constructor(readonly context: ExecutionContext) {}
    }

    expect(() => MeoCordTestingModule.create({ controllers: [UsesContextService] }).compile()).toThrow(
      'ContextService: resolved once and shared, so it cannot inject ExecutionContext',
    )
    expect(() => MeoCordTestingModule.create({ controllers: [InjectsContext] }).compile()).toThrow(
      'InjectsContext: resolved once and shared',
    )
  })
})
