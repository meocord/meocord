import { isExplainedError, markExplained } from '@src/common/explained-error.js'
import { REFUSED_CODE, type ShardMessage } from '@src/core/shard-messages.js'
import { describeRefusal, isRefusal } from '@src/util/refusal.util.js'

/** Sends a message to this shard's manager and waits until it is sent; nothing in a process no manager spawned. */
export async function tellManager(message: ShardMessage): Promise<void> {
  if (!process.send) return
  await new Promise<void>(resolve => process.send!(message, undefined, {}, () => resolve()))
}

/**
 * Ends a shard whose startup failed, so its manager restarts it. A refusal would be the same in every shard, so the
 * manager is told first, and logs it and stops them all. The exit waits until the caller has handled the error.
 */
export function endFailedShard(error: unknown): void {
  const refused = isRefusal(error)
  const reason = refused && describeRefusal(error, process.cwd())
  // Its manager logs it, once for every shard
  if (refused && !isExplainedError(error)) markExplained(error)
  void (async () => {
    if (reason) await tellManager({ meocord: 'fatal', code: REFUSED_CODE, message: reason })
    await new Promise(resolve => setImmediate(resolve))
    process.exit(1)
  })()
}
