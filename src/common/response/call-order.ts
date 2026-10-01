let last = 0
const order = new WeakMap<object, number>()

/** Marks a Discord call as made now, so calls recorded in different places can be merged in the order made. */
export function stampCall(call: object): void {
  order.set(call, ++last)
}

/** When a call stamped by {@link stampCall} was made, relative to the others. */
export function callOrder(call: object): number {
  return order.get(call) ?? 0
}
