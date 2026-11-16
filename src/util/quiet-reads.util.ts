import { shared } from '@src/util/shared-state.util.js'

/**
 * How deep MeoCord is in a read of a key an object may lack, such as an event argument's `guildId`, or in a mock's own
 * code. A default-mode mock answers such a key with a placeholder and warns when an app's code reads it; a read in here
 * stays quiet. Under strict mocks an absent key reads `undefined`, so with strict mocks the default in 5.0 nothing reads
 * this and it goes.
 */
const quiet = shared('quietReads', () => ({ depth: 0 }))

/** Runs `read`, synchronous, as MeoCord's own read: a default-mode mock gives no warning for what it reads. */
export function readQuietly<T>(read: () => T): T {
  quiet.depth++
  try {
    return read()
  } finally {
    quiet.depth--
  }
}

/** Whether a read runs inside {@link readQuietly}. */
export function quietReads(): boolean {
  return quiet.depth > 0
}
