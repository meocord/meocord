import { randomUUID } from 'node:crypto'
import { Redis } from 'ioredis'
import { createClient } from 'redis'
import { ChatInputCommandInteraction } from 'discord.js'
import { Container } from 'inversify'
import { vi } from 'vitest'
import { CooldownStore, CooldownStoreError, Logger, RedisCooldownStore } from '@src/common/index.js'
import { Command, Controller, Cooldown, MeoCord } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { HandlerExecutionContext } from '@src/common/execution-context.js'
import { COOLDOWN_POLICY, handlerCooldowns, peekCooldowns } from '@src/core/cooldown-runner.js'
import { createMockInteraction, MeoCordTestingModule, testCooldownStore } from '@src/testing/index.js'

/**
 * RedisCooldownStore's script on a real server, through both clients the docs show. Runs where
 * REDIS_URL names one, as CI's Redis job does: `REDIS_URL=redis://localhost:6379 bun run test`.
 */
const url = process.env.REDIS_URL

describe.skipIf(!url)('RedisCooldownStore on a Redis server', () => {
  const nodeRedis = createClient({ url })
  const ioredis = new Redis(url ?? '', { lazyConnect: true })
  const prefix = `meocord-test:${randomUUID()}:`

  beforeAll(async () => {
    await Promise.all([nodeRedis.connect(), ioredis.connect()])
  })

  afterAll(async () => {
    const keys = await ioredis.keys(`${prefix}*`)
    if (keys.length > 0) await ioredis.del(...keys)
    await Promise.all([nodeRedis.quit(), ioredis.quit()])
  })

  const viaNodeRedis = RedisCooldownStore.using((script, keys, args) => nodeRedis.eval(script, { keys, arguments: args }), {
    prefix,
  })
  const viaIoredis = RedisCooldownStore.using((script, keys, args) => ioredis.eval(script, keys.length, ...keys, ...args), {
    prefix,
  })
  const viaEvalSha = RedisCooldownStore.using((script, keys, args) => nodeRedis.eval(script, { keys, arguments: args }), {
    prefix,
    evalsha: (sha, keys, args) => nodeRedis.evalSha(sha, { keys, arguments: args }),
  })

  testCooldownStore('RedisCooldownStore through node-redis', () => new viaNodeRedis(), { describe, it, expect })
  testCooldownStore('RedisCooldownStore through ioredis', () => new viaIoredis(), { describe, it, expect })
  testCooldownStore('RedisCooldownStore through EVALSHA', () => new viaEvalSha(), { describe, it, expect })
  const viaHashTag = RedisCooldownStore.using((script, keys, args) => ioredis.eval(script, keys.length, ...keys, ...args), {
    prefix,
    hashTag: 'handler',
  })
  testCooldownStore("RedisCooldownStore with hashTag: 'handler'", () => new viaHashTag(), { describe, it, expect })

  describe('when the server fails', () => {
    @Controller()
    class DailyController {
      @Command('daily', CommandType.SLASH)
      @Cooldown({ seconds: 3 })
      @Cooldown({ seconds: 60, uses: 5 })
      daily(_interaction: ChatInputCommandInteraction) {}
    }

    const moduleOn = (store: CooldownStore, policy: { cooldownStoreFailure?: 'deny' | 'allow'; cooldownStoreTimeoutMs?: number }) => {
      @MeoCord({ controllers: [DailyController], clientOptions: { intents: [] }, ...policy })
      class App {}
      return MeoCordTestingModule.create({ app: App, controllers: [DailyController], providers: [{ provide: CooldownStore, useValue: store }] }).compile()
    }
    const call = () => createMockInteraction(ChatInputCommandInteraction, { commandName: 'daily' })

    beforeEach(() => {
      vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
      vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    })
    afterEach(() => vi.restoreAllMocks())

    // A server that is down: a port with nothing listening, and a client that does not reconnect
    it('refuses a call, or lets it through, when the server is down', async () => {
      const down = createClient({ url: 'redis://127.0.0.1:1', socket: { reconnectStrategy: false, connectTimeout: 500 } })
      down.on('error', () => undefined)
      const Store = RedisCooldownStore.using((script, keys, args) => down.eval(script, { keys, arguments: args }), { prefix })

      await expect(moduleOn(new Store(), {}).invoke(DailyController, 'daily', call())).rejects.toBeInstanceOf(CooldownStoreError)
      await expect(moduleOn(new Store(), { cooldownStoreFailure: 'allow' }).invoke(DailyController, 'daily', call())).resolves.toEqual({ ran: true })
    })

    // A server that is up but paused, as during a failover: the call waits past cooldownStoreTimeoutMs
    it('refuses a call the paused server does not answer in time', async () => {
      await ioredis.call('CLIENT', 'PAUSE', '1500', 'ALL')
      try {
        const error = await moduleOn(new viaNodeRedis(), { cooldownStoreTimeoutMs: 200 })
          .invoke(DailyController, 'daily', call())
          .catch((failure: unknown) => failure)

        expect(error).toBeInstanceOf(CooldownStoreError)
        expect((error as CooldownStoreError).timedOut).toBe(true)
      } finally {
        await ioredis.call('CLIENT', 'UNPAUSE')
      }
    })

    it('refuses a peek the paused server does not answer in time, as it refuses a call', async () => {
      const container = new Container()
      container.bind(CooldownStore).toConstantValue(new viaNodeRedis())
      container.bind(COOLDOWN_POLICY).toConstantValue({ failure: 'deny', timeoutMs: 200 })
      const context = new HandlerExecutionContext({ controller: DailyController, methodName: 'daily', args: [call()] })
      const peek = () => peekCooldowns(container, DailyController, 'daily', handlerCooldowns(DailyController.prototype, 'daily'), () => context)

      await expect(peek()).resolves.toBeUndefined()
      await ioredis.call('CLIENT', 'PAUSE', '1500', 'ALL')
      try {
        const error = await peek().catch((failure: unknown) => failure)
        expect(error).toBeInstanceOf(CooldownStoreError)
        expect((error as CooldownStoreError).timedOut).toBe(true)
      } finally {
        await ioredis.call('CLIENT', 'UNPAUSE')
      }
    })
  })

  it('gives every key it writes an expiry no longer than its window', async () => {
    const store = new viaIoredis()
    await store.consume('expiry', { uses: 1, windowMs: 3_000 })
    await store.consume('expiry', { uses: 1, windowMs: 3_000 })

    const ttl = await ioredis.pttl(`${prefix}expiry`)
    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(3_000)
  })

  it('writes nothing when it peeks: no key, and no expiry changed', async () => {
    const store = new viaIoredis()
    const limit = { uses: 1, windowMs: 3_000 }
    await store.peekMany([{ key: 'peek-only', limit }])
    expect(await ioredis.exists(`${prefix}peek-only`)).toBe(0)

    await store.consume('peek-held', limit)
    await ioredis.pexpire(`${prefix}peek-held`, 60_000)
    await store.peekMany([{ key: 'peek-held', limit }])
    expect(await ioredis.pttl(`${prefix}peek-held`)).toBeGreaterThan(3_000)
  })

  it('loads its script after the server flushes it, through EVALSHA', async () => {
    await ioredis.script('FLUSH')

    expect((await new viaEvalSha().consume('flushed', { uses: 1, windowMs: 1_000 })).allowed).toBe(true)
  })
})
