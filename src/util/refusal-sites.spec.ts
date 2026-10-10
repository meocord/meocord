import { readdirSync, readFileSync } from 'fs'
import path from 'path'
import { type ChatInputCommandInteraction, type Message } from 'discord.js'
import { Command, Controller, Cooldown, Defer, MessageHandler, On, Validate } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { type StandardSchemaV1 } from '@src/interface/index.js'
import { appStages } from '@src/core/handler-pipeline.js'
import { buildComponentRoutes } from '@src/core/component-routes.js'
import { MeoCordTestingModule } from '@src/testing/index.js'
import { isRefusal } from '@src/util/refusal.util.js'
import { clientOptionsWithSharding } from '@src/util/sharding-mode.util.js'

/** What `load` throws, which fails the test when it throws nothing. */
function thrownBy(load: () => unknown): Error {
  try {
    load()
  } catch (error) {
    return error as Error
  }
  throw new Error('nothing was thrown')
}

const compile = (...controllers: (new (...args: any[]) => unknown)[]) => () => MeoCordTestingModule.create({ controllers }).compile()

describe('an application MeoCord refuses as it loads', () => {
  const anything: StandardSchemaV1 = { '~standard': { version: 1, vendor: 'test', validate: value => ({ value }) } }

  const sameNamedShops = () => {
    const counted = () => {
      @Controller()
      class Shop {
        @Command('buy', CommandType.SLASH)
        @Cooldown({ seconds: 5 })
        async buy(_interaction: ChatInputCommandInteraction) {}
      }
      return Shop
    }
    const plain = () => {
      @Controller()
      class Shop {
        @Command('browse', CommandType.SLASH)
        async browse(_interaction: ChatInputCommandInteraction) {}
      }
      return Shop
    }
    return [counted(), plain()]
  }

  const validatedEvent = () => {
    @Controller()
    class Validated {
      @On('guildCreate')
      async joined(..._args: unknown[]) {}
    }
    Validate(anything)(Validated.prototype, 'joined', Object.getOwnPropertyDescriptor(Validated.prototype, 'joined') as never)
    return Validated
  }

  const limitedEvent = () => {
    @Controller()
    class Limited {
      @On('guildCreate')
      @Cooldown({ seconds: 5 })
      async joined() {}
    }
    return Limited
  }

  // @Defer below the handler's decorator runs first, so the pipeline refuses it once the handler is known
  const deferredMessage = () => {
    @Controller()
    class Deferred {
      @MessageHandler('hi')
      @Defer()
      async hi(_message: Message) {}
    }
    return Deferred
  }

  const overlapping = () => {
    @Controller()
    class Profile {
      @Command('profile/{uid}', CommandType.BUTTON)
      show() {}
    }
    @Controller()
    class Card {
      @Command('profile/{id}', CommandType.BUTTON)
      open() {}
    }
    return [Profile, Card]
  }

  const sharding = (sharding: object) => ({ discordToken: 't', sharding }) as never

  it.each([
    {
      site: 'two same-named classes, one keeping a cooldown under the name',
      load: () => compile(...sameNamedShops())(),
      subject: 'Shop',
    },
    { site: '@Validate on an event handler', load: () => compile(validatedEvent())(), subject: 'Validated.joined' },
    { site: '@Cooldown on an event handler', load: () => compile(limitedEvent())(), subject: 'Limited.joined' },
    { site: '@Defer written below @MessageHandler', load: () => compile(deferredMessage())(), subject: 'Deferred.hi' },
    { site: 'two component patterns that match the same customIds', load: () => buildComponentRoutes(overlapping()), subject: 'Profile.show' },
    { site: 'an app class without @MeoCord', load: () => appStages(class PlainApp {}), subject: 'PlainApp' },
    {
      site: 'client shards with process sharding',
      load: () => clientOptionsWithSharding(sharding({ mode: 'process' }), { intents: [], shardCount: 2 }),
      subject: 'meocord.config.ts',
    },
    {
      site: 'sharding.shards and client shards that disagree',
      load: () => clientOptionsWithSharding(sharding({ mode: 'internal', shards: 4 }), { intents: [], shardCount: 2 }),
      subject: 'meocord.config.ts',
    },
  ])('refuses $site in one line, naming what to change first', ({ load, subject }) => {
    const error = thrownBy(load)

    expect(isRefusal(error)).toBe(true)
    expect(error.message.startsWith(`${subject}: `)).toBe(true)
    expect(error.message).not.toContain('\n')
  })
})

/*
 * Every other `throw new …Error(` under src, by file, and why it is not a refusal: each runs once the bot is
 * up, or reaches a caller that is not a loading application. A new one fails here until it is refused or listed.
 * src/bin, src/build and src/testing are left out: the CLI and a test get the error with its stack.
 */
const NOT_REFUSALS: Record<string, { count: number; why: string }> = {
  'common/redis-cooldown-store.ts': { count: 1, why: "a Redis script's reply, read as a cooldown is taken" },
  'common/response/response-state.ts': { count: 5, why: 'a handler answering its interaction' },
  'common/route.ts': { count: 7, why: 'route().build(), called as a handler builds a customId' },
  'common/sharded-cooldown-store.ts': { count: 1, why: "a cooldown call on a shard whose manager's channel has closed" },
  'core/dispatcher.ts': { count: 1, why: 'an interaction no handler takes' },
  'core/filter-runner.ts': { count: 1, why: 'a filter, resolved as it handles an error' },
  'core/guard-runner.ts': { count: 3, why: 'a guard, resolved as it runs, or a guarded method called on an instance no app made' },
  'core/input-runner.ts': { count: 1, why: 'a pipe, resolved as it runs' },
  'core/interceptor-runner.ts': { count: 1, why: 'an interceptor, resolved as it runs' },
  'core/meocord.app.ts': { count: 1, why: 'start() of an app that was stopped' },
  'core/message-params.ts': { count: 6, why: 'a message whose params do not fit its command, answered with its usage' },
  'core/shard-context.ts': { count: 2, why: 'ShardContext.call, from a handler' },
  'core/shard-manager.ts': { count: 1, why: 'start() of an app that was stopped' },
  'core/startup-checked.ts': { count: 1, why: "a class MeoCord binds that its startup checks never saw: MeoCord's bug, not the app's" },
  'core/message-routes.ts': {
    count: 18,
    why: "a pattern's own mistakes, which buildMessageRoutes refuses with the handler's name; and a test's resolveRoute",
  },
  'decorator/controller.decorator.ts': { count: 1, why: 'an interaction of the wrong type reaching a handler' },
  'util/meocord-cli.util.ts': { count: 3, why: 'the CLI' },
  'util/tsconfig.util.ts': { count: 2, why: 'the CLI' },
}

describe('load-time errors', () => {
  it('are refusals, or listed here with why they are not', () => {
    const src = path.resolve(import.meta.dirname, '..')
    const found: Record<string, number> = {}
    for (const file of readdirSync(src, { recursive: true, encoding: 'utf8' })) {
      const name = file.split(path.sep).join('/')
      if (!name.endsWith('.ts') || /\.(spec|test-d)\.ts$/.test(name) || /^(bin|build|testing)\//.test(name)) continue
      // Code only: a JSDoc @example throws errors a reader's handler might
      const code = readFileSync(path.join(src, file), 'utf8')
        .split('\n')
        .filter(line => !/^\s*(\*|\/\/)/.test(line))
      const count = code.filter(line => /\bthrow new \w*Error\(/.test(line)).length
      if (count > 0) found[name] = count
    }
    expect(found).toEqual(Object.fromEntries(Object.entries(NOT_REFUSALS).map(([name, { count }]) => [name, count])))
  })
})
