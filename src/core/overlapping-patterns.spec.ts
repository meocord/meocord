import { vi } from 'vitest'
import { Logger } from '@src/common/logger.js'
import { MeoCordFactory } from '@src/core/meocord-factory.js'
import { Command, Controller, MeoCord } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { type MeoCordConfig } from '@src/interface/index.js'
import { MeoCordTestingModule } from '@src/testing/index.js'

const { config } = vi.hoisted(() => ({ config: { current: { discordToken: 'token' } as MeoCordConfig } }))
vi.mock('@src/util/meocord-config-loader.util.js', () => ({ loadMeoCordConfig: () => config.current }))
vi.mock('@src/util/platform.util.js', () => ({ assertBuiltForThisPlatform: () => {} }))

let warned: string[]
beforeEach(() => {
  warned = []
  vi.spyOn(Logger.prototype, 'warn').mockImplementation((...args: unknown[]) => void warned.push(args.map(String).join(' ')))
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  config.current = { discordToken: 'token' }
})

const create = (controllers: (new () => unknown)[]) => {
  @MeoCord({ controllers, clientOptions: { intents: [] } })
  class App {}
  MeoCordFactory.create(App)
}

/** Every warning about patterns that can match the same customId. */
const overlapWarnings = () => warned.filter(line => line.includes('can match the same customId'))
/** The pair lines of the one overlap warning. */
const pairLines = () => overlapWarnings()[0]?.split('\n').filter(line => line.startsWith('  '))

// `t/{a:on|off}` and `t/{b:off|no}` both take `t/off`, and the ranking has nothing to tell them apart by, so the
// order they are listed in settles it. Saying so at startup beats letting one of them quietly win every click.
describe('patterns that can match the same customId', () => {
  const pair = () => {
    @Controller()
    class OnOff {
      @Command('t/{a:on|off}', CommandType.BUTTON)
      onOff() {}

      @Command('a/{x}/c', CommandType.BUTTON)
      xc() {}
    }
    @Controller()
    class OffNo {
      @Command('t/{b:off|no}', CommandType.BUTTON)
      offNo() {}

      @Command('a/b/{y}', CommandType.BUTTON)
      by() {}
    }
    @Controller()
    class Both {
      @Command('t/{a:on|off}', CommandType.BUTTON)
      onOff() {}

      @Command('t/{b:off|no}', CommandType.BUTTON)
      offNo() {}
    }
    return { OnOff, OffNo, Both }
  }

  it.each([
    ['OnOff listed first', ['OnOff', 'OffNo'], '  "t/{a:on|off}"  vs  "t/{b:off|no}", which both match "t/off": OnOff.onOff runs, as its controller is listed first.'],
    ['OffNo listed first', ['OffNo', 'OnOff'], '  "t/{b:off|no}"  vs  "t/{a:on|off}", which both match "t/off": OffNo.offNo runs, as its controller is listed first.'],
    ['both in one controller', ['Both'], '  "t/{a:on|off}"  vs  "t/{b:off|no}", which both match "t/off": Both.onOff runs, as it is declared first.'],
  ] as const)('names an id both match and the handler that runs, and only for a tied pair: %s', (_order, listed, line) => {
    const controllers = pair()
    create(listed.map(name => controllers[name]))

    expect(pairLines()).toEqual([line])
  })

  it('is one message: how many pairs, a line for each, and what to do', () => {
    const { Both } = pair()

    create([Both])

    expect(overlapWarnings()).toEqual([
      '1 pattern pair(s) rank equally and can match the same customId, so the order they are listed in decides which ' +
        'one runs:\n' +
        '  "t/{a:on|off}"  vs  "t/{b:off|no}", which both match "t/off": Both.onOff runs, as it is declared first.\n' +
        'Make the patterns distinct: in the next major version (5.0), MeoCord refuses to start with such a pair.',
    ])
  })

  // The ranking decides these, whatever the listing: a literal before a param, then the narrower type
  it.each([
    [['profile/{userId}/edit', 'profile/me/{section}']],
    [['profile/me/{section}', 'profile/{userId}/edit']],
    [['a/{x}/c', 'a/b/{y}']],
    [['{p:int}/{q}', '{r}/{s:int}']],
    [['profile/{uuid}', 'profile/{uuid}/{id}']],
    [['t/{a:on|off}', 't/{b:yes|no}']],
  ])('stays quiet for %j', patterns => {
    create(
      patterns.map(pattern => {
        @Controller()
        class Routed {
          @Command(pattern, CommandType.BUTTON)
          handle() {}
        }
        return Routed
      }),
    )

    expect(overlapWarnings()).toEqual([])
  })

  // Dispatch tries a pattern only for its own component type, so a button and a select menu can share one
  it('leaves alone one pattern shared by two component types', () => {
    @Controller()
    class Shared {
      @Command('shared/{id}', CommandType.BUTTON)
      button() {}

      @Command('shared/{id}', CommandType.SELECT_MENU)
      select() {}
    }

    create([Shared])

    expect(overlapWarnings()).toEqual([])
  })

  it.each([
    ['as a bot', () => {}, { discordToken: 'token' }, 1],
    ['under meocord register', () => vi.stubEnv('MEOCORD_REGISTER_ONLY', '1'), { discordToken: 'token' }, 1],
    ['as the shard manager', () => {}, { discordToken: 'token', sharding: { mode: 'process' } }, 1],
    // Its manager has given the warning, so a bot of any number of shards gives it once
    ['as a spawned shard', () => vi.stubEnv('SHARDING_MANAGER', 'true'), { discordToken: 'token', sharding: { mode: 'process' } }, 0],
  ] as const)('are named once for the whole bot when it runs %s', (_how, setUp, current, warnings) => {
    const { Both } = pair()
    setUp()
    config.current = current as MeoCordConfig

    create([Both])

    expect(overlapWarnings()).toHaveLength(warnings)
  })

  // Before it spawns a shard, each of which would refuse the same
  it('refuses two patterns of one shape in the shard manager, as the bot does', () => {
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
    config.current = { discordToken: 'token', sharding: { mode: 'process' } } as MeoCordConfig

    expect(() => create([Profile, Card])).toThrow('Profile.show: "profile/{uid}" and "profile/{id}" in Card.open match the same button customIds')
  })

  it('are named when the testing module compiles, before anything is dispatched', () => {
    const { Both } = pair()

    MeoCordTestingModule.create({ controllers: [Both] }).compile()

    expect(overlapWarnings()).toHaveLength(1)
  })
})
