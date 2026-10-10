/**
 * Gives a decorator's `wrapper` the `length` and `name` of the method it replaces, so whatever reads the handler, such
 * as `invoke` counting the arguments it takes, sees the method as it was declared.
 */
export function wrapsMethod<F extends (...args: any[]) => unknown>(wrapper: F, original: (...args: any[]) => unknown): F {
  Object.defineProperty(wrapper, 'length', { value: original.length, configurable: true })
  Object.defineProperty(wrapper, 'name', { value: original.name, configurable: true })
  return wrapper
}
