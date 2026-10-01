import { vi } from 'vitest'
import { type Client } from 'discord.js'
import { Controller, Service } from '@src/decorator/index.js'
import { SHARD_CALL_TIMEOUT_MS, shardCallHandler, ShardContext } from '@src/core/shard-context.js'
import { Container } from 'inversify'
import { MeoCordTestingModule } from '@src/testing/index.js'

@Service()
class StatsService {
  guilds = 7
  guildCount() {
    return this.guilds
  }
  fail(): number {
    throw new Error('stats unavailable')
  }
}

/** A client whose `shard` is a process-sharding ShardClientUtil over `count` fake shards. */
function shardedClient(ownId: number, count: number, answer: (id: number) => Promise<unknown>): Client {
  return {
    shard: {
      ids: [ownId],
      count,
      broadcastEval: vi.fn((_fn: unknown, { shard }: { shard: number }) => answer(shard)),
    },
    options: {},
  } as unknown as Client
}

describe('ShardContext', () => {
  describe('in one process', () => {
    @Controller()
    class Stats {
      constructor(readonly stats: StatsService) {}
    }

    const shardsOf = () =>
      MeoCordTestingModule.create({ controllers: [Stats], providers: [{ provide: StatsService, useClass: StatsService }] })
        .compile()
        .get(ShardContext)

    it('is primary, runs one shard, and answers a call once, here', async () => {
      const shards = shardsOf()

      expect(shards.isPrimary).toBe(true)
      expect(shards.count).toBe(1)
      expect(await shards.call(StatsService, 'guildCount')).toEqual([{ shardIds: [0], ok: true, value: 7 }])
    })

    // A process-sharded bot passes them as JSON, so one process and a test see what production sees
    it('passes the arguments and the result through JSON, as a call between processes does', async () => {
      @Controller()
      class Echo {
        echo(...args: unknown[]) {
          return { received: args.map(arg => Object.prototype.toString.call(arg)), map: new Map([['a', 1]]), at: new Date(0) }
        }
      }
      const shards = MeoCordTestingModule.create({ controllers: [Echo] }).compile().get(ShardContext)

      expect(await shards.call(Echo, 'echo', new Date(0), new Map([[1, 2]]), undefined)).toEqual([
        {
          shardIds: [0],
          ok: true,
          value: { received: ['[object String]', '[object Object]', '[object Null]'], map: {}, at: '1970-01-01T00:00:00.000Z' },
        },
      ])
    })

    // JSON drops a value it cannot write, as discord.js's reply between processes does
    it('gives a result JSON cannot write, such as a function or a Symbol, as undefined', async () => {
      @Controller()
      class Odd {
        fn() {
          return () => 1
        }
        symbol() {
          return Symbol('odd')
        }
      }
      const shards = MeoCordTestingModule.create({ controllers: [Odd] }).compile().get(ShardContext)

      expect(await shards.call(Odd, 'fn')).toEqual([{ shardIds: [0], ok: true, value: undefined }])
      expect(await shards.call(Odd, 'symbol')).toEqual([{ shardIds: [0], ok: true, value: undefined }])
    })

    it('reaches a class a provider stands in for', async () => {
      class Payments {
        charge() {
          return 'none'
        }
      }
      @Service()
      class StripePayments extends Payments {
        charge() {
          return 'stripe'
        }
      }
      const shards = MeoCordTestingModule.create({ controllers: [], providers: [{ provide: Payments, useClass: StripePayments }] })
        .compile()
        .get(ShardContext)

      expect(await shards.call(Payments, 'charge')).toEqual([{ shardIds: [0], ok: true, value: 'stripe' }])
    })

    it('turns a throwing method into an error result', async () => {
      expect(await shardsOf().call(StatsService, 'fail')).toEqual([
        { shardIds: [0], ok: false, error: 'stats unavailable' },
      ])
    })

    it('calls the class it is given in a testing module, even when another shares its name', async () => {
      const other = (() => {
        @Service()
        class StatsService {
          guildCount() {
            return -1
          }
        }
        return StatsService
      })()
      const shards = MeoCordTestingModule.create({
        providers: [
          { provide: other, useClass: other },
          { provide: StatsService, useClass: StatsService },
        ],
      })
        .compile()
        .get(ShardContext)

      expect(await shards.call(StatsService, 'guildCount')).toEqual([{ shardIds: [0], ok: true, value: 7 }])
    })

    it('runs broadcastEval here, warning once that it stringifies its function', async () => {
      const client = { options: {}, ws: { shards: new Map([[0, {}]]) } } as unknown as Client
      const shards = new ShardContext(client, async () => undefined)
      const warn = vi.spyOn(Reflect.get(shards, 'logger') as { warn: () => void }, 'warn').mockImplementation(() => {})

      expect(await shards.broadcastEval(c => c === client)).toEqual([true])
      await shards.broadcastEval(() => 1)
      expect(warn).toHaveBeenCalledTimes(1)
    })
  })

  describe('in one process, at the edges', () => {
    const shards = (runHere: ConstructorParameters<typeof ShardContext>[1]) => new ShardContext(undefined, runHere)

    it('reports a service the process does not have as an error result', async () => {
      const context = MeoCordTestingModule.create({ controllers: [] }).compile().get(ShardContext)

      const [result] = await context.call(StatsService, 'guildCount')

      expect(result).toMatchObject({ ok: false, shardIds: [0] })
    })

    it('reports a method that does not answer in time as an error result', async () => {
      vi.useFakeTimers()
      const pending = shards(() => new Promise(() => {})).call(StatsService, 'guildCount')

      await vi.advanceTimersByTimeAsync(SHARD_CALL_TIMEOUT_MS)

      expect(await pending).toEqual([{ shardIds: [0], ok: false, error: `StatsService did not answer within ${SHARD_CALL_TIMEOUT_MS} ms.` }])
      vi.useRealTimers()
    })

    it('describes a thrown value that is not an Error', async () => {
      const [result] = await shards(async () => {
        throw 'offline'
      }).call(StatsService, 'guildCount')

      expect(result).toEqual({ shardIds: [0], ok: false, error: 'offline' })
    })

    it('runs one shard, primary, without a client', () => {
      const context = shards(async () => undefined)

      expect([context.ids, context.count, context.isPrimary]).toEqual([[0], 1, true])
    })

    it('runs one shard before the client connected any, and counts the shards configured', () => {
      const client = { ws: { shards: new Map() }, options: { shardCount: 3 } } as unknown as Client
      const context = new ShardContext(client, async () => undefined)

      expect([context.ids, context.count]).toEqual([[0], 3])
    })
  })

  describe('a call from another shard', () => {
    // Encoded where it ran, so a value JSON cannot carry fails at once, as in one process, rather than never answering
    it('fails at once on a result JSON cannot carry, such as a BigInt', async () => {
      @Service()
      class Ledger {
        total() {
          return 10n
        }
      }
      const container = new Container()
      container.bind(Ledger).toSelf()
      const runHere = shardCallHandler(container, () => [Ledger], 'this app')

      await expect(runHere('Ledger', 'total', [])).rejects.toThrow('BigInt')
    })
  })

  describe('with process sharding', () => {
    it('is primary only in the process running shard 0', () => {
      expect(new ShardContext(shardedClient(0, 3, async () => 0), async () => 0).isPrimary).toBe(true)
      expect(new ShardContext(shardedClient(2, 3, async () => 0), async () => 0).isPrimary).toBe(false)
      expect(new ShardContext(shardedClient(2, 3, async () => 0), async () => 0).ids).toEqual([2])
    })

    it('calls every shard and gives one result per shard, a failing one included', async () => {
      const client = shardedClient(0, 3, async id => {
        if (id === 1) throw new Error('StatsService is not a controller or service of this app.')
        return id * 10
      })
      const shards = new ShardContext(client, async () => 0)

      expect(await shards.call(StatsService, 'guildCount')).toEqual([
        { shardIds: [0], ok: true, value: 0 },
        { shardIds: [1], ok: false, error: 'StatsService is not a controller or service of this app.' },
        { shardIds: [2], ok: true, value: 20 },
      ])
      expect(client.shard!.broadcastEval).toHaveBeenCalledWith(expect.any(Function), {
        shard: 2,
        context: { id: expect.any(String), service: 'StatsService', method: 'guildCount', args: [] },
      })
    })

    // discord.js matches a shard's answer to its call by the script it sent, and shares one in flight among identical ones
    it('sends every call a script of its own, so identical calls neither merge nor take the answer to another call', async () => {
      const scripts: string[] = []
      const client = {
        shard: {
          ids: [0],
          count: 1,
          broadcastEval: (fn: unknown, { context }: { context: unknown }) => {
            scripts.push(`(${String(fn)})(this, ${JSON.stringify(context)})`)
            return Promise.resolve(1)
          },
        },
        options: {},
      } as unknown as Client
      const shards = new ShardContext(client, async () => 0)

      await Promise.all([shards.call(StatsService, 'guildCount'), shards.call(StatsService, 'guildCount')])
      await shards.call(StatsService, 'guildCount')

      expect(new Set(scripts).size).toBe(3)
    })

    it('gives an error for a shard that does not answer in time, without holding up the others', async () => {
      vi.useFakeTimers()
      try {
        const client = shardedClient(0, 2, id => (id === 1 ? new Promise(() => {}) : Promise.resolve(5)))
        const results = new ShardContext(client, async () => 0).call(StatsService, 'guildCount')

        await vi.advanceTimersByTimeAsync(SHARD_CALL_TIMEOUT_MS)
        expect(await results).toEqual([
          { shardIds: [0], ok: true, value: 5 },
          { shardIds: [1], ok: false, error: `Shard 1 did not answer within ${SHARD_CALL_TIMEOUT_MS} ms.` },
        ])
      } finally {
        vi.useRealTimers()
      }
    })

    it('sends a function that reads only its arguments, so it survives being stringified', async () => {
      let sent: ((client: Client, ctx: unknown) => unknown) | undefined
      const client = {
        shard: {
          ids: [0],
          count: 1,
          broadcastEval: (fn: typeof sent) => {
            sent = fn
            return Promise.resolve(1)
          },
        },
        options: {},
      } as unknown as Client
      await new ShardContext(client, async () => 0).call(StatsService, 'guildCount')

      // Rebuilt from its source, as discord.js does in the target shard
      const rebuilt = new Function(`return (${sent!.toString()})`)() as typeof sent
      const target = { [Symbol.for('meocord.shardCall')]: async (s: string, m: string) => `${s}.${m}` }
      expect(await rebuilt!(target as unknown as Client, { service: 'StatsService', method: 'guildCount', args: [] })).toBe(
        'StatsService.guildCount',
      )
    })
  })
})
