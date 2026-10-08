import 'reflect-metadata'
import { vi } from 'vitest'
import { type ChatInputCommandInteraction } from 'discord.js'
import { ExecutionContext } from '@src/common/execution-context.js'
import { Logger } from '@src/common/logger.js'
import { MeoCordFactory } from '@src/core/meocord-factory.js'
import { Command, Controller, MeoCord, MessageHandler, Service } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { MeoCordTestingModule } from '@src/testing/index.js'
import { META } from '@src/util/metadata-keys.js'

const state = vi.hoisted(() => ({ clients: 0, config: { discordToken: 'token' } as Record<string, unknown> }))
// Counts the Clients made, which a failed create() makes none of
vi.mock('discord.js', async original => {
  const actual = await original<typeof import('discord.js')>()
  class CountedClient extends actual.Client {
    constructor(...args: ConstructorParameters<typeof actual.Client>) {
      super(...args)
      state.clients++
    }
  }
  return { ...actual, Client: CountedClient }
})
vi.mock('@src/util/meocord-config-loader.util.js', () => ({ loadMeoCordConfig: () => state.config }))
vi.mock('@src/util/platform.util.js', () => ({ assertBuiltForThisPlatform: () => {} }))

let warned: string[]
let exit: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  warned = []
  state.clients = 0
  vi.spyOn(Logger.prototype, 'warn').mockImplementation((text: unknown) => void warned.push(String(text)))
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {})
  // A shard that fails to start ends its process, after telling its manager
  exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  state.config = { discordToken: 'token' }
})

// A class the app injects without decorating it, bound by the checks and stamped only once they pass
class Helper {}

const ctxService = () => {
  @Service()
  class Ctx {
    constructor(readonly context: ExecutionContext) {}
  }
  Reflect.defineMetadata('design:paramtypes', [ExecutionContext], Ctx)
  return Ctx
}

const sameNamed = () => {
  const make = (command: string) => {
    @Controller()
    class Dup {
      constructor(readonly helper: Helper) {}

      @MessageHandler(command)
      async run() {}
    }
    Reflect.defineMetadata('design:paramtypes', [Helper], Dup)
    return Dup
  }
  return [make('first'), make('second')]
}

/**
 * Each way create() or compile() fails, with the classes it must leave as they were. Message handlers need no builder,
 * so the warnings create() gives of the declarations, before its checks, stay out of what is compared.
 */
const failures: { name: string; classes: () => object[]; run: (classes: object[]) => unknown; sharded?: boolean }[] = [
  {
    name: 'create(): a service that injects ExecutionContext',
    classes: () => {
      const Ctx = ctxService()
      @Controller()
      class Ping {
        @MessageHandler('ping')
        async ping() {}
      }
      return [Ping, Ctx]
    },
    run: ([Ping, Ctx]) => {
      @MeoCord({ controllers: [Ping as never], services: [Ctx as never], clientOptions: { intents: [] }, messages: { help: true } })
      class App {}
      return MeoCordFactory.create(App)
    },
  },
  {
    name: 'create(): two classes of one name under process sharding',
    sharded: true,
    classes: sameNamed,
    run: controllers => {
      @MeoCord({ controllers: controllers as never, clientOptions: { intents: [] }, messages: { help: true } })
      class App {}
      return MeoCordFactory.create(App)
    },
  },
  {
    name: 'create(): a message pattern that cannot be read',
    classes: () => {
      @Controller()
      class Chat {
        constructor(readonly helper: Helper) {}

        @MessageHandler('baka {rest...} {x}')
        async baka() {}
      }
      Reflect.defineMetadata('design:paramtypes', [Helper], Chat)
      return [Chat]
    },
    run: controllers => {
      @MeoCord({ controllers: controllers as never, clientOptions: { intents: [] }, messages: { help: true } })
      class App {}
      return MeoCordFactory.create(App)
    },
  },
  {
    name: 'compile(): a service that injects ExecutionContext',
    classes: () => {
      const Ctx = ctxService()
      @Controller()
      class Ping {
        constructor(readonly ctx: InstanceType<typeof Ctx>) {}

        @Command('ping', CommandType.SLASH)
        async ping(_interaction: ChatInputCommandInteraction) {}
      }
      Reflect.defineMetadata('design:paramtypes', [Ctx], Ping)
      return [Ping, Ctx]
    },
    run: ([Ping]) => MeoCordTestingModule.create({ controllers: [Ping as never] }).compile(),
  },
  {
    name: 'compile(): a message pattern that cannot be read',
    classes: () => {
      @Controller()
      class Chat {
        constructor(readonly helper: Helper) {}

        @MessageHandler('baka {rest...} {x}')
        async baka() {}
      }
      Reflect.defineMetadata('design:paramtypes', [Helper], Chat)
      return [Chat]
    },
    run: controllers => MeoCordTestingModule.create({ controllers: controllers as never }).compile(),
  },
]

describe('a create() or compile() that fails its startup checks', () => {
  it.each(failures)('changes nothing outside what it threw away: $name', async ({ classes, run, sharded }) => {
    if (sharded) {
      state.config = { discordToken: 'token', sharding: { mode: 'process' } }
      vi.stubEnv('SHARDING_MANAGER', 'true')
    }
    const made = classes()

    expect(() => run(made)).toThrow()
    if (sharded) await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1))

    expect(state.clients).toBe(0)
    expect([...made, Helper].map(cls => Reflect.hasOwnMetadata(META.container, cls))).toEqual([...made, Helper].map(() => false))
    expect(warned).toEqual([])
  })
})
