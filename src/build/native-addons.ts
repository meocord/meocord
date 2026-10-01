import { cpSync, existsSync, readdirSync, readFileSync, realpathSync } from 'fs'
import path from 'path'
import { type BuildPlatform, currentPlatform } from '@src/util/platform.util.js'

/**
 * The package a resolved module file belongs to, and the directory it was installed in.
 *
 * Takes the innermost `node_modules` segment, so a nested copy is attributed to itself rather
 * than to the package it is nested under. Undefined for application code.
 */
export function packageFromPath(file: string): { name: string; dir: string } | undefined {
  // A module identifier can carry loaders before the resource (`loader!/path/to/file`) and a
  // query after it; only the path itself says where the package lives.
  const resource = file.slice(file.lastIndexOf('!') + 1).split('?')[0]
  const segments = resource.split(/[\\/]/)
  const index = segments.lastIndexOf('node_modules')
  if (index === -1 || index + 1 >= segments.length) return undefined

  const scoped = segments[index + 1].startsWith('@')
  if (scoped && index + 2 >= segments.length) return undefined
  const end = index + (scoped ? 3 : 2)
  return { name: segments.slice(index + 1, end).join('/'), dir: segments.slice(0, end).join(path.sep) }
}

/** The part of bundler stats this reads: modules, possibly concatenated into others, per child. */
interface StatsModule {
  nameForCondition?: string | null
  identifier?: string | null
  modules?: StatsModule[] | null
  children?: StatsModule[] | null
}
interface StatsJson {
  modules?: StatsModule[] | null
  children?: StatsJson[] | null
}
interface StatsLike {
  toJson(options: object): StatsJson
}

/**
 * Every source file a build pulled into its output.
 *
 * Concatenated modules nest their members, and a multi-environment build nests whole
 * compilations as children, so both are walked.
 */
export function bundledModuleFiles(stats: StatsLike | undefined): string[] {
  if (!stats) return []
  const json = stats.toJson({
    all: false,
    modules: true,
    nestedModules: true,
    // A production build concatenates most of node_modules into a few modules, and the members
    // of a concatenation are orphans -- hidden from stats unless asked for. Without this every
    // concatenated package, sharp included, is invisible here.
    orphanModules: true,
    modulesSpace: Infinity,
    nestedModulesSpace: Infinity,
  })
  const collect = (modules: StatsModule[] | null | undefined): string[] =>
    (modules ?? []).flatMap(module => [
      module.nameForCondition ?? module.identifier ?? '',
      ...collect(module.modules),
      // Stats may group modules by path, nesting them under `children`.
      ...collect(module.children),
    ])
  const compilations = json.children?.length ? json.children : [json]
  return compilations.flatMap(compilation => collect(compilation.modules)).filter(Boolean)
}

/** Whether a directory holds a compiled addon, not counting packages nested inside it. */
function containsNativeBinary(dir: string, depth = 0): boolean {
  if (depth > 5) return false
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return false
  }
  return entries.some(entry => {
    if (entry.isFile()) return entry.name.endsWith('.node')
    if (!entry.isDirectory() || entry.name === 'node_modules') return false
    return containsNativeBinary(path.join(dir, entry.name), depth + 1)
  })
}

/** The `node_modules` directories Node looks in for a package required from `dir`, nearest first. */
function lookupDirs(dir: string): string[] {
  const dirs: string[] = []
  for (let current = path.resolve(dir); ; current = path.dirname(current)) {
    if (path.basename(current) !== 'node_modules') dirs.push(path.join(current, 'node_modules'))
    if (path.dirname(current) === current) return dirs
  }
}

/**
 * Where `name` resolves from `from` the way Node would: nested under it, beside it in pnpm's store, or in a
 * `node_modules` further up, else the project's. Undefined when it is not installed.
 */
function resolvePackageDir(name: string, from: string, root: string): string | undefined {
  const candidates = [...lookupDirs(from), path.join(root, 'node_modules')].map(dir => path.join(dir, name))
  return candidates.find(dir => existsSync(path.join(dir, 'package.json')))
}

/** A package's declared dependencies, runtime and optional, or none if it cannot be read. */
function readDependencies(dir: string): { dependencies: string[]; optional: string[] } {
  try {
    const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'))
    return { dependencies: Object.keys(pkg.dependencies ?? {}), optional: Object.keys(pkg.optionalDependencies ?? {}) }
  } catch {
    return { dependencies: [], optional: [] }
  }
}

/**
 * The packages among `names` that are installed in the project, each with its directory and whether it
 * carries a native binary. A name that is not installed is left out, which is how an optional package
 * is packed only when present.
 */
export function installedPackages(names: readonly string[], root: string): { name: string; dir: string; native: boolean }[] {
  return names.flatMap(name => {
    const linked = path.join(root, 'node_modules', name)
    if (!existsSync(path.join(linked, 'package.json'))) return []
    // Where it really is: pnpm links it from its store, beside the dependencies it was installed with
    const dir = realpathSync(linked)
    return [{ name, dir, native: nativeCarrier(dir, name, root) !== undefined }]
  })
}

/**
 * The package holding the compiled addon an installed package loads, or undefined for plain
 * JavaScript. node-gyp packages keep the binary under their own `build/Release`; napi-rs packages
 * and sharp publish it as a per-platform optional dependency.
 */
export function nativeCarrier(dir: string, name: string, root: string): string | undefined {
  // Where it really is: a platform package sits beside the real directory in pnpm's store, not beside a link to it
  const real = realpathSync(dir)
  if (containsNativeBinary(real)) return name
  return readDependencies(real).optional.find(dependency => {
    const dependencyDir = resolvePackageDir(dependency, real, root)
    return dependencyDir !== undefined && containsNativeBinary(dependencyDir)
  })
}

/** Bundled packages that load a native addon, mapped to the package holding the binary. */
export function findBundledNativeAddons(bundledFiles: Iterable<string>, root: string): Map<string, string> {
  const packages = new Map<string, string>()
  for (const file of bundledFiles) {
    const found = packageFromPath(file)
    if (found && !packages.has(found.dir)) packages.set(found.dir, found.name)
  }

  const natives = new Map<string, string>()
  for (const [dir, name] of packages) {
    if (natives.has(name)) continue
    const carrier = nativeCarrier(dir, name, root)
    if (carrier) natives.set(name, carrier)
  }
  return natives
}

/**
 * The package a bare import request names, or undefined for a relative path, an absolute path, or
 * a Node builtin -- none of which live in node_modules.
 */
export function packageNameOfRequest(request: string): string | undefined {
  if (!request || request.startsWith('.') || request.startsWith('/') || /^[a-z]+:/i.test(request)) return undefined
  if (/^[A-Za-z]:[\\/]/.test(request)) return undefined
  const [first, second] = request.split('/')
  if (!first.startsWith('@')) return first
  return second ? `${first}/${second}` : undefined
}

/** A native package kept out of the bundle, and where it was installed. */
export interface NativePackage {
  /** Directory the package resolved to. */
  dir: string
  /** The package holding the compiled binary: the package itself, or its platform package. */
  carrier: string
}

interface ExternalRequest {
  request?: string
  context?: string
}
type ExternalCallback = (error?: Error, result?: string) => void

/**
 * An Rspack `externals` function that keeps every native addon out of the bundle.
 *
 * Decided while the bundler resolves imports, so it sees every request -- including one made by a
 * plain JavaScript dependency deep in the graph -- and never has to be told what to look for. Each
 * native package it keeps out is recorded in `found`, so the build can copy it into the output.
 */
export function createNativeExternals(root: string): {
  externals: (data: ExternalRequest, callback: ExternalCallback) => void
  found: Map<string, NativePackage>
} {
  const found = new Map<string, NativePackage>()
  const plain = new Set<string>()

  const externals = ({ request, context }: ExternalRequest, callback: ExternalCallback) => {
    const name = request ? packageNameOfRequest(request) : undefined
    if (!name || plain.has(name)) return callback()
    if (found.has(name)) return callback(undefined, request)

    const dir = resolvePackageDir(name, context ?? root, root)
    const carrier = dir ? nativeCarrier(dir, name, root) : undefined
    if (!dir || !carrier) {
      plain.add(name)
      return callback()
    }
    found.set(name, { dir, carrier })
    callback(undefined, request)
  }

  return { externals, found }
}

/**
 * Whether a value passes a package.json `os`, `cpu` or `libc` list, the way npm reads one: a `!`
 * entry excludes its value, and a list with plain entries admits only those.
 */
function allowedBy(list: unknown, value: string): boolean {
  if (!Array.isArray(list) || list.length === 0) return true
  const entries = list.filter((entry): entry is string => typeof entry === 'string')
  if (entries.includes(`!${value}`)) return false
  const admitted = entries.filter(entry => !entry.startsWith('!'))
  return admitted.length === 0 || admitted.includes(value)
}

/**
 * Whether an installed package is built for the platform, going by the `os`, `cpu` and `libc` its
 * package.json declares. A package that declares none of them runs anywhere.
 *
 * `libc` is compared only when the build platform's C library is known, so a runtime that cannot
 * report it keeps the package rather than dropping it on a guess.
 */
export function isBuiltFor(dir: string, platform: BuildPlatform): boolean {
  let pkg: { os?: unknown; cpu?: unknown; libc?: unknown }
  try {
    pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'))
  } catch {
    return true
  }
  if (!allowedBy(pkg.os, platform.platform) || !allowedBy(pkg.cpu, platform.arch)) return false
  return !platform.libc || allowedBy(pkg.libc, platform.libc)
}

/**
 * Copies packages and their runtime dependencies into `<outDir>/node_modules`, skipping `@types` and other platforms'
 * builds (bun installs both libc builds on Linux). The listed ones take the top; each dependency goes where Node,
 * resolving from the package that needs it, finds the version it was installed with: a copy already on its way up,
 * else the top when the name is free, else nested under that package, as one installed nested is. Returns the names.
 */
export function copyPackagesInto(
  packages: Map<string, string>,
  root: string,
  outDir: string,
  platform: BuildPlatform = currentPlatform(),
): string[] {
  const topDir = path.join(path.resolve(outDir), 'node_modules')
  // Each package written into dist, by where it is, with the directory it was copied from
  const written = new Map<string, string>()
  const copied = new Set<string>()
  const pending: { target: string; dir: string }[] = []

  // Without its own node_modules: each dependency in there is placed like any other
  const write = (name: string, dir: string, target: string) => {
    written.set(target, dir)
    copied.add(name)
    const nested = path.join(dir, 'node_modules')
    cpSync(dir, target, { recursive: true, dereference: true, filter: source => source !== nested })
    pending.push({ target, dir })
  }

  // The copy Node finds for `name` from the package written at `from`, looking no further up than dist
  const resolvedInDist = (name: string, from: string) => {
    for (const dir of lookupDirs(from)) {
      const source = written.get(path.join(dir, name))
      if (source !== undefined) return source
      if (dir === topDir) return undefined
    }
    return undefined
  }

  const listed = [...packages].filter(([name]) => !name.startsWith('@types/')).map(([name, dir]) => [name, realpathSync(dir)] as const)
  for (const [name, dir] of listed) write(name, dir, path.join(topDir, name))

  // A queue, walked as it grows: a package's dependencies are all placed before any of theirs, so a copy nested under
  // it later cannot come between one of them and a version it already resolved further up
  for (const next of pending) {
    const { dependencies, optional } = readDependencies(next.dir)
    for (const dependency of new Set([...dependencies, ...optional])) {
      if (dependency.startsWith('@types/')) continue
      const found = resolvePackageDir(dependency, next.dir, root)
      if (!found || !isBuiltFor(found, platform)) continue
      const dir = realpathSync(found)
      const resolved = resolvedInDist(dependency, next.target)
      if (resolved === dir) continue
      const installedNested = dir.startsWith(path.join(next.dir, 'node_modules') + path.sep)
      const target = resolved === undefined && !installedNested ? path.join(topDir, dependency) : path.join(next.target, 'node_modules', dependency)
      if (!written.has(target)) write(dependency, dir, target)
    }
  }
  return [...copied]
}

/**
 * Refuses a bundled build that swallowed a native addon. Such a build works on the build machine,
 * by resolving the addon into its node_modules, and fails anywhere else when the addon first loads.
 */
export function assertNoBundledNativeAddons(found: Map<string, string>): void {
  if (found.size === 0) return

  const lines = [...found].map(([bundled, carrier]) =>
    carrier === bundled ? `  - ${bundled}` : `  - ${bundled} (its binary ships in ${carrier})`,
  )
  const names = [...found.keys()].map(name => `'${name}'`).join(', ')
  throw new Error(
    `bundleDependencies bundled ${found.size === 1 ? 'a package that loads' : 'packages that load'} a native addon:\n` +
      `${lines.join('\n')}\n` +
      'A native addon is a compiled binary for one platform and cannot travel inside the bundle. The build ' +
      'would run on this machine and fail in production the first time the addon loads. Keep ' +
      `${found.size === 1 ? 'it' : 'them'} out of the bundle and install ${found.size === 1 ? 'it' : 'them'} ` +
      `on the server:\n\n  externals: [${names}]`,
  )
}
