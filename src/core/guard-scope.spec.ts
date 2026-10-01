import { Container } from 'inversify'
import { AutocompleteInteraction, ButtonInteraction, ChatInputCommandInteraction, Message } from 'discord.js'
import { vi } from 'vitest'
import { Autocomplete, Command, Controller, Guard, MeoCord, MessageHandler, UseGuard } from '@src/decorator/index.js'
import { CommandType, MetadataKey } from '@src/enum/index.js'
import { type GuardInterface } from '@src/interface/index.js'
import { MeoCordApp } from '@src/core/meocord.app.js'
import { appStages, bindGlobalStages } from '@src/core/handler-pipeline.js'
import { ExecutionContext } from '@src/common/index.js'
import {
  createChatInputOptions,
  createMockInteraction,
  createMockMessage,
  inspectHandler,
  MeoCordTestingModule,
} from '@src/testing/index.js'

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

const BaseClassGuard = logGuard('base class')
const BaseMethodGuard = logGuard('base method')
const ChildGuard = logGuard('child')
const GrandchildGuard = logGuard('grandchild')
const DenyGuard = logGuard('deny', false)

@Controller()
@UseGuard(BaseClassGuard)
class BaseController {
  @Command('ping', CommandType.SLASH)
  @UseGuard(BaseMethodGuard)
  async ping(_interaction: ChatInputCommandInteraction) {
    log.push('ping')
  }

  @Command('open/{id}', CommandType.BUTTON)
  async open(_interaction: ButtonInteraction, { id }: { id: string }) {
    log.push(`open:${id}`)
  }

  @MessageHandler('hello')
  async hello(_message: Message) {
    log.push('hello')
  }
}

@Controller()
@UseGuard(ChildGuard)
class ChildController extends BaseController {
  @Command('own', CommandType.SLASH)
  async own(_interaction: ChatInputCommandInteraction) {
    log.push('own')
  }
}

@Controller()
@UseGuard(GrandchildGuard)
class GrandchildController extends ChildController {}

@Controller()
@UseGuard(DenyGuard)
class DenyingChildController extends BaseController {}

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

async function startApp(controller: new () => object, app?: new () => unknown) {
  const container = new Container()
  container.bind(controller).toSelf().inSingletonScope()
  Reflect.defineMetadata(MetadataKey.Container, container, controller)
  if (app) bindGlobalStages(container, appStages(app))
  const client = createClient()
  await new MeoCordApp([controller], container, client as any, 'token').start()
  return { container, client }
}

const slash = (commandName: string) => {
  const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName })
  interaction.options = createChatInputOptions({})
  return interaction
}

describe('class-level @UseGuard on inherited handlers', () => {
  beforeEach(() => {
    log.length = 0
  })

  it('guards an inherited handler under dispatch, base guards first', async () => {
    const { client } = await startApp(ChildController)

    await client.emit('interactionCreate', slash('ping'))
    expect(log).toEqual(['base class', 'child', 'base method', 'ping'])
  })

  it('guards inherited component and message handlers', async () => {
    const { client } = await startApp(ChildController)

    await client.emit('interactionCreate', createMockInteraction(ButtonInteraction, { customId: 'open/7' }))
    const message = createMockMessage()
    Object.assign(message, { content: 'hello' })
    Object.assign(message.author, { bot: false })
    await client.emit('messageCreate', message)

    expect(log).toEqual(['base class', 'child', 'open:7', 'base class', 'child', 'hello'])
  })

  it('stops an inherited handler when the subclass guard denies, after the base guards', async () => {
    const { client } = await startApp(DenyingChildController)

    await client.emit('interactionCreate', slash('ping'))
    expect(log).toEqual(['base class', 'deny'])
  })

  it('applies every level of a deeper hierarchy, outermost class first', async () => {
    const { client } = await startApp(GrandchildController)

    await client.emit('interactionCreate', slash('own'))
    await client.emit('interactionCreate', slash('ping'))

    expect(log).toEqual(['base class', 'child', 'grandchild', 'own', 'base class', 'child', 'grandchild', 'base method', 'ping'])
  })

  it('runs the same guards, once each, on a direct call and under invoke', async () => {
    const module = MeoCordTestingModule.create({ controllers: [ChildController] }).compile()

    await module.get(ChildController).ping(slash('ping'))
    await module.invoke(ChildController, 'ping', slash('ping'))

    const run = ['base class', 'child', 'base method', 'ping']
    expect(log).toEqual([...run, ...run])
  })

  it('leaves the base controller guarded as before', async () => {
    const { client } = await startApp(BaseController)

    await client.emit('interactionCreate', slash('ping'))
    expect(log).toEqual(['base class', 'base method', 'ping'])
  })

  it('reports the guards in the order they run', () => {
    expect(inspectHandler(ChildController, 'ping').guards).toEqual([BaseClassGuard, ChildGuard, BaseMethodGuard])
    expect(inspectHandler(BaseController, 'ping').guards).toEqual([BaseClassGuard, BaseMethodGuard])
    expect(Reflect.getMetadata(MetadataKey.Guards, GrandchildController.prototype, 'open')).toEqual([
      BaseClassGuard,
      ChildGuard,
      GrandchildGuard,
    ])
  })
})

const GlobalGuard = logGuard('global')

@Guard()
class GlobalContextGuard implements GuardInterface {
  constructor(private readonly context: ExecutionContext) {}

  // Set per use with { provide: GlobalContextGuard, params: { label } }
  label = ''

  canActivate() {
    log.push(`${this.label}:${this.context.getHandlerName()}:${this.context.getParams()?.label}`)
    return true
  }
}

@MeoCord({
  controllers: [BaseController],
  clientOptions: { intents: [] },
  guards: [GlobalGuard, { provide: GlobalContextGuard, params: { label: 'ctx' } }],
})
class GuardedApp {}

@MeoCord({ controllers: [BaseController], clientOptions: { intents: [] }, guards: [DenyGuard, GlobalGuard] })
class DenyingApp {}

describe('global guards from @MeoCord({ guards })', () => {
  beforeEach(() => {
    log.length = 0
  })

  it('run before class and method guards under dispatch', async () => {
    const { client } = await startApp(BaseController, GuardedApp)

    await client.emit('interactionCreate', slash('ping'))
    expect(log).toEqual(['global', 'ctx:ping:ctx', 'base class', 'base method', 'ping'])
  })

  it('run for message handlers too', async () => {
    const { client } = await startApp(BaseController, GuardedApp)
    const message = createMockMessage()
    Object.assign(message, { content: 'hello' })
    Object.assign(message.author, { bot: false })

    await client.emit('messageCreate', message)
    expect(log).toEqual(['global', 'ctx:hello:ctx', 'base class', 'hello'])
  })

  it('stop the handler, and every later guard, when one denies', async () => {
    const { client } = await startApp(BaseController, DenyingApp)

    await client.emit('interactionCreate', slash('ping'))
    expect(log).toEqual(['deny'])
  })

  it('do not run on a direct call, which runs only the method\'s own guards', async () => {
    const module = MeoCordTestingModule.create({ app: GuardedApp, controllers: [BaseController] }).compile()

    await module.get(BaseController).ping(slash('ping'))
    expect(log).toEqual(['base class', 'base method', 'ping'])
  })

  it('run under invoke when the testing module is given the app', async () => {
    const module = MeoCordTestingModule.create({ app: GuardedApp, controllers: [BaseController] }).compile()

    await module.invoke(BaseController, 'ping', slash('ping'))
    expect(log).toEqual(['global', 'ctx:ping:ctx', 'base class', 'base method', 'ping'])
  })

  it('honour overrideGuard stubs under invoke', async () => {
    const options = { app: DenyingApp, controllers: [BaseController] }
    const denied = MeoCordTestingModule.create(options).compile()
    const overridden = MeoCordTestingModule.create(options)
      .overrideGuard(DenyGuard)
      .useValue({ canActivate: () => true })
      .compile()

    expect((await denied.invoke(BaseController, 'ping', slash('ping'))).ran).toBe(false)
    expect((await overridden.invoke(BaseController, 'ping', slash('ping'))).ran).toBe(true)
  })

  it('are reported first by inspectHandler given the app', () => {
    expect(inspectHandler(BaseController, 'ping', { app: GuardedApp }).guards).toEqual([
      GlobalGuard,
      { provide: GlobalContextGuard, params: { label: 'ctx' } },
      BaseClassGuard,
      BaseMethodGuard,
    ])
    expect(inspectHandler(BaseController, 'ping').guards).toEqual([BaseClassGuard, BaseMethodGuard])
  })

  it('require the app to be decorated with @MeoCord', () => {
    class PlainApp {}

    expect(() => MeoCordTestingModule.create({ app: PlainApp }).compile()).toThrow(
      'PlainApp: not decorated with @MeoCord().',
    )
    expect(() => inspectHandler(BaseController, 'ping', { app: PlainApp })).toThrow('PlainApp: not decorated')
  })
})

@Guard()
class TypeGuard implements GuardInterface {
  constructor(private readonly context: ExecutionContext) {}

  canActivate() {
    log.push(`type:${this.context.getType()}`)
    return true
  }
}

@Controller()
@UseGuard(TypeGuard)
class SearchController {
  @Autocomplete('search', 'query')
  async complete(interaction: AutocompleteInteraction) {
    log.push('complete')
    await interaction.respond([{ name: 'a', value: 'a' }])
  }
}

@Controller()
@UseGuard(ChildGuard)
class ChildSearchController extends SearchController {}

@Controller()
@UseGuard(DenyGuard)
class DeniedSearchController extends SearchController {}

const autocomplete = () => {
  const interaction = createMockInteraction(AutocompleteInteraction, { commandName: 'search' })
  interaction.options = createChatInputOptions({ focused: 'query', query: 'a' })
  return interaction
}

describe('class-level @UseGuard on autocomplete handlers', () => {
  beforeEach(() => {
    log.length = 0
  })

  it('runs class guards, which see the autocomplete type', async () => {
    const { client } = await startApp(SearchController)

    await client.emit('interactionCreate', autocomplete())
    expect(log).toEqual(['type:autocomplete', 'complete'])
  })

  it('covers inherited autocomplete handlers, base guards first', async () => {
    const { client } = await startApp(ChildSearchController)

    await client.emit('interactionCreate', autocomplete())
    expect(log).toEqual(['type:autocomplete', 'child', 'complete'])
    expect(inspectHandler(ChildSearchController, 'complete').guards).toEqual([TypeGuard, ChildGuard])
  })

  it('closes the menu with an empty list when a guard denies', async () => {
    const { client } = await startApp(DeniedSearchController)
    const interaction = autocomplete()

    await client.emit('interactionCreate', interaction)

    expect(log).toEqual(['type:autocomplete', 'deny'])
    expect(interaction.respond).toHaveBeenCalledWith([])
  })

  it('runs them on a direct call and under invoke', async () => {
    const module = MeoCordTestingModule.create({ controllers: [SearchController] }).compile()

    await module.get(SearchController).complete(autocomplete())
    await module.invoke(SearchController, 'complete', autocomplete())

    expect(log).toEqual(['type:autocomplete', 'complete', 'type:autocomplete', 'complete'])
  })
})
