import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { BUNDLE_ENTRY_KEY } from '@src/util/bundle-entry.util.js'
import path from 'path'
import {
  assertBuiltForThisPlatform,
  currentPlatform,
  describePlatform,
  isSamePlatform,
  PLATFORM_MANIFEST,
  writePlatformManifest,
} from '@src/util/platform.util.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'meocord-platform-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('isSamePlatform', () => {
  it('accepts the same operating system and CPU', () => {
    expect(isSamePlatform({ platform: 'linux', arch: 'x64' }, { platform: 'linux', arch: 'x64' })).toBe(true)
  })

  it('refuses a different operating system or CPU', () => {
    expect(isSamePlatform({ platform: 'darwin', arch: 'arm64' }, { platform: 'linux', arch: 'arm64' })).toBe(false)
    expect(isSamePlatform({ platform: 'linux', arch: 'x64' }, { platform: 'linux', arch: 'arm64' })).toBe(false)
  })

  // An Alpine image runs musl; a binary built on Debian's glibc does not load there.
  it('refuses glibc binaries on musl, and the reverse', () => {
    expect(
      isSamePlatform({ platform: 'linux', arch: 'x64', libc: 'glibc' }, { platform: 'linux', arch: 'x64', libc: 'musl' }),
    ).toBe(false)
  })

  it('does not refuse on a C library one side could not report', () => {
    expect(isSamePlatform({ platform: 'linux', arch: 'x64', libc: 'glibc' }, { platform: 'linux', arch: 'x64' })).toBe(true)
  })
})

describe('describePlatform', () => {
  it('names the platform the way a person would look for it', () => {
    expect(describePlatform({ platform: 'linux', arch: 'x64', libc: 'musl' })).toBe('linux-x64 (musl)')
    expect(describePlatform({ platform: 'darwin', arch: 'arm64' })).toBe('darwin-arm64')
  })
})

describe('writePlatformManifest', () => {
  it('records the platform this process runs on', () => {
    writePlatformManifest(dir)

    expect(JSON.parse(readFileSync(path.join(dir, PLATFORM_MANIFEST), 'utf8'))).toEqual(currentPlatform())
  })
})

describe('assertBuiltForThisPlatform', () => {
  it('lets a build without native addons start anywhere', () => {
    expect(existsSync(path.join(dir, PLATFORM_MANIFEST))).toBe(false)
    expect(() => assertBuiltForThisPlatform(dir)).not.toThrow()
  })

  it('lets a build made on this platform start', () => {
    writePlatformManifest(dir)

    expect(() => assertBuiltForThisPlatform(dir)).not.toThrow()
  })

  it('stops a build made for another platform, naming both and the fix', () => {
    const elsewhere = process.platform === 'linux' ? 'darwin' : 'linux'
    writeFileSync(path.join(dir, PLATFORM_MANIFEST), JSON.stringify({ platform: elsewhere, arch: process.arch }))

    expect(() => assertBuiltForThisPlatform(dir)).toThrow(new RegExp(`compiled for ${elsewhere}-${process.arch}`))
    expect(() => assertBuiltForThisPlatform(dir)).toThrow(/run `meocord build` inside the image/)
  })

  // A process manager's wrapper can be argv[1]; the manifest is beside the bundle the pre-entry recorded
  it('reads the manifest beside the built bundle by default, not beside argv[1]', () => {
    const elsewhere = process.platform === 'linux' ? 'darwin' : 'linux'
    writeFileSync(path.join(dir, PLATFORM_MANIFEST), JSON.stringify({ platform: elsewhere, arch: process.arch }))
    Reflect.set(globalThis, BUNDLE_ENTRY_KEY, path.join(dir, 'main.js'))
    try {
      expect(() => assertBuiltForThisPlatform()).toThrow(new RegExp(`compiled for ${elsewhere}-${process.arch}`))
    } finally {
      Reflect.deleteProperty(globalThis, BUNDLE_ENTRY_KEY)
    }
  })

  it('does not stop the bot over a manifest it cannot read', () => {
    writeFileSync(path.join(dir, PLATFORM_MANIFEST), 'not json')

    expect(() => assertBuiltForThisPlatform(dir)).not.toThrow()
  })
})
