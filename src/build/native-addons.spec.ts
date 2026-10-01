import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import {
  assertNoBundledNativeAddons,
  bundledModuleFiles,
  copyPackagesInto,
  installedPackages,
  createNativeExternals,
  findBundledNativeAddons,
  packageFromPath,
  packageNameOfRequest,
} from '@src/build/native-addons.js'

let root: string

/** Writes an installed package: a package.json, optionally with optional dependencies and a binary. */
function install(
  dir: string,
  name: string,
  options: { optional?: string[]; dependencies?: string[]; binary?: string; os?: string[]; cpu?: string[]; libc?: string[] } = {},
) {
  mkdirSync(dir, { recursive: true })
  const toVersions = (names: string[] = []) => Object.fromEntries(names.map(dependency => [dependency, '1.0.0']))
  writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({
      name,
      version: '1.0.0',
      dependencies: toVersions(options.dependencies),
      optionalDependencies: toVersions(options.optional),
      os: options.os,
      cpu: options.cpu,
      libc: options.libc,
    }),
  )
  writeFileSync(path.join(dir, 'index.js'), 'export {}')
  if (options.binary) {
    mkdirSync(path.dirname(path.join(dir, options.binary)), { recursive: true })
    writeFileSync(path.join(dir, options.binary), 'not really a binary')
  }
}

const moduleIn = (...segments: string[]) => path.join(root, 'node_modules', ...segments, 'index.js')

beforeEach(() => {
  // Resolved, since a package's directory is its real path, and macOS links its temp folder
  root = realpathSync(mkdtempSync(path.join(tmpdir(), 'meocord-native-')))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('packageFromPath', () => {
  it('names the package a module file belongs to', () => {
    expect(packageFromPath('/app/node_modules/sharp/lib/index.js')).toEqual({
      name: 'sharp',
      dir: path.join('/app', 'node_modules', 'sharp'),
    })
  })

  it('keeps the scope of a scoped package', () => {
    expect(packageFromPath('/app/node_modules/@img/sharp-linux-x64/lib/index.js')?.name).toBe('@img/sharp-linux-x64')
  })

  it('attributes a nested copy to itself rather than its parent', () => {
    expect(packageFromPath('/app/node_modules/sharp/node_modules/semver/index.js')).toEqual({
      name: 'semver',
      dir: path.join('/app', 'node_modules', 'sharp', 'node_modules', 'semver'),
    })
  })

  it('reads through loaders and queries on a module identifier', () => {
    const identifier = 'builtin:swc-loader??ruleSet[1]!/app/node_modules/dayjs/index.js?x=1'
    expect(packageFromPath(identifier)?.dir).toBe(path.join('/app', 'node_modules', 'dayjs'))
  })

  it('returns undefined for application code', () => {
    expect(packageFromPath('/app/src/main.ts')).toBeUndefined()
  })
})

describe('bundledModuleFiles', () => {
  it('returns nothing without stats', () => {
    expect(bundledModuleFiles(undefined)).toEqual([])
  })

  // A production build concatenates most packages; their members only appear as orphans.
  it('asks for orphan modules, which is where concatenated packages are listed', () => {
    let options: Record<string, unknown> = {}
    bundledModuleFiles({
      toJson: received => {
        options = received as Record<string, unknown>
        return {}
      },
    })

    expect(options).toMatchObject({ orphanModules: true, nestedModules: true, modulesSpace: Infinity })
  })

  it('walks concatenated members, path groups, and child compilations', () => {
    const stats = {
      toJson: () => ({
        children: [
          {
            modules: [
              { nameForCondition: '/app/src/main.ts', modules: [{ nameForCondition: '/app/node_modules/a/index.js' }] },
              { children: [{ identifier: 'loader!/app/node_modules/b/index.js' }] },
            ],
          },
        ],
      }),
    }

    expect(bundledModuleFiles(stats)).toEqual([
      '/app/src/main.ts',
      '/app/node_modules/a/index.js',
      'loader!/app/node_modules/b/index.js',
    ])
  })
})

describe('findBundledNativeAddons', () => {
  it('finds a package that ships its own binary', () => {
    install(path.join(root, 'node_modules', 'bindings-lib'), 'bindings-lib', { binary: 'build/Release/addon.node' })

    const found = findBundledNativeAddons([moduleIn('bindings-lib')], root)

    expect([...found]).toEqual([['bindings-lib', 'bindings-lib']])
  })

  // sharp's layout: the wrapper is JavaScript, and the binary is an optional per-platform package.
  it('finds a wrapper whose binary ships in an installed optional dependency', () => {
    install(path.join(root, 'node_modules', 'sharp'), 'sharp', {
      optional: ['@img/sharp-linux-x64', '@img/sharp-darwin-arm64'],
    })
    install(path.join(root, 'node_modules', '@img', 'sharp-darwin-arm64'), '@img/sharp-darwin-arm64', {
      binary: 'lib/sharp.node',
    })

    const found = findBundledNativeAddons([moduleIn('sharp')], root)

    expect([...found]).toEqual([['sharp', '@img/sharp-darwin-arm64']])
  })

  it('finds an optional dependency installed beside the wrapper, as pnpm lays it out', () => {
    const store = path.join(root, 'node_modules', '.pnpm', 'sharp@1.0.0', 'node_modules')
    install(path.join(store, 'sharp'), 'sharp', { optional: ['@img/sharp-darwin-arm64'] })
    install(path.join(store, '@img', 'sharp-darwin-arm64'), '@img/sharp-darwin-arm64', { binary: 'sharp.node' })

    const found = findBundledNativeAddons([path.join(store, 'sharp', 'index.js')], root)

    expect(found.get('sharp')).toBe('@img/sharp-darwin-arm64')
  })

  it('ignores packages with no binary anywhere', () => {
    install(path.join(root, 'node_modules', 'dayjs'), 'dayjs')
    install(path.join(root, 'node_modules', 'wrapper'), 'wrapper', { optional: ['not-installed-for-this-platform'] })

    const found = findBundledNativeAddons([moduleIn('dayjs'), moduleIn('wrapper'), '/app/src/main.ts'], root)

    expect(found.size).toBe(0)
  })

  it('does not look inside packages nested under a bundled one', () => {
    install(path.join(root, 'node_modules', 'outer'), 'outer')
    install(path.join(root, 'node_modules', 'outer', 'node_modules', 'inner'), 'inner', { binary: 'inner.node' })

    const found = findBundledNativeAddons([moduleIn('outer')], root)

    expect(found.size).toBe(0)
  })
})

describe('assertNoBundledNativeAddons', () => {
  it('accepts a build with no native addons', () => {
    expect(() => assertNoBundledNativeAddons(new Map())).not.toThrow()
  })

  it('names each addon and the externals line that fixes it', () => {
    const found = new Map([
      ['sharp', '@img/sharp-darwin-arm64'],
      ['bindings-lib', 'bindings-lib'],
    ])

    expect(() => assertNoBundledNativeAddons(found)).toThrow(/sharp \(its binary ships in @img\/sharp-darwin-arm64\)/)
    expect(() => assertNoBundledNativeAddons(found)).toThrow(/- bindings-lib\n/)
    expect(() => assertNoBundledNativeAddons(found)).toThrow("externals: ['sharp', 'bindings-lib']")
  })
})

describe('packageNameOfRequest', () => {
  it.each([
    ['sharp', 'sharp'],
    ['sharp/lib/index.js', 'sharp'],
    ['@img/sharp-linux-x64', '@img/sharp-linux-x64'],
    ['@img/sharp-linux-x64/lib/sharp.node', '@img/sharp-linux-x64'],
  ])('names the package a bare request %s imports', (request, name) => {
    expect(packageNameOfRequest(request)).toBe(name)
  })

  it.each(['./local', '../up', '/abs/path', 'node:fs', 'C:\\app\\file.js', '@scope', ''])(
    'is undefined for %s, which is not in node_modules',
    request => {
      expect(packageNameOfRequest(request)).toBeUndefined()
    },
  )
})

describe('createNativeExternals', () => {
  /** Runs the externals function the way Rspack does and reports what it decided. */
  function decide(externals: ReturnType<typeof createNativeExternals>['externals'], request: string, context = root) {
    let result: string | undefined = 'not called'
    externals({ request, context }, (_error, value) => {
      result = value
    })
    return result
  }

  it('keeps a native package out of the bundle and records it', () => {
    install(path.join(root, 'node_modules', 'sharp'), 'sharp', { optional: ['@img/sharp-darwin-arm64'] })
    install(path.join(root, 'node_modules', '@img', 'sharp-darwin-arm64'), '@img/sharp-darwin-arm64', {
      binary: 'lib/sharp.node',
    })
    const { externals, found } = createNativeExternals(root)

    expect(decide(externals, 'sharp')).toBe('sharp')
    expect(found.get('sharp')).toEqual({
      dir: path.join(root, 'node_modules', 'sharp'),
      carrier: '@img/sharp-darwin-arm64',
    })
  })

  it('lets plain JavaScript be bundled', () => {
    install(path.join(root, 'node_modules', 'dayjs'), 'dayjs')
    const { externals, found } = createNativeExternals(root)

    expect(decide(externals, 'dayjs')).toBeUndefined()
    expect(found.size).toBe(0)
  })

  it('leaves relative imports, builtins, and uninstalled packages to the bundler', () => {
    const { externals } = createNativeExternals(root)

    expect(decide(externals, './local')).toBeUndefined()
    expect(decide(externals, 'node:fs')).toBeUndefined()
    expect(decide(externals, 'not-installed')).toBeUndefined()
  })

  // A native addon imported by a plain JavaScript dependency, from that dependency's own node_modules.
  it('finds a native package nested under the package that imports it', () => {
    const parent = path.join(root, 'node_modules', 'orm')
    install(parent, 'orm')
    install(path.join(parent, 'node_modules', 'sqlite-native'), 'sqlite-native', { binary: 'build/Release/db.node' })
    const { externals, found } = createNativeExternals(root)

    expect(decide(externals, 'sqlite-native', path.join(parent, 'lib'))).toBe('sqlite-native')
    expect(found.get('sqlite-native')?.dir).toBe(path.join(parent, 'node_modules', 'sqlite-native'))
  })

  it('keeps the same request external every time it is met, and reads each package once', () => {
    install(path.join(root, 'node_modules', 'bindings-lib'), 'bindings-lib', { binary: 'addon.node' })
    const { externals } = createNativeExternals(root)

    expect(decide(externals, 'bindings-lib')).toBe('bindings-lib')
    rmSync(path.join(root, 'node_modules', 'bindings-lib'), { recursive: true })
    expect(decide(externals, 'bindings-lib/sub.js')).toBe('bindings-lib/sub.js')
  })
})

describe('installedPackages', () => {
  it('returns only the listed packages that are installed, marking the one that carries a binary', () => {
    install(path.join(root, 'node_modules', 'supports-color'), 'supports-color')
    install(path.join(root, 'node_modules', 'bufferutil'), 'bufferutil', { binary: 'build/Release/bufferutil.node' })

    const found = installedPackages(['supports-color', '@node-rs/xxhash', 'bufferutil'], root)

    expect(found).toEqual([
      { name: 'supports-color', dir: path.join(root, 'node_modules', 'supports-color'), native: false },
      { name: 'bufferutil', dir: path.join(root, 'node_modules', 'bufferutil'), native: true },
    ])
  })

  it('packs an installed optional package into dist/node_modules', () => {
    install(path.join(root, 'node_modules', 'supports-color'), 'supports-color', { dependencies: ['has-flag'] })
    install(path.join(root, 'node_modules', 'has-flag'), 'has-flag')
    const out = path.join(root, 'dist')

    const packages = new Map(installedPackages(['supports-color'], root).map(({ name, dir }) => [name, dir]))
    copyPackagesInto(packages, root, out)

    expect(existsSync(path.join(out, 'node_modules', 'supports-color', 'package.json'))).toBe(true)
    expect(existsSync(path.join(out, 'node_modules', 'has-flag', 'package.json'))).toBe(true)
  })
})

/**
 * A project as pnpm installs it: each package in its own store folder, beside links to the dependencies it was installed
 * with, and only the direct dependencies linked from the project's node_modules.
 */
function pnpmProject(
  packages: { name: string; version: string; dependencies?: Record<string, string>; optional?: Record<string, string>; binary?: string }[],
  direct: string[],
) {
  const store = (name: string, version: string) => path.join(root, 'node_modules', '.pnpm', `${name}@${version}`, 'node_modules')
  const link = (target: string, at: string) => {
    mkdirSync(path.dirname(at), { recursive: true })
    symlinkSync(target, at, 'junction')
  }
  for (const { name, version, dependencies = {}, optional = {}, binary } of packages) {
    const dir = path.join(store(name, version), name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version, dependencies, optionalDependencies: optional }))
    writeFileSync(path.join(dir, 'index.js'), 'export {}')
    if (binary) writeFileSync(path.join(dir, binary), 'not really a binary')
    for (const [dependency, dependencyVersion] of Object.entries({ ...dependencies, ...optional })) {
      link(path.join(store(dependency, dependencyVersion), dependency), path.join(store(name, version), dependency))
    }
  }
  for (const spec of direct) {
    const at = spec.lastIndexOf('@')
    const [name, version] = [spec.slice(0, at), spec.slice(at + 1)]
    link(path.join(store(name, version), name), path.join(root, 'node_modules', name))
  }
}

const versionIn = (dir: string) => (JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as { version: string }).version

describe('a project pnpm installed', () => {
  // pnpm links an external from its store; its dependencies are beside it there, not in the project's node_modules
  it("packs a listed package's dependencies, which sit beside it in pnpm's store", () => {
    pnpmProject([{ name: 'wrapper', version: '1.0.0', dependencies: { ms: '2.1.3' } }, { name: 'ms', version: '2.1.3' }], ['wrapper@1.0.0'])
    const out = path.join(root, 'dist')

    copyPackagesInto(new Map(installedPackages(['wrapper'], root).map(({ name, dir }) => [name, dir])), root, out)

    expect(versionIn(path.join(out, 'node_modules', 'ms'))).toBe('2.1.3')
  })

  // napi-rs publishes the binary as a per-platform optional dependency, which pnpm also keeps beside the package
  it("finds a native package's platform binary, beside it in pnpm's store, and packs it", () => {
    pnpmProject(
      [
        { name: '@node-rs/xxhash', version: '1.0.0', optional: { '@node-rs/xxhash-test-platform': '1.0.0' } },
        { name: '@node-rs/xxhash-test-platform', version: '1.0.0', binary: 'xxhash.node' },
      ],
      ['@node-rs/xxhash@1.0.0'],
    )
    const out = path.join(root, 'dist')

    const found = installedPackages(['@node-rs/xxhash'], root)
    copyPackagesInto(new Map(found.map(({ name, dir }) => [name, dir])), root, out)

    expect(found.map(({ native }) => native)).toEqual([true])
    expect(existsSync(path.join(out, 'node_modules', '@node-rs', 'xxhash-test-platform', 'xxhash.node'))).toBe(true)
  })

  // Two packages that need different versions of one dependency each get their own, as pnpm installed them
  it('gives each package the version of a shared dependency it was installed with', () => {
    pnpmProject(
      [
        { name: 'first', version: '1.0.0', dependencies: { ms: '2.0.0' } },
        { name: 'second', version: '1.0.0', dependencies: { ms: '2.1.3' } },
        { name: 'ms', version: '2.0.0' },
        { name: 'ms', version: '2.1.3' },
      ],
      ['first@1.0.0', 'second@1.0.0'],
    )
    const out = path.join(root, 'dist')

    copyPackagesInto(new Map(installedPackages(['first', 'second'], root).map(({ name, dir }) => [name, dir])), root, out)

    // Node looks in a package's own node_modules before the top
    const resolved = (from: string) => {
      const nested = path.join(out, 'node_modules', from, 'node_modules', 'ms')
      return versionIn(existsSync(nested) ? nested : path.join(out, 'node_modules', 'ms'))
    }
    expect([resolved('first'), resolved('second')]).toEqual(['2.0.0', '2.1.3'])
  })
})

describe('copyPackagesInto', () => {
  const listed = (dir: string) => (existsSync(dir) ? readdirSync(dir).sort() : [])

  it('copies a package with its hoisted dependencies and the platform binary it installed', () => {
    install(path.join(root, 'node_modules', 'sharp'), 'sharp', {
      dependencies: ['detect-libc'],
      optional: ['@img/sharp-darwin-arm64', '@img/sharp-linux-x64'],
    })
    install(path.join(root, 'node_modules', 'detect-libc'), 'detect-libc')
    install(path.join(root, 'node_modules', '@img', 'sharp-darwin-arm64'), '@img/sharp-darwin-arm64', {
      binary: 'lib/sharp.node',
    })
    const out = path.join(root, 'dist')

    const copied = copyPackagesInto(new Map([['sharp', path.join(root, 'node_modules', 'sharp')]]), root, out)

    expect(copied.sort()).toEqual(['@img/sharp-darwin-arm64', 'detect-libc', 'sharp'])
    expect(existsSync(path.join(out, 'node_modules', '@img', 'sharp-darwin-arm64', 'lib', 'sharp.node'))).toBe(true)
    // The binary for another platform was never installed, so there is nothing to copy.
    expect(listed(path.join(out, 'node_modules', '@img'))).toEqual(['sharp-darwin-arm64'])
  })

  describe('platform packages', () => {
    const glibc = { platform: 'linux', arch: 'x64', libc: 'glibc' } as const

    /** sharp as bun installs it on Linux: the glibc and the musl build side by side. */
    function installBothLibcBuilds() {
      install(path.join(root, 'node_modules', 'sharp'), 'sharp', {
        optional: ['@img/sharp-linux-x64', '@img/sharp-linuxmusl-x64'],
      })
      install(path.join(root, 'node_modules', '@img', 'sharp-linux-x64'), '@img/sharp-linux-x64', {
        os: ['linux'],
        cpu: ['x64'],
        libc: ['glibc'],
        binary: 'lib/sharp.node',
      })
      install(path.join(root, 'node_modules', '@img', 'sharp-linuxmusl-x64'), '@img/sharp-linuxmusl-x64', {
        os: ['linux'],
        cpu: ['x64'],
        libc: ['musl'],
        binary: 'lib/sharp.node',
      })
    }

    it('leaves out an installed build for the other C library', () => {
      installBothLibcBuilds()
      const out = path.join(root, 'dist')

      const copied = copyPackagesInto(new Map([['sharp', path.join(root, 'node_modules', 'sharp')]]), root, out, glibc)

      expect(copied.sort()).toEqual(['@img/sharp-linux-x64', 'sharp'])
      expect(listed(path.join(out, 'node_modules', '@img'))).toEqual(['sharp-linux-x64'])
    })

    // The same rule the platform manifest follows: an unknown C library is not a mismatch.
    it('keeps both C library builds when the build platform cannot report its own', () => {
      installBothLibcBuilds()

      const copied = copyPackagesInto(new Map([['sharp', path.join(root, 'node_modules', 'sharp')]]), root, path.join(root, 'dist'), {
        platform: 'linux',
        arch: 'x64',
      })

      expect(copied.sort()).toEqual(['@img/sharp-linux-x64', '@img/sharp-linuxmusl-x64', 'sharp'])
    })

    it('leaves out an installed build for another operating system or CPU, including a negated one', () => {
      install(path.join(root, 'node_modules', 'addon'), 'addon', { optional: ['addon-arm64', 'addon-not-linux', 'addon-any'] })
      install(path.join(root, 'node_modules', 'addon-arm64'), 'addon-arm64', { os: ['linux'], cpu: ['arm64'] })
      install(path.join(root, 'node_modules', 'addon-not-linux'), 'addon-not-linux', { os: ['!linux'] })
      install(path.join(root, 'node_modules', 'addon-any'), 'addon-any')

      const copied = copyPackagesInto(new Map([['addon', path.join(root, 'node_modules', 'addon')]]), root, path.join(root, 'dist'), glibc)

      expect(copied.sort()).toEqual(['addon', 'addon-any'])
    })

    it('leaves out a build for another platform nested inside a package it copies', () => {
      const dir = path.join(root, 'node_modules', 'sharp')
      install(dir, 'sharp', { optional: ['@img/sharp-linux-x64', '@img/sharp-linuxmusl-x64'] })
      install(path.join(dir, 'node_modules', '@img', 'sharp-linux-x64'), '@img/sharp-linux-x64', { libc: ['glibc'] })
      install(path.join(dir, 'node_modules', '@img', 'sharp-linuxmusl-x64'), '@img/sharp-linuxmusl-x64', { libc: ['musl'] })
      const out = path.join(root, 'dist')

      copyPackagesInto(new Map([['sharp', dir]]), root, out, glibc)

      expect(listed(path.join(out, 'node_modules', 'sharp', 'node_modules', '@img'))).toEqual(['sharp-linux-x64'])
    })
  })

  it('brings nested dependencies along inside the package rather than hoisting them', () => {
    const dir = path.join(root, 'node_modules', 'canvas-lib')
    install(dir, 'canvas-lib', { dependencies: ['semver'] })
    install(path.join(dir, 'node_modules', 'semver'), 'semver')
    const out = path.join(root, 'dist')

    const copied = copyPackagesInto(new Map([['canvas-lib', dir]]), root, out)

    expect(copied).toEqual(['canvas-lib'])
    expect(existsSync(path.join(out, 'node_modules', 'canvas-lib', 'node_modules', 'semver', 'package.json'))).toBe(true)
    expect(existsSync(path.join(out, 'node_modules', 'semver'))).toBe(false)
  })

  // Some packages list their own types as runtime dependencies; they never run.
  it('leaves type-only packages behind', () => {
    install(path.join(root, 'node_modules', 'canvas-lib'), 'canvas-lib', { dependencies: ['@types/node'] })
    install(path.join(root, 'node_modules', '@types', 'node'), '@types/node')
    const out = path.join(root, 'dist')

    const copied = copyPackagesInto(new Map([['canvas-lib', path.join(root, 'node_modules', 'canvas-lib')]]), root, out)

    expect(copied).toEqual(['canvas-lib'])
    expect(existsSync(path.join(out, 'node_modules', '@types'))).toBe(false)
  })

  it('copies a dependency shared by two packages once', () => {
    install(path.join(root, 'node_modules', 'a'), 'a', { dependencies: ['shared'] })
    install(path.join(root, 'node_modules', 'b'), 'b', { dependencies: ['shared'] })
    install(path.join(root, 'node_modules', 'shared'), 'shared')
    const packages = new Map([
      ['a', path.join(root, 'node_modules', 'a')],
      ['b', path.join(root, 'node_modules', 'b')],
    ])

    expect(copyPackagesInto(packages, root, path.join(root, 'dist')).sort()).toEqual(['a', 'b', 'shared'])
  })
})
