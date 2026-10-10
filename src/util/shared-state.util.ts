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
