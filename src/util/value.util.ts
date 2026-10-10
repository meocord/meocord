import { quoteForLog } from '@src/util/user-text.util.js'

/** Whether a value is a class, which a stage entry or a `@Catch` type must be: what `new` and `instanceof` take. */
export const isConstructor = (value: unknown): value is abstract new (...args: any[]) => unknown => typeof value === 'function'

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
