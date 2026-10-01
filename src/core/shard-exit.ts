import { isExplainedError, markExplained } from '@src/common/explained-error.js'
import { REFUSED_CODE, type ShardMessage } from '@src/core/shard-messages.js'
import { describeRefusal, handOffRefusal, isRefusal } from '@src/util/refusal.util.js'

/** Sends a message to this shard's manager and waits until it is sent; nothing in a process no manager spawned. */
export async function tellManager(message: ShardMessage): Promise<void> {
  if (!process.send) return
  await new Promise<void>(resolve => process.send!(message, undefined, {}, () => resolve()))
}

/** Whether this shard is already ending, so a failure reported twice, as one going on uncaught is, ends it once. */
let ending = false

/**
 * Ends a shard whose startup failed, so its manager restarts it. A refusal would be the same in every shard, so the
 * manager is told first, and logs it and stops them all. The exit waits until the caller has handled the error and the
 * manager has the reason.
 */
export function endFailedShard(error: unknown): void {
  if (ending) return
  ending = true
  const refused = isRefusal(error)
  const reason = refused && describeRefusal(error, process.cwd())
  if (refused) {
    // Its manager logs it, once for every shard
    if (!isExplainedError(error)) markExplained(error)
    handOffRefusal(error)
  }
  // The error may go on uncaught, which would end the process before a long reason is sent; held, it ends here instead,
  // and any other error is still reported
  const hold = (uncaught: unknown) => {
    if (!isExplainedError(uncaught)) console.error(uncaught)
  }
  process.on('uncaughtException', hold)
  process.on('unhandledRejection', hold)
  void (async () => {
    try {
      if (reason) await tellManager({ meocord: 'fatal', code: REFUSED_CODE, message: reason })
      await new Promise(resolve => setImmediate(resolve))
      process.exit(1)
    } finally {
      process.off('uncaughtException', hold)
      process.off('unhandledRejection', hold)
    }
  })()
}
