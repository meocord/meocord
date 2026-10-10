/** Set by discord.js in every process its ShardingManager spawns. */
export const SHARDING_MANAGER_ENV = 'SHARDING_MANAGER'

/**
 * Whether a process with `env` was spawned as a shard by a sharding manager. Read before anything builds a
 * `ShardingManager`, whose constructor writes the variable into its own process too.
 */
export function isShardProcess(env: NodeJS.ProcessEnv): boolean {
  return env[SHARDING_MANAGER_ENV] !== undefined
}
