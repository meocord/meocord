import { shared } from '@src/util/shared-state.util.js'

// One count for both builds of this version, so calls either makes merge in the order made, and how many of MeoCord's
// own calls are starting now, so a mock tells them from an app's or a test's
const calls = shared('callOrder', () => ({ last: 0, order: new WeakMap<object, number>(), ownStarting: 0 }))

/** Marks a Discord call as made now, so calls recorded in different places can be merged in the order made. */
export function stampCall(call: object): void {
  calls.order.set(call, ++calls.last)
}

/** When a call stamped by {@link stampCall} was made, relative to the others. */
export function callOrder(call: object): number {
  return calls.order.get(call) ?? 0
}

/** Starts `send`, a Discord call MeoCord makes itself, marked as its own until it has started. */
export function startOwnCall<T>(send: () => T): T {
  calls.ownStarting++
  try {
    return send()
  } finally {
    calls.ownStarting--
  }
}

/** Whether the Discord call starting now is one MeoCord makes itself, through {@link startOwnCall}. */
export const isOwnCall = (): boolean => calls.ownStarting > 0
