import { type ClientOptions } from 'discord.js'
import { type MeoCordConfig } from '@src/interface/index.js'
import { refuse } from '@src/util/refusal.util.js'

/** Set by discord.js in every process its ShardingManager spawns. */
export const SHARDING_MANAGER_ENV = 'SHARDING_MANAGER'

/** What this process is, as far as sharding goes. */
export type ShardingRole = 'manager' | 'shard' | 'single'

/** Whether this process was spawned as a shard by a sharding manager. */
export function isShardProcess(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[SHARDING_MANAGER_ENV] !== undefined
}

/** Whether a shard's manager is gone: the IPC channel it asks a shard to stop through is closed. */
export function managerGone(proc: Pick<NodeJS.Process, 'connected'> = process): boolean {
  return proc.connected === false
}

/** Whether process sharding is on for this run: configured, and allowed in development when that is where it runs. */
export function processShardingEnabled(config: MeoCordConfig, env: NodeJS.ProcessEnv = process.env): boolean {
  if (config.sharding?.mode !== 'process') return false
  return env.NODE_ENV !== 'development' || config.sharding.development === true
}

/**
 * The role of this process: a shard when a manager spawned it, the manager when process sharding is on,
 * and otherwise a single process running every shard it has.
 */
export function shardingRole(config: MeoCordConfig, env: NodeJS.ProcessEnv = process.env): ShardingRole {
  if (isShardProcess(env)) return 'shard'
  return processShardingEnabled(config, env) ? 'manager' : 'single'
}

/**
 * The client options for a single process: `sharding.shards` in internal mode becomes the client's
 * `shards`, unless `clientOptions` already shards, which must then agree.
 *
 * @throws When `sharding` and `clientOptions` ask for different shards, or process mode meets
 *   `clientOptions.shards`.
 */
export function clientOptionsWithSharding(config: MeoCordConfig, clientOptions: ClientOptions): ClientOptions {
  const sharding = config.sharding
  if (!sharding) return clientOptions

  const own = clientOptions.shards ?? clientOptions.shardCount
  if (sharding.mode === 'process') {
    if (own !== undefined) {
      throw refuse(new Error(
        "meocord.config.ts: sharding.mode 'process' starts one shard per process, so clientOptions.shards and shardCount " +
          'must be unset.',
      ))
    }
    return clientOptions
  }

  const shards = sharding.shards ?? 'auto'
  // To discord.js a number in `shards` is one shard's id, so a count becomes every id plus the count
  if (own === undefined) {
    return shards === 'auto'
      ? { ...clientOptions, shards: 'auto' }
      : { ...clientOptions, shards: [...Array(shards).keys()], shardCount: shards }
  }

  const agrees =
    shards === 'auto'
      ? clientOptions.shards === 'auto'
      : clientOptions.shardCount === shards || (Array.isArray(clientOptions.shards) && clientOptions.shards.length === shards)
  if (!agrees) {
    throw refuse(new Error(
      `meocord.config.ts: sharding.shards (${String(shards)}) and clientOptions.shards/shardCount disagree; set the ` +
        'shards in one place.',
    ))
  }
  return clientOptions
}
