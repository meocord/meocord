import { type MeoCordConfig } from '@src/interface/index.js'
import { clientOptionsWithSharding, managerGone, shardingRole } from '@src/util/sharding-mode.util.js'

const config = (sharding?: MeoCordConfig['sharding']): MeoCordConfig => ({ discordToken: 'token', sharding })

describe('shardingRole', () => {
  it('is a shard whenever a sharding manager spawned the process, whatever the config says', () => {
    expect(shardingRole(config({ mode: 'process' }), true)).toBe('shard')
    expect(shardingRole(config(), true)).toBe('shard')
  })

  it('is the manager for process sharding outside development', () => {
    expect(shardingRole(config({ mode: 'process' }), false, { NODE_ENV: 'production' })).toBe('manager')
    expect(shardingRole(config({ mode: 'process' }), false, {})).toBe('manager')
  })

  it('runs every shard in one process in development unless development is on', () => {
    expect(shardingRole(config({ mode: 'process' }), false, { NODE_ENV: 'development' })).toBe('single')
    expect(shardingRole(config({ mode: 'process', development: true }), false, { NODE_ENV: 'development' })).toBe('manager')
  })

  it('is a single process for internal sharding or none', () => {
    expect(shardingRole(config({ shards: 4 }), false, {})).toBe('single')
    expect(shardingRole(config(), false, {})).toBe('single')
  })
})

describe('clientOptionsWithSharding', () => {
  const intents = { intents: [] }

  it('leaves the client options alone without sharding', () => {
    expect(clientOptionsWithSharding(config(), { ...intents, shards: 'auto' })).toEqual({ ...intents, shards: 'auto' })
  })

  it('turns a shard count into every shard id and the count, and auto into auto', () => {
    expect(clientOptionsWithSharding(config({ shards: 3 }), intents)).toEqual({ ...intents, shards: [0, 1, 2], shardCount: 3 })
    expect(clientOptionsWithSharding(config({}), intents)).toEqual({ ...intents, shards: 'auto' })
  })

  it('accepts client options that agree, and refuses ones that do not', () => {
    const agreeing = { ...intents, shards: [0, 1], shardCount: 2 }
    expect(clientOptionsWithSharding(config({ shards: 2 }), agreeing)).toBe(agreeing)
    expect(() => clientOptionsWithSharding(config({ shards: 4 }), agreeing)).toThrow('disagree')
  })

  it('refuses client shards with process sharding, which gives each process its own', () => {
    expect(() => clientOptionsWithSharding(config({ mode: 'process' }), { ...intents, shardCount: 2 })).toThrow(
      'must be unset',
    )
    expect(clientOptionsWithSharding(config({ mode: 'process' }), intents)).toBe(intents)
  })
})

describe('managerGone', () => {
  it('is true only once the IPC channel to the manager is closed', () => {
    expect(managerGone({ connected: false })).toBe(true)
    expect(managerGone({ connected: true })).toBe(false)
    // A process no manager forked has no channel at all
    expect(managerGone({} as Pick<NodeJS.Process, 'connected'>)).toBe(false)
  })
})
