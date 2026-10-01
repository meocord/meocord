/** Set by discord.js in every process its ShardingManager spawns. */
export const SHARDING_MANAGER_ENV = 'SHARDING_MANAGER'

/** Whether this process was spawned as a shard by a sharding manager. */
export function isShardProcess(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[SHARDING_MANAGER_ENV] !== undefined
}
