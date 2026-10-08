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

const create = (controllers: (new () => unknown)[], routeTies?: 'listed' | 'literalFirst') => {
  @MeoCord({ controllers, clientOptions: { intents: [] }, routeTies })
  class App {}
  MeoCordFactory.create(App)
}

/** Every warning about patterns that can match the same customId. */
const overlapWarnings = () => warned.filter(line => line.includes('can match the same customId'))
/** The pair lines of the one overlap warning. */
const pairLines = () => overlapWarnings()[0]?.split('\n').filter(line => line.startsWith('  '))

// `a/{x}/c` and `a/b/{y}` both take `a/b/c`, and neither is more literal than the other, so the order they are listed
// in settles it. Saying so at startup beats letting one of them quietly win every click.
describe('patterns that can match the same customId', () => {
  const pair = () => {
    @Controller()
    class XC {
      @Command('a/{x}/c', CommandType.BUTTON)
      xc() {}

      @Command('a/{x}', CommandType.BUTTON)
      x() {}
    }
    @Controller()
    class BY {
      @Command('a/b/{y}', CommandType.BUTTON)
      by() {}

      @Command('a/b', CommandType.BUTTON)
      b() {}
    }
    @Controller()
    class Both {
      @Command('a/{x}/c', CommandType.BUTTON)
      xc() {}

      @Command('a/b/{y}', CommandType.BUTTON)
      by() {}
    }
    return { XC, BY, Both }
  }

  it.each([
    [
      'XC listed first',
      ['XC', 'BY'],
      [
        '  "a/{x}/c"  vs  "a/b/{y}": XC.xc runs, as its controller is listed first. In the next major version (5.0), ' +
          'BY.by runs instead, as "a/b/{y}" spells out the first segment where the two differ. List BY first, make the ' +
          "patterns distinct, or set @MeoCord({ routeTies: 'literalFirst' }).",
        '  "a/b"  vs  "a/{x}": BY.b runs, as its pattern is more specific.',
      ],
    ],
    [
      'BY listed first',
      ['BY', 'XC'],
      ['  "a/b/{y}"  vs  "a/{x}/c": BY.by runs, as its controller is listed first.', '  "a/b"  vs  "a/{x}": BY.b runs, as its pattern is more specific.'],
    ],
    [
      'both in one controller',
      ['Both'],
      [
        '  "a/{x}/c"  vs  "a/b/{y}": Both.xc runs, as it is declared first. In the next major version (5.0), Both.by ' +
          'runs instead, as "a/b/{y}" spells out the first segment where the two differ. Declare Both.by first, make the ' +
          "patterns distinct, or set @MeoCord({ routeTies: 'literalFirst' }).",
      ],
    ],
  ] as const)('names the handler that runs for each pair, and the one that runs in 5.0: %s', (_order, listed, lines) => {
    const controllers = pair()
    create(listed.map(name => controllers[name]))

    expect(pairLines()).toEqual(lines)
  })

  // A param owns its segment, so "/" already separates every pair; the warning says only what runs and why
  it('is one message: how many pairs, and a line for each', () => {
    const { Both } = pair()

    create([Both])

    expect(overlapWarnings()).toEqual([
      '1 pattern pair(s) can match the same customId, so which one runs is decided by ranking rather than by the ids ' +
        'themselves:\n' +
        '  "a/{x}/c"  vs  "a/b/{y}": Both.xc runs, as it is declared first. In the next major version (5.0), Both.by ' +
        'runs instead, as "a/b/{y}" spells out the first segment where the two differ. Declare Both.by first, make the ' +
        "patterns distinct, or set @MeoCord({ routeTies: 'literalFirst' }).",
    ])
  })

  it('stays quiet when the patterns cannot collide', () => {
    @Controller()
    class Distinct {
      @Command('profile/{uuid}', CommandType.BUTTON)
      one() {}

      @Command('profile/{uuid}/{id}', CommandType.BUTTON)
      two() {}
    }

    create([Distinct])

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

describe("@MeoCord({ routeTies: 'literalFirst' })", () => {
  it('names only the pairs listing order still decides, which literal-first leaves', () => {
    @Controller()
    class Ties {
      @Command('a/{x}/c', CommandType.BUTTON)
      xc() {}

      @Command('a/b/{y}', CommandType.BUTTON)
      by() {}

      @Command('{p:int}/{q}', CommandType.BUTTON)
      pq() {}

      @Command('{r}/{s:int}', CommandType.BUTTON)
      rs() {}
    }

    create([Ties], 'literalFirst')

    expect(pairLines()).toEqual(['  "{p:int}/{q}"  vs  "{r}/{s:int}": Ties.pq runs, as it is declared first.'])
  })
})
