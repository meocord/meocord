import { type Rspack } from '@rsbuild/core'
import { typeExternals } from '@src/build/typed-externals.js'

type ExternalFunction = (data: { request?: string; dependencyType?: string }, callback: (error?: Error | null, result?: string) => void) => void

/** What the typed external answers for `request`, asked the way `dependencyType` names. */
function answer(item: Rspack.ExternalItem, request: string, dependencyType: string): Promise<string | undefined> {
  const [typed] = typeExternals([item as Exclude<Rspack.ExternalItem, undefined>])
  return new Promise((resolve, reject) =>
    (typed as unknown as ExternalFunction)({ request, dependencyType }, (error, result) => (error ? reject(error) : resolve(result))),
  )
}

describe('typeExternals', () => {
  it.each([
    ['a package name', 'discord.js'],
    ['an autoExternal pattern', /^discord\.js(?:$|[/\\])/],
    ['a callback that names it', (data: { request?: string }, callback: (error?: null, result?: string) => void) => callback(null, data.request)],
    ['a function that resolves to it', async (data: { request?: string }) => data.request],
  ])('types %s by how the bundle asks for it: import for ESM, require for CommonJS', async (_, item) => {
    expect(await answer(item as Rspack.ExternalItem, 'discord.js', 'esm')).toBe('import discord.js')
    expect(await answer(item as Rspack.ExternalItem, 'discord.js', 'commonjs')).toBe('node-commonjs discord.js')
  })

  it('leaves a request it does not match to the bundle', async () => {
    expect(await answer('discord.js', 'dotenv', 'esm')).toBeUndefined()
  })

  it('keeps the type a function gives, and leaves an object as it is', async () => {
    const zlib = (_: unknown, callback: (error?: null, result?: string) => void) => callback(null, 'node-commonjs zlib-sync')
    const map = { 'zlib-sync': 'node-commonjs zlib-sync' }

    expect(await answer(zlib, 'zlib-sync', 'esm')).toBe('node-commonjs zlib-sync')
    expect(typeExternals([map])).toEqual([map])
  })
})
