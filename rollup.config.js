import swc from '@rollup/plugin-swc'
import alias from '@rollup/plugin-alias'
import resolve from '@rollup/plugin-node-resolve'
import json from '@rollup/plugin-json'
import copy from 'rollup-plugin-copy'
import dts from 'rollup-plugin-dts'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const libraryEntries = {
  'core/index': 'src/core/index.ts',
  'common/index': 'src/common/index.ts',
  'decorator/index': 'src/decorator/index.ts',
  'interface/index': 'src/interface/index.ts',
  'enum/index': 'src/enum/index.ts',
  'testing/index': 'src/testing/index.ts',
}

const cliEntry = {
  'bin/meocord': 'src/bin/meocord.ts',
}

// Imported by the pre-entry, which is copied rather than compiled, so nothing else pulls it into the build
const preEntryModules = {
  'build/stack-remap': 'src/build/stack-remap.ts',
}


const allEntries = { ...libraryEntries, ...cliEntry, ...preEntryModules }

const aliasPlugin = alias({
  entries: [{ find: /^@src\/(.*)/, replacement: path.resolve(__dirname, 'src/$1') }],
})

const swcPlugin = swc({
  include: /\.ts$/,
  swc: {
    jsc: {
      parser: {
        syntax: 'typescript',
        tsx: false,
        decorators: true,
      },
      transform: {
        decoratorMetadata: true,
        legacyDecorator: true,
      },
    },
  },
})

const resolvePlugin = resolve({ extensions: ['.ts', '.js'] })

/**
 * Whether an id belongs to something outside this package.
 *
 * Decided by the shape of the specifier rather than its first character: a resolved
 * path on Windows begins with a drive letter, so testing for one would classify every
 * source file in the package as a dependency and refuse to build.
 */
const external = id => {
  if (id.startsWith('@src/')) return false
  if (id.startsWith('.')) return false
  if (path.isAbsolute(id)) return false

  // What is left is a bare specifier: a node builtin or a package.
  return true
}

/** Suppress expected warnings for type-only barrel files, and fail on a public type no entry exports */
const onwarn = (warning, warn) => {
  if (warning.code === 'EMPTY_BUNDLE' && warning.message.includes('interface/index')) {
    return // Type-only files produce empty bundles by design
  }
  // Consumers would get TS2742 naming a hashed chunk, where the type needs an entry to export it
  if (warning.message.includes('private shared type exports with no public re-export')) {
    throw new Error(warning.message)
  }
  warn(warning)
}

/** CJS build: library entries only (no CLI) */
const cjsBuild = {
  input: libraryEntries,
  external,
  onwarn,
  plugins: [aliasPlugin, swcPlugin, json(), resolvePlugin],
  output: {
    dir: 'dist/cjs',
    format: 'cjs',
    // A default import reads `.default` from a module that has one, as Node's require() of an ES module returns its
    // namespace, and takes module.exports itself from a CommonJS module that hasn't. Rollup's own default hands on
    // require()'s value as the default import, which is the namespace, not its default, for an ESM-only package
    interop: 'compat',
    entryFileNames: '[name].cjs',
    chunkFileNames: '_shared/[name]-[hash].cjs',
    preserveModules: false,
    sourcemap: false,
  },
}

/** ESM build: all entries (library + CLI), preserves directory structure */
const esmBuild = {
  input: allEntries,
  external,
  onwarn,
  plugins: [
    aliasPlugin,
    swcPlugin,
    json(),
    resolvePlugin,
    copy({
      targets: [
        {
          src: 'src/bin/builder-template',
          dest: 'dist/esm/bin',
        },
        {
          src: 'src/bin/app-template',
          dest: 'dist/esm/bin',
        },
        {
          src: 'src/build/load-config.pre-entry.js',
          dest: 'dist/esm/build',
        },
      ],
    }),
  ],
  output: {
    dir: 'dist/esm',
    format: 'es',
    entryFileNames: '[name].js',
    chunkFileNames: '[name].js',
    preserveModules: true,
    preserveModulesRoot: 'src',
    sourcemap: false,
  },
}

/** Declaration build: library entries only */
const dtsBuild = {
  input: libraryEntries,
  external,
  onwarn,
  plugins: [aliasPlugin, dts()],
  output: {
    dir: 'dist/types',
    format: 'es',
    entryFileNames: '[name].d.ts',
  },
}

/**
 * Declarations for `require()`: the same types, as `.d.cts`. A CommonJS consumer resolving through
 * the `require` condition is otherwise handed the ESM `.d.ts`, and TypeScript types the CommonJS
 * build as an ES module -- attw's "masquerading as ESM".
 */
const dtsCjsBuild = {
  ...dtsBuild,
  output: {
    ...dtsBuild.output,
    entryFileNames: '[name].d.cts',
    chunkFileNames: '[name]-[hash].d.cts',
  },
}

export default [esmBuild, cjsBuild, dtsBuild, dtsCjsBuild]
