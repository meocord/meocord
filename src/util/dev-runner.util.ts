import { isShardProcess } from '@src/util/sharding-mode.util.js'

/** Set by `meocord start --dev` on the application it runs, which it gives an IPC channel. */
export const DEV_RUNNER_ENV = 'MEOCORD_DEV_RUNNER'

/**
 * What the application tells `meocord start --dev`: that the bot could not log in, which ends the watch session
 * since no code change fixes it, or that a later attempt logged in after all.
 */
export type DevRunnerMessage = { meocord: 'login-failed' } | { meocord: 'online' }

/** Whether an IPC message from the application is one for the dev runner. */
export function isDevRunnerMessage(message: unknown): message is DevRunnerMessage {
  const kind = (message as { meocord?: unknown } | null)?.meocord
  return kind === 'login-failed' || kind === 'online'
}

/** Whether `meocord start --dev` runs this process and listens on its channel. */
export function underDevRunner(): boolean {
  return process.env[DEV_RUNNER_ENV] === '1' && !!process.send && !isShardProcess()
}

/**
 * Tells `meocord start --dev`, when it runs this process, whether the bot could log in, and waits until it is sent.
 * A shard tells its manager instead, which tells the dev runner in turn.
 */
export async function tellDevRunner(message: DevRunnerMessage): Promise<void> {
  if (!underDevRunner()) return
  // A closed channel means the dev runner is gone, so there is no one left to tell
  await new Promise<void>(resolve => {
    try {
      process.send!(message, undefined, {}, () => resolve())
    } catch {
      resolve()
    }
  })
}
