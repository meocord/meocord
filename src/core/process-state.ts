import { stopRequests } from '@src/util/stop-request.util.js'
import { shared, sharedKey } from '@src/util/shared-state.util.js'

/** Where both builds of this version keep the process's state, as {@link shared} names it. */
const PROCESS_STATE = 'processState'

/**
 * What the process's apps share, kept by both builds of this version, so a process that loads both has one pair of
 * signal listeners and one shutdown, which stops the apps either build started, one exit code a failed start set, and
 * one end of a failed shard.
 */
export const processState = shared(PROCESS_STATE, () => ({
  /** Closes each started app: runs its shutdown hooks and destroys its client, resolving `false` on failure. */
  runningApps: new Set<() => Promise<boolean>>(),
  stopRequest: stopRequests(),
  signalHandlersInstalled: false,
  shuttingDown: undefined as Promise<void> | undefined,
  /** Whether a failed start, of a provider's factory or the login, set the exit code, so a later login knows to clear it. */
  startFailureSetExitCode: false,
  /** Whether `meocord start --dev` was told the bot could not log in, so a later login tells it the bot is online. */
  toldDevRunnerLoginFailed: false,
  /** Whether this shard is already ending, so a failure reported twice, as one going on uncaught is, ends it once. */
  shardEnding: false,
}))

/** Forgets the process's state, for specs that load the modules afresh as a new process would. */
export function forgetProcessState(): void {
  Reflect.deleteProperty(globalThis, sharedKey(PROCESS_STATE))
}
