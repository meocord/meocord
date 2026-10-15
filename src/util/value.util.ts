import { quoteForLog } from '@src/util/user-text.util.js'

/** Whether `new` takes a value, as `instanceof` needs of its right side, such as a `@Catch` type. */
export function isConstructible(value: unknown): value is abstract new (...args: any[]) => unknown {
  if (typeof value !== 'function') return false
  try {
    // Fails unless value can be new.target, which only a constructor can; none of value's constructor code runs
    Reflect.construct(String, [], value)
    return true
  } catch {
    return false
  }
}

/**
 * Whether a value is a class, which a stage entry or an app option must be: constructible, with an object prototype for
 * the metadata MeoCord reads. An arrow function, a method, an async or a generator function is none.
 */
export function isConstructor(value: unknown): value is abstract new (...args: any[]) => unknown {
  if (!isConstructible(value)) return false
  const prototype = (value as { prototype?: unknown }).prototype
  return typeof prototype === 'object' && prototype !== null
}

/** A value as a refusal or a warning names it: a string quoted, `null` and `undefined` as written, else its kind. */
export function describeValue(value: unknown): string {
  if (value === null || value === undefined) return String(value)
  if (typeof value === 'string') return quoteForLog(value)
  if (Array.isArray(value)) return 'an array'
  return typeof value === 'object' ? 'an object' : `a ${typeof value}`
}

/** A class's name after its article, such as `an AutocompleteInteraction`; a `U` name reads as "you", so takes `a`. */
export const withArticle = (name: string): string => `${/^[AEIO]/i.test(name) ? 'an' : 'a'} ${name}`

/**
 * Sets `key` on a plain object `target` as an own, enumerable data property: unlike `target[key] = value`, a key
 * named `__proto__` is a key like any other rather than the object's prototype, and a key such as `toString` is set
 * even where `Object.prototype` is frozen.
 */
export function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  // An assignment would call __proto__'s setter, and throw for a member of a frozen Object.prototype. Any other key
  // assigned is an own data property already; defining each would cost V8 its fast object shape
  if (key in Object.prototype) Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true })
  else target[key] = value
}

/** `target`'s own value for `key`, never one it inherits, such as `Object.prototype.toString` for `toString`. */
export const ownValue = <T>(target: Record<string, T>, key: string): T | undefined => (Object.hasOwn(target, key) ? target[key] : undefined)

/**
 * Gives each of `keys`, names `Object.prototype` has such as `toString` or `constructor`, that `target` doesn't hold
 * an own `undefined`, so reading one left out gives `undefined` rather than the inherited member.
 */
export function shadowInherited(target: Record<string, unknown>, keys: readonly string[]): void {
  for (const key of keys) if (!Object.hasOwn(target, key)) setOwn(target, key, undefined)
}
