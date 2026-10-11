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
 * Sets `key` on `target` as an own, enumerable data property: unlike `target[key] = value`, a key named `__proto__`
 * is a key like any other rather than the object's prototype.
 */
export function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true })
}
