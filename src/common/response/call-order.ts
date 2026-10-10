import { shared } from '@src/util/shared-state.util.js'

// One count for both builds of this version, so calls either makes merge in the order made
const calls = shared('callOrder', () => ({ last: 0, order: new WeakMap<object, number>() }))

/** Marks a Discord call as made now, so calls recorded in different places can be merged in the order made. */
export function stampCall(call: object): void {
  calls.order.set(call, ++calls.last)
}

/** When a call stamped by {@link stampCall} was made, relative to the others. */
export function callOrder(call: object): number {
  return calls.order.get(call) ?? 0
}
