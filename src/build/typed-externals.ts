import { type Rspack } from '@rsbuild/core'

type ExternalItem = Exclude<Rspack.ExternalItem, undefined>
type ExternalFunction = Extract<ExternalItem, (...args: any[]) => unknown>
type ExternalData = Parameters<ExternalFunction>[0]
type ExternalCallback = (error?: Error | null, result?: string) => void

/**
 * How a package kept out of the bundle is loaded, by how the bundle asks for it: an ESM `import` becomes a dynamic
 * `import()` where its importer runs, rather than one hoisted above the pre-entry, so the package loads after the
 * platform check and after the config has loaded `.env`; a CommonJS `require` stays a `require` at its call site, which
 * returns the module rather than the promise a dynamic import would.
 */
export function externalType(request: string, dependencyType: string | undefined): string {
  return `${dependencyType === 'commonjs' ? 'node-commonjs' : 'import'} ${request}`
}

/**
 * Whether a request matches an `externals` entry: a name it equals, or a pattern. A pattern is tested through a copy of
 * its own, from the start of each request: with the `g` or `y` flag, `test` would otherwise resume where the last match
 * ended and miss the next request for the same package. A `y` pattern still matches only at the start, as Rsbuild
 * tests it.
 */
export function externalMatcher(entry: string | RegExp): (request: string) => boolean {
  if (typeof entry === 'string') return request => request === entry
  const pattern = new RegExp(entry)
  return request => {
    pattern.lastIndex = 0
    return pattern.test(request)
  }
}

/** Whether an external's result names its own type, as `node-commonjs zlib-sync` does. */
const typed = (result: string) => /\s/.test(result)

/**
 * The externals with every untyped entry given its type by {@link externalType}: a string or pattern, as `autoExternal`
 * and `externals` give them, and a function's untyped result. An object's entries are left as they are.
 */
export function typeExternals(items: readonly ExternalItem[]): ExternalItem[] {
  return items.map(item => {
    if (typeof item === 'string' || item instanceof RegExp) {
      const matches = externalMatcher(item)
      return ((data: ExternalData, callback: ExternalCallback) => {
        const { request, dependencyType } = data
        if (request && matches(request)) return callback(null, externalType(request, dependencyType))
        callback()
      }) as ExternalFunction
    }
    if (typeof item !== 'function') return item

    const original = item as (data: ExternalData, callback?: ExternalCallback) => unknown
    return ((data: ExternalData, callback: ExternalCallback) => {
      const finish = (result: unknown) =>
        callback(null, typeof result === 'string' && !typed(result) ? externalType(result, data.dependencyType) : (result as string | undefined))
      // Callback style, as MeoCord's own native externals are, or a promise
      if (original.length >= 2) {
        return original(data, (error, result) => (error ? callback(error) : finish(result)))
      }
      Promise.resolve(original(data)).then(finish, callback)
    }) as ExternalFunction
  })
}
