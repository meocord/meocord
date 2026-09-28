import { existsSync } from 'fs'
import path from 'path'
import { vi } from 'vitest'

vi.mock('@src/util/tsconfig.util.js', () => ({
  prepareModifiedTsConfig: vi.fn().mockReturnValue('/tmp/modified-tsconfig.json'),
}))

const {
  assertNoWebpackHook,
  assetPrefixFor,
  CONFIG_PRE_ENTRY,
  createRsbuildConfig,
  DISCORD_OPTIONAL_NATIVES,
  optionalExternalConflicts,
} = await import('@src/build/rsbuild-config.js')

const dist = path.resolve(process.cwd(), 'dist')

describe('createRsbuildConfig', () => {
  describe('decorators', () => {
    it('emits the metadata inversify resolves constructor arguments from', () => {
      const config = createRsbuildConfig({ mode: 'production' })

      expect(config.source?.decorators).toEqual({ version: 'legacy' })
      expect(config.tools?.swc).toMatchObject({
        jsc: { transform: { legacyDecorator: true, decoratorMetadata: true } },
      })
    })

    it('inlines swc helpers so the output does not need tslib', () => {
      const config = createRsbuildConfig({ mode: 'production' })

      expect(config.tools?.swc).toMatchObject({ jsc: { externalHelpers: false } })
    })
  })

  // Hoisting modules into one scope renames a class another module names too; the pipeline spec builds it
  it.each(['production', 'development'] as const)('keeps each module in its own scope in a %s build', async mode => {
    const { createRsbuild } = await import('@rsbuild/core')
    const rsbuild = await createRsbuild({ config: createRsbuildConfig({ mode }) })
    const [rspackConfig] = await rsbuild.initConfigs()

    expect(rspackConfig.optimization?.concatenateModules).toBe(false)
  })

  describe('minification', () => {
    // Rsbuild 2 leaves Node builds unminified unless told otherwise.
    it('minifies production builds', () => {
      const config = createRsbuildConfig({ mode: 'production' })

      expect(config.output?.minify).toMatchObject({ js: true })
    })

    it('leaves development builds readable', () => {
      const config = createRsbuildConfig({ mode: 'development' })

      expect(config.output?.minify).toMatchObject({ js: false })
    })

    // A mangled class name breaks injection in production only, while development stays fine.
    it('keeps class and function names through mangling and compression', () => {
      const config = createRsbuildConfig({ mode: 'production' })

      expect(config.output?.minify).toMatchObject({
        jsOptions: {
          minimizerOptions: {
            mangle: { keep_classnames: true, keep_fnames: true },
            compress: { keep_classnames: true, keep_fnames: true },
          },
        },
      })
    })
  })

  describe('output', () => {
    it('writes an ESM bundle to dist/main.js', () => {
      const config = createRsbuildConfig({ mode: 'production' })

      expect(config.output).toMatchObject({
        target: 'node',
        module: true,
        distPath: { root: dist, js: '' },
        filename: { js: '[name].js' },
      })
      expect(config.source?.entry).toEqual({ main: path.resolve(process.cwd(), 'src', 'main.ts') })
    })

    it('uses the entry it is given', () => {
      const config = createRsbuildConfig({ mode: 'production', entry: '/app/src/other.ts' })

      expect(config.source?.entry).toEqual({ main: '/app/src/other.ts' })
    })

    it('loads the compiled config ahead of the application entry', () => {
      const config = createRsbuildConfig({ mode: 'production' })

      expect(config.source?.preEntry).toEqual([CONFIG_PRE_ENTRY])
      expect(existsSync(CONFIG_PRE_ENTRY)).toBe(true)
    })

    // The config build's entry is meocord.config.ts itself, which must not load its own output.
    it('adds no pre-entry to a build with an entry of its own', () => {
      const config = createRsbuildConfig({ mode: 'development', entry: '/app/meocord.config.ts' })

      expect(config.source?.preEntry).toEqual([])
    })

    // The application build and the config build share dist; cleaning let the second erase the first.
    it('does not empty dist before building', () => {
      const config = createRsbuildConfig({ mode: 'production' })

      expect(config.output?.cleanDistPath).toBe(false)
    })

    // An ESM bundle reads import.meta, which a module evaluated from a string cannot.
    it('emits source maps in both modes, never through eval', () => {
      expect(createRsbuildConfig({ mode: 'production' }).output?.sourceMap).toEqual({ js: 'source-map' })
      expect(createRsbuildConfig({ mode: 'development' }).output?.sourceMap).toEqual({ js: 'cheap-module-source-map' })
    })
  })

  describe('assets', () => {
    // An import has to give a path fs can read; Rsbuild inlines small files as data URIs, which fail with ENOENT.
    it('never inlines an asset as a data URI', () => {
      const config = createRsbuildConfig({ mode: 'production' })

      expect(config.output?.dataUriLimit).toBe(0)
    })

    it.each(['production', 'development'] as const)('resolves asset imports to absolute paths under dist in %s', mode => {
      const config = createRsbuildConfig({ mode })

      // Production reads output.assetPrefix and development reads dev.assetPrefix, whose default is `/`.
      expect(config.output?.assetPrefix).toBe(assetPrefixFor(dist))
      expect(config.dev?.assetPrefix).toBe(assetPrefixFor(dist))
      expect(config.output?.assetPrefix).toBe(`${dist.replace(/\\/g, '/')}/`)
    })

    // Rspack emits the prefix unescaped, so a backslash in it corrupted every asset path on Windows.
    it('writes the prefix with forward slashes, which survive being emitted as a string literal', () => {
      expect(assetPrefixFor('D:\\a\\meocord\\dist')).toBe('D:/a/meocord/dist/')
      expect(assetPrefixFor('/srv/bot/dist')).toBe('/srv/bot/dist/')
      expect(assetPrefixFor('/srv/bot/dist/')).toBe('/srv/bot/dist/')
    })

    it('writes assets under dist/assets without a content hash', () => {
      const config = createRsbuildConfig({ mode: 'production' })

      expect(config.output?.distPath).toMatchObject({ image: 'assets', svg: 'assets', font: 'assets', media: 'assets' })
      expect(config.output?.filename).toMatchObject({
        image: '[name][ext]',
        svg: '[name][ext]',
        font: '[name][ext]',
        media: '[name][ext]',
      })
    })
  })

  describe('dependencies', () => {
    it('leaves dependencies as runtime imports by default', () => {
      const config = createRsbuildConfig({ mode: 'production' })

      expect(config.output?.autoExternal).toBe(true)
    })

    it('bundles dependencies when asked to', () => {
      const config = createRsbuildConfig({ mode: 'production', bundleDependencies: true })

      expect(config.output?.autoExternal).toBe(false)
    })

    // A plain name becomes a hoisted static import, which throws before ws's own try/catch runs.
    it('keeps discord.js optional natives as runtime requires rather than static imports', () => {
      const config = createRsbuildConfig({ mode: 'production', bundleDependencies: true })
      const [natives] = config.output?.externals as [Record<string, string>]

      expect(DISCORD_OPTIONAL_NATIVES).toEqual(['zlib-sync', 'bufferutil', 'utf-8-validate'])
      for (const name of DISCORD_OPTIONAL_NATIVES) {
        expect(natives[name]).toBe(`node-commonjs ${name}`)
      }
    })

    it('appends the application externals after the optional natives', () => {
      const config = createRsbuildConfig({ mode: 'production', bundleDependencies: true, externals: ['sharp', /canvas/] })

      expect((config.output?.externals as unknown[]).slice(1)).toEqual(['sharp', /canvas/])
    })
  })
})

describe('assertNoWebpackHook', () => {
  it('accepts a config without a webpack hook', () => {
    expect(() => assertNoWebpackHook({ discordToken: 'token', rsbuild: (c: unknown) => c })).not.toThrow()
    expect(() => assertNoWebpackHook(undefined)).not.toThrow()
  })

  it('refuses a config that still declares one', () => {
    expect(() => assertNoWebpackHook({ discordToken: 'token', webpack: (c: unknown) => c })).toThrow(
      /still declares a `webpack` hook/,
    )
  })

  // How a config loaded from source actually arrives: jiti's interop proxy, where only property
  // access reaches the default export, so a check using `in` would never fire.
  it('refuses one arriving through an interop proxy that hides it from `in`', () => {
    const exported = { discordToken: 'token', webpack: (c: unknown) => c }
    const proxied = new Proxy(
      { default: exported },
      { get: (target, key) => (key in target ? target[key as 'default'] : exported[key as keyof typeof exported]) },
    )

    expect('webpack' in proxied).toBe(false)
    expect(() => assertNoWebpackHook(proxied)).toThrow(/still declares a `webpack` hook/)
  })
})

describe('optional externals', () => {
  const externalsOf = (config: ReturnType<typeof createRsbuildConfig>) =>
    (config.output?.externals as Record<string, string>[])[0]

  it('keeps each name a require at its call site, after discord.js\'s own, once each', () => {
    const optional = externalsOf(
      createRsbuildConfig({ mode: 'production', optionalExternals: ['supports-color', 'bufferutil', '@node-rs/xxhash'] }),
    )

    expect(optional).toEqual({
      'zlib-sync': 'node-commonjs zlib-sync',
      bufferutil: 'node-commonjs bufferutil',
      'utf-8-validate': 'node-commonjs utf-8-validate',
      'supports-color': 'node-commonjs supports-color',
      '@node-rs/xxhash': 'node-commonjs @node-rs/xxhash',
    })
  })

  it('keeps discord.js\'s own without any listed', () => {
    expect(Object.keys(externalsOf(createRsbuildConfig({ mode: 'production' })))).toEqual([...DISCORD_OPTIONAL_NATIVES])
  })

  it('names the optional externals also listed in externals, by name or pattern', () => {
    expect(optionalExternalConflicts(['supports-color', '@node-rs/xxhash', 'x'], ['supports-color', /^@node-rs\//])).toEqual([
      'supports-color',
      '@node-rs/xxhash',
    ])
    expect(optionalExternalConflicts(['supports-color'], ['@opentelemetry/api'])).toEqual([])
  })
})
