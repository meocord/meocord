// Relative, and nothing else imported: the bundle's pre-entry, which is copied rather than compiled, loads this module
import { isShardProcess } from './shard-process.util.js'

/** Set by `meocord start --dev` on the application it runs, which it gives an IPC channel. */
export const DEV_RUNNER_ENV = 'MEOCORD_DEV_RUNNER'

/**
 * What the application tells `meocord start --dev`: that the bot could not log in, which watch mode reports as it
 * waits for a change to the code or `.env`, or that a later attempt logged in after all.
 */
export type DevRunnerMessage = { meocord: 'login-failed' } | { meocord: 'online' }

/** Whether an IPC message from the application is one for the dev runner. */
export function isDevRunnerMessage(message: unknown): message is DevRunnerMessage {
  const kind = (message as { meocord?: unknown } | null)?.meocord
  return kind === 'login-failed' || kind === 'online'
}

/** What `meocord start --dev` tells the application: to stop, as SIGTERM would. */
export interface DevRunnerCommand { meocord: 'stop' }

/** Whether an IPC message is `meocord start --dev` telling the application to stop. */
export function isDevRunnerCommand(message: unknown): message is DevRunnerCommand {
  return (message as { meocord?: unknown } | null)?.meocord === 'stop'
}

// On the global object, as the pre-entry and the app may each have their own copy of this module
const STOP = Symbol.for('meocord.devRunnerStop')
const LISTENING = Symbol.for('meocord.devRunnerListening')
const slots = globalThis as { [STOP]?: () => void; [LISTENING]?: boolean }

/**
 * Listens for `meocord start --dev` telling the application to stop, which it does to restart it on every platform:
 * on Windows a signal ends a process outright, skipping its `onShutdown` hooks. The bundle's pre-entry calls it first,
 * so a stop is heard however early it comes; until an app or shard manager says how it stops, the process exits at
 * once, as SIGTERM's default would.
 */
export function listenForDevRunnerStop(): void {
  if (!underDevRunner() || slots[LISTENING]) return
  slots[LISTENING] = true
  process.on('message', message => {
    if (!isDevRunnerCommand(message)) return
    const stop = slots[STOP]
    if (stop) stop()
    else process.exit()
  })
  // A 'message' listener keeps the process alive for its channel; what the bot does decides that, as without one
  process.channel?.unref()
}

/** Has a stop from `meocord start --dev` run `stop`, as SIGINT and SIGTERM do. */
export function onDevRunnerStop(stop: () => void): void {
  listenForDevRunnerStop()
  slots[STOP] = stop
}

/** Whether `meocord start --dev` runs this process and listens on its channel. */
export function underDevRunner(): boolean {
  return process.env[DEV_RUNNER_ENV] === '1' && !!process.send && !isShardProcess()
}

/** How long a message to `meocord start --dev` may take to be sent before the dev runner is taken to be gone. */
export const DEV_RUNNER_SEND_TIMEOUT_MS = 1000

/**
 * Tells `meocord start --dev`, when it runs this process, whether the bot could log in, and waits until it is sent.
 * A shard tells its manager instead, which tells the dev runner in turn.
 */
export async function tellDevRunner(message: DevRunnerMessage): Promise<void> {
  if (!underDevRunner()) return
  // A closed channel means the dev runner is gone, so there is no one left to tell
  const sent = new Promise<void>(resolve => {
    try {
      process.send!(message, undefined, {}, () => resolve())
    } catch {
      resolve()
    }
  })
  let timer: NodeJS.Timeout | undefined
  const timedOut = new Promise<void>(resolve => {
    timer = setTimeout(resolve, DEV_RUNNER_SEND_TIMEOUT_MS)
    timer.unref()
  })
  // Bun does not call back once the dev runner is gone, where Node calls back with an error, so the wait is
  // bounded while the process runs. The timer is unref'd and never keeps the process alive by itself; a caller
  // sets the exit code before sending, so it holds however the send ends.
  await Promise.race([sent, timedOut])
  clearTimeout(timer)
}
