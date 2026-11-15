import 'reflect-metadata'
import packageJson from '../../package.json' with { type: 'json' }

/**
 * The name of a key the ES module and CommonJS builds of this meocord version share, and no other version has, for
 * `Symbol.for`: a process that loads both builds of one install keeps one state under it, and two installed versions
 * keep theirs apart. `Symbol.for(sharedName(...))` written out types as a `unique symbol`.
 */
export const sharedName = (name: string): string => `meocord@${packageJson.version}:${name}`

/** The key named {@link sharedName}. */
export function sharedKey(name: string): symbol {
  return Symbol.for(sharedName(name))
}

/** The state both builds of this version keep on `globalThis` under `name`, made by whichever asks first. */
export function shared<T>(name: string, make: () => T): T {
  const key = sharedKey(name)
  const store = globalThis as unknown as Record<symbol, T>
  if (!Object.hasOwn(store, key)) Object.defineProperty(store, key, { value: make(), configurable: true })
  return store[key]
}

/**
 * What swc records on a class it decorates: the class's type, and its constructor's parameter types. A class
 * {@link sharedClass} decorates keeps none of it, as without the decorator: inversify never builds it from these.
 */
const DESIGN_METADATA = ['design:type', 'design:paramtypes'] as const

/**
 * Makes a class one object for both builds of this version: the one the build loaded first made, under `name`.
 * inversify finds a binding by the class object, so a class MeoCord binds in an app's container injects the app's
 * instance whichever build a file imports it from. Its methods run the first-loaded build's code, so whatever they
 * read from module state is shared too.
 */
export function sharedClass(name: string) {
  return <T extends abstract new (...args: never[]) => unknown>(target: T): T => {
    for (const key of DESIGN_METADATA) Reflect.deleteMetadata(key, target)
    return shared(`class:${name}`, () => target)
  }
}
