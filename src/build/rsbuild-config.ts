import path from 'path'
import { fileURLToPath } from 'url'
import { type RsbuildConfig } from '@rsbuild/core'
import { OptionalProbesPlugin } from '@src/build/optional-probes.js'
import { RunnableBundlePlugin } from '@src/build/runnable-bundle.js'
import { prepareModifiedTsConfig } from '@src/util/tsconfig.util.js'

/**
 * The module bundled ahead of the application's entry to load `dist/meocord.config.mjs` first. Shipped
 * beside this file, in `src` and in `dist` alike.
 */
export const CONFIG_PRE_ENTRY = path.join(path.dirname(fileURLToPath(import.meta.url)), 'load-config.pre-entry.js')

/**
 * Native accelerators discord.js loads when present and works without. A bundler cannot tell
 * optional from missing, so they stay runtime imports. `node-commonjs` keeps each a `require` at its
 * call site, inside the library's try/catch, where a plain ESM external would hoist an import that
 * throws before the bot starts.
 */
export const DISCORD_OPTIONAL_NATIVES: readonly string[] = ['zlib-sync', 'bufferutil', 'utf-8-validate']

/**
 * The packages kept as `require`s at their call sites and packed only when installed: discord.js's
 * optional accelerators, then the application's `optionalExternals`.
 */
export function optionalExternalNames(optionalExternals: readonly string[] = []): string[] {
  return [...new Set([...DISCORD_OPTIONAL_NATIVES, ...optionalExternals])]
}

/**
 * The `optionalExternals` also listed in `externals`, where each becomes a hoisted import that throws
 * at startup when the package is missing, defeating the point of listing it as optional.
 */
export function optionalExternalConflicts(
  optionalExternals: readonly string[] = [],
  externals: readonly (string | RegExp)[] = [],
): string[] {
  return optionalExternals.filter(name =>
    externals.some(external => (typeof external === 'string' ? external === name : external.test(name))),
  )
}

/**
 * The prefix an asset import is joined to at runtime: the output directory, with forward slashes.
 * Rspack writes it into the bundle unescaped, so a Windows backslash would corrupt every asset path.
 */
export function assetPrefixFor(distDir: string): string {
  return `${distDir.replace(/\\/g, '/').replace(/\/+$/, '')}/`
}

/** How the bundler is asked to build an application. */
export interface RsbuildConfigOptions {
  /** Production enables minification; development keeps readable output. */
  mode: 'production' | 'development'
  /**
   * Entry module. Defaults to `src/main.ts` under the current working directory, which is the
   * application build and gets {@link CONFIG_PRE_ENTRY}; any other entry builds without it.
   */
  entry?: string
  /**
   * Bundle production dependencies into the output so it runs without `node_modules`.
   *
   * Off by default: dependencies stay runtime imports and have to be installed beside the
   * output.
   */
  bundleDependencies?: boolean
  /**
   * Modules to leave as runtime imports even when bundling. Native addons are found without being
   * listed -- see createNativeExternals -- so this is for anything kept out for another reason.
   */
  externals?: (string | RegExp)[]
  /** Packages a dependency tries to load and runs without; see {@link optionalExternalNames}. */
  optionalExternals?: string[]
}

/**
 * The bundler configuration MeoCord builds an application with.
 *
 * Built in code rather than read from a config file, so it is typed, testable, and not
 * something a consumer can edit by accident.
 */
export function createRsbuildConfig(options: RsbuildConfigOptions): RsbuildConfig {
  const { mode, bundleDependencies = false, externals = [], optionalExternals } = options
  const cwd = process.cwd()
  const entry = options.entry ?? path.resolve(cwd, 'src', 'main.ts')
  const assetPrefix = assetPrefixFor(path.resolve(cwd, 'dist'))
  const tsconfigPath = prepareModifiedTsConfig()
  // A watcher takes this copy, written just before it starts, for a change; start --dev watches tsconfig.json instead
  const generated = path.dirname(tsconfigPath) + path.sep

  return {
    // Rsbuild takes the asset prefix from `dev.assetPrefix` in development and from
    // `output.assetPrefix` in production, and the development default is `/`. Both are set, so an
    // asset import is the same path on disk in either mode.
    dev: { assetPrefix },
    source: {
      entry: { main: entry },
      // main.ts imports the application before anything else, so decorator options read process.env
      // before the config's own env loading would otherwise run. Loading it first fixes that for every
      // way of starting the bundle.
      preEntry: options.entry === undefined ? [CONFIG_PRE_ENTRY] : [],
      // Equivalent to experimentalDecorators. The decorators themselves are only half of
      // what MeoCord needs -- see tools.swc below for the half that carries the metadata.
      decorators: { version: 'legacy' },
      tsconfigPath,
    },
    tools: {
      // Set here, not in tools.rspack, which an app's hook may replace.
      bundlerChain: chain => {
        // MeoCord's own generated files never start a rebuild
        chain.watchOptions({ ...chain.get('watchOptions'), ignored: (file: string) => path.resolve(file).startsWith(generated) })
        // The pre-entry records the bundle's own path from import.meta.url, which the bundler would otherwise fix at
        // build time to the pre-entry's source file. In every mode: a process manager such as pm2 starts the bundle
        // from a wrapper of its own, so process.argv[1] names that wrapper, not the bundle
        chain.module.rule('meocord-pre-entry').test(CONFIG_PRE_ENTRY).parser({ importMeta: false })
        // Hoisting modules into one scope renames a class whose name another module also declares, and
        // MeoCord keys cooldowns and names handlers by class name, so a build keeps each module's own scope
        chain.optimization.concatenateModules(false)
        // A build with errors emits nothing, so dist keeps the last bundle that compiled rather than one that throws
        // them, which a bot started from dist, by watch mode or by hand, would run
        chain.optimization.emitOnErrors(false)
        // Keeps the bundle starting under Node and Bun alike, whatever devtool or dependencies it has.
        chain.plugin('meocord-runnable-bundle').use(RunnableBundlePlugin)
        // Says a missing package a dependency only probes for is harmless, and how to silence it
        chain.plugin('meocord-optional-probes').use(OptionalProbesPlugin)
      },
      swc: {
        jsc: {
          // Rsbuild leaves externalHelpers on, which emits the decorator helpers as imports
          // from `@swc/helpers` -- which in turn wants `tslib` resolvable in the application.
          // Inlining them keeps the output self-contained, which matters most when
          // bundleDependencies is on and there is no node_modules to resolve through.
          externalHelpers: false,
          transform: {
            legacyDecorator: true,
            // Inversify resolves constructor arguments from `design:paramtypes`, which swc
            // emits only with this on. Without it every @Controller throws while its class is
            // being defined. It is deep-merged into builtin:swc-loader rather than replacing
            // it, so the rest of Rsbuild's swc defaults still apply.
            decoratorMetadata: true,
          },
        },
      },
    },
    output: {
      target: 'node',
      // Rsbuild 2 already defaults Node builds to ESM; stated so the output format does not
      // silently change with a future default.
      module: true,
      // Inverted deliberately: autoExternal leaves dependencies as runtime imports, so
      // bundling them means turning it off.
      autoExternal: !bundleDependencies,
      externals: [
        Object.fromEntries(optionalExternalNames(optionalExternals).map(name => [name, `node-commonjs ${name}`])),
        ...externals,
      ],
      // Rsbuild would put the bundle in dist/static/js and assets in dist/static/*. The
      // application's entry is dist/main.js, which is what `meocord start` runs.
      // Every kind an import emits, `assets` (pdf, txt and the like) and `wasm` included, lands in dist/assets
      distPath: {
        root: path.resolve(cwd, 'dist'),
        js: '',
        image: 'assets',
        svg: 'assets',
        font: 'assets',
        media: 'assets',
        assets: 'assets',
        wasm: 'assets',
      },
      // No content hash: a bot reads its assets from disk rather than serving them from a CDN, so there is no cache to
      // bust, and stable names keep `dist/assets/` predictable. Two files of one name in different folders stop the build
      // with Rspack's conflict error; each accepts a function too, for an app that needs to keep both names.
      filename: {
        js: '[name].js',
        image: '[name][ext]',
        svg: '[name][ext]',
        font: '[name][ext]',
        media: '[name][ext]',
        assets: '[name][ext]',
        wasm: '[name][ext]',
      },
      // What `import image from './x.png'` evaluates to at runtime. A bot passes that string
      // to fs or to a Discord attachment, so it has to be a real path on disk, which Rsbuild's
      // web-oriented default is not. The pre-entry replaces it at runtime with the bundle's own
      // directory, so a dist copied elsewhere finds its assets; this is what is left without one.
      assetPrefix,
      // Rsbuild inlines assets under 4 KB as base64 data URIs, so the same import would give a
      // path for a large file and a `data:` string for a small one. A bot reads its assets
      // with fs, where a data URI is ENOENT, so every asset is emitted as a file.
      dataUriLimit: 0,
      // Rsbuild emits no source maps in production by default, which would leave a crashed
      // bot's stack trace pointing into the bundle instead of the source.
      // Not an eval devtool in development: an ESM bundle reads import.meta, which an eval'd module cannot.
      sourceMap: { js: mode === 'production' ? 'source-map' : 'cheap-module-source-map' },
      // Rsbuild empties dist before building by default. MeoCord runs two builds into the same
      // directory -- the application, and meocord.config.ts into dist/meocord.config.mjs -- so
      // cleaning would let whichever runs second erase the other.
      cleanDistPath: false,
      minify: {
        // Off by default for Node targets in Rsbuild 2, so production builds would ship
        // unminified unless this is stated.
        js: mode === 'production',
        jsOptions: {
          minimizerOptions: {
            // Inversify resolves dependencies by class identity, so a mangled class name
            // breaks injection in production while development stays fine.
            mangle: { keep_classnames: true, keep_fnames: true },
            compress: { keep_classnames: true, keep_fnames: true },
          },
        },
      },
    },
    mode,
    performance: {
      // The bot is not served over a network; splitting it only makes startup resolve more files.
      chunkSplit: { strategy: 'all-in-one' },
    },
  }
}

/**
 * Refuses a config that declares a `webpack` hook, which MeoCord does not run, rather than building
 * without the customisation. Read as a property rather than with `in`: jiti's interop proxy reaches
 * the default export's properties, but `in` and `Object.keys` only see `default`.
 */
export function assertNoWebpackHook(config: object | undefined): void {
  if ((config as Record<string, unknown> | undefined)?.webpack === undefined) return

  throw new Error(
    'meocord.config.ts still declares a `webpack` hook, which MeoCord no longer runs. ' +
      'Rename it to `rsbuild` and reshape its body for Rsbuild: images, fonts, svg and media ' +
      'need no rules any more, `output.filename` accepts a function for custom asset paths, ' +
      'and raw rules go through `tools.rspack`. See the 4.0.0 release notes.',
  )
}
