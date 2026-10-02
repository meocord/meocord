import type { Rspack } from '@rsbuild/core'

const NAME = 'MeoCordRunnableBundlePlugin'

type Devtool = Rspack.RspackOptionsNormalized['devtool']

/**
 * The devtool to build with instead of an `eval` one, and why. An ESM bundle reads `import.meta` -- the
 * pre-entry records the bundle's path from it -- and a module evaluated from a string cannot, so under
 * an `eval` devtool the bundle stops at its first line with a SyntaxError. Each maps to the same source
 * map without the eval: `eval-source-map` to `source-map`, and plain `eval`, which has none, to none.
 */
export function nonEvalDevtool(devtool: unknown): { devtool: Devtool; message: string } | undefined {
  if (typeof devtool !== 'string' || !/^eval(-|$)/.test(devtool)) return undefined
  // Every eval devtool but plain `eval` names a valid one once its prefix is taken off.
  const replacement = (devtool === 'eval' ? false : devtool.slice('eval-'.length)) as Devtool
  return {
    devtool: replacement,
    message:
      `The build asked for the "${devtool}" devtool, which evaluates each module from a string, where the ` +
      `bundle cannot read import.meta and would stop at startup. Building with ` +
      `${replacement ? `"${replacement}"` : 'no source map'} instead; set output.sourceMap.js to it to silence this.`,
  }
}

/**
 * The swc options that make an ESM chunk's free `module` and `exports` what they are in any ES module:
 * undefined. Only references nothing in the chunk declares are replaced, so a CommonJS module's factory,
 * which receives both as parameters, keeps its own.
 */
export const freeCommonJsGlobals = (compact: boolean) => ({
  isModule: true,
  jsc: {
    parser: { syntax: 'ecmascript' as const },
    target: 'esnext' as const,
    preserveAllComments: !compact,
    transform: {
      optimizer: {
        // `typeof exports` follows, as `typeof undefined`.
        globals: { vars: { module: 'undefined', exports: 'undefined' } },
      },
    },
    // Printed as compactly as the minifier left it, and changed nowhere else.
    ...(compact ? { minify: { compress: false, mangle: false } } : {}),
  },
  minify: compact,
})

/**
 * Keeps a bundle starting under Node and Bun: replaces an `eval` devtool, with a warning ({@link nonEvalDevtool}),
 * and after the size optimisations makes each chunk's free `module` and `exports` undefined ({@link freeCommonJsGlobals}).
 * An ES module probing for CommonJS, as lodash-es does, leaves them in the top scope, where Bun reads it as CommonJS.
 */
export class RunnableBundlePlugin implements Rspack.RspackPluginInstance {
  apply(compiler: Rspack.Compiler): void {
    const replaced = nonEvalDevtool(compiler.options.devtool)
    if (replaced) compiler.options.devtool = replaced.devtool

    const { Compilation, experiments, sources, WebpackError } = compiler.rspack
    const compact = compiler.options.optimization.minimize === true

    compiler.hooks.thisCompilation.tap(NAME, compilation => {
      if (replaced) compilation.warnings.push(new WebpackError(replaced.message))

      compilation.hooks.processAssets.tap({ name: NAME, stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE + 1 }, assets => {
        for (const [file, asset] of Object.entries(assets)) {
          if (!/\.m?js$/.test(file)) continue
          const { source, map } = asset.sourceAndMap()
          const code = source.toString()
          const output = experiments.swc.transformSync(code, {
            ...freeCommonJsGlobals(compact),
            filename: file,
            sourceMaps: Boolean(map),
            ...(map ? { inputSourceMap: JSON.stringify(map) } : {}),
          })
          // swc composes its map with the one it was given, so the result maps back to the sources.
          compilation.updateAsset(
            file,
            output.map ? new sources.SourceMapSource(output.code, file, output.map) : new sources.RawSource(output.code),
          )
        }
      })
    })
  }
}
