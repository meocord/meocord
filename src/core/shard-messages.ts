import type { CooldownBatchVerdict, CooldownEntry } from '@src/common/cooldown-store.js'

/** A message between a shard manager and its shards; discord.js's own messages never carry `meocord`. */
export type ShardMessage =
  | { meocord: 'shutdown' }
  | { meocord: 'fatal'; code: string; message: string }
  /** A shard's call, for the manager to count against every cooldown the handler has, or only check with `peek`. */
  | { meocord: 'cooldown'; id: string; entries: CooldownEntry[]; peek?: true }
  /** The manager's answer to the call with the same `id`: its verdict, or why its store failed. */
  | { meocord: 'cooldown-verdict'; id: string; verdict: CooldownBatchVerdict }
  | { meocord: 'cooldown-verdict'; id: string; error: string }
  /** A shard's request to undo the call it counted with that `id`, which it refused after all. */
  | { meocord: 'cooldown-release'; id: string }

/** The `fatal` code of a shard whose app MeoCord refused, which every shard would refuse alike. */
export const REFUSED_CODE = 'Refused'

/** Whether an IPC message is one of MeoCord's own, rather than one of discord.js's. */
export function isShardMessage(message: unknown): message is ShardMessage {
  return typeof message === 'object' && message !== null && 'meocord' in message
}
