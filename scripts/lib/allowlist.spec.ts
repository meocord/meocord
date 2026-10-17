import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ALLOWLIST_FILE,
  type Allowlist,
  compareVersions,
  latestRelease,
  NPM_VIEW_TIMEOUT_MS,
  parseAllowlist,
  stampAllowlist,
  stampAllowlistFile,
} from './allowlist.js'

// latestRelease's own npm call, which the cases below read without reaching the registry
const { execFileSync } = vi.hoisted(() => ({ execFileSync: vi.fn(() => '4.2.3\n') }))
vi.mock('child_process', async original => ({ ...(await original<typeof import('child_process')>()), execFileSync }))

describe('compareVersions', () => {
  it.each([
    ['4.2.3', '4.2.4', -1],
    ['4.10.0', '4.9.9', 1],
    ['4.2.3', '4.2.3', 0],
    ['4.3.0-beta.1', '4.3.0', -1],
    ['4.3.0-beta.2', '4.3.0-beta.10', -1],
    ['4.3.0-beta.1', '4.3.0-alpha.9', 1],
    ['4.3.0-1', '4.3.0-beta', -1],
    ['4.3.0-beta', '4.3.0-beta.1', -1],
    ['4.2.3+build.5', '4.2.3', 0],
  ])('orders %s against %s as %i', (a, b, sign) => {
    expect(Math.sign(compareVersions(a, b))).toBe(sign)
  })

  it('refuses what is not a version', () => {
    expect(() => compareVersions('latest', '4.2.3')).toThrow('"latest" is not a version.')
  })
})

describe('parseAllowlist', () => {
  it('reads entries with a reason and an optional version', () => {
    const allowlist = { 'core A.b': { reason: 'Narrowed.' }, 'core C.d': { reason: 'Narrowed.', version: '4.2.4' } }
    expect(parseAllowlist(allowlist)).toEqual(allowlist)
  })

  it.each([
    ['a reason written as the entry itself', { 'core A.b': 'Narrowed.' }, 'needs { "reason": "…" }'],
    ['an empty reason', { 'core A.b': { reason: ' ' } }, 'needs { "reason": "…" }'],
    ['a version that is not one', { 'core A.b': { reason: 'Narrowed.', version: 'next' } }, 'has a version that isn\'t one: "next"'],
  ])('refuses %s', (_, json, message) => {
    expect(() => parseAllowlist(json)).toThrow(message)
  })

  it('refuses a file that is not an object', () => {
    expect(() => parseAllowlist([])).toThrow('not a JSON object')
  })
})

describe('stampAllowlist', () => {
  const main: Allowlist = {
    'decorator New.member': { reason: 'Narrowed in this release.' },
    'core Kept.member': { reason: 'Narrowed in a release not yet published.', version: '4.2.4' },
    'common Shipped.member': { reason: 'Narrowed in the release npm has.', version: '4.2.3' },
  }

  it('stamps the released version on new entries and removes those the latest release has', () => {
    expect(stampAllowlist(main, '4.2.4', '4.2.3')).toEqual({
      'decorator New.member': { reason: 'Narrowed in this release.', version: '4.2.4' },
      'core Kept.member': { reason: 'Narrowed in a release not yet published.', version: '4.2.4' },
    })
  })

  it('gives the same file when the release pull request is stamped again', () => {
    const once = stampAllowlist(main, '4.2.4', '4.2.3')
    expect(stampAllowlist(once, '4.2.4', '4.2.3')).toEqual(once)
  })

  it('only stamps when npm could not say what is latest, so tidying never stops a release', () => {
    expect(stampAllowlist(main, '4.2.4', undefined)).toEqual({
      'decorator New.member': { reason: 'Narrowed in this release.', version: '4.2.4' },
      'core Kept.member': { reason: 'Narrowed in a release not yet published.', version: '4.2.4' },
      'common Shipped.member': { reason: 'Narrowed in the release npm has.', version: '4.2.3' },
    })
  })

  it('keeps every newer entry when latest is a hotfix of an older line', () => {
    expect(Object.keys(stampAllowlist(main, '4.0.10', '4.0.9'))).toEqual(Object.keys(main))
  })
})

describe('stampAllowlistFile', () => {
  const roots: string[] = []
  afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })))

  /** A repository root holding package.json at `version` and the allowlist `entries`. */
  function repository(version: string, entries: Allowlist): string {
    const root = mkdtempSync(path.join(tmpdir(), 'allowlist-'))
    roots.push(root)
    mkdirSync(path.join(root, 'scripts'))
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version }))
    writeFileSync(path.join(root, ALLOWLIST_FILE), `${JSON.stringify(entries)}\n`)
    return root
  }
  const read = (root: string) => readFileSync(path.join(root, ALLOWLIST_FILE), 'utf8')

  it('writes the stamped allowlist for the version package.json holds', () => {
    const root = repository('4.2.4', { 'core A.b': { reason: 'Narrowed.' }, 'core C.d': { reason: 'Shipped.', version: '4.2.3' } })
    expect(stampAllowlistFile(root, '4.2.3')).toBe(true)
    expect(read(root)).toBe(`${JSON.stringify({ 'core A.b': { reason: 'Narrowed.', version: '4.2.4' } }, null, 2)}\n`)
  })

  it('leaves the file alone when nothing changes', () => {
    const root = repository('4.2.4', {})
    expect(stampAllowlistFile(root, '4.2.3')).toBe(false)
    expect(read(root)).toBe('{}\n')
  })

  it('only stamps when npm answers with something other than a version', () => {
    const root = repository('4.2.4', { 'core C.d': { reason: 'Shipped.', version: '4.2.3' } })
    expect(stampAllowlistFile(root, '')).toBe(false)
    expect(JSON.parse(read(root))).toEqual({ 'core C.d': { reason: 'Shipped.', version: '4.2.3' } })
  })
})

describe('latestRelease', () => {
  it("bounds npm's own call by the timeout", () => {
    expect(latestRelease()).toBe('4.2.3')
    expect(execFileSync).toHaveBeenCalledWith('npm', ['view', 'meocord', 'dist-tags.latest'], expect.objectContaining({ timeout: NPM_VIEW_TIMEOUT_MS }))
  })

  it('asks npm within the timeout and returns the version it names', () => {
    const asked: number[] = []
    expect(latestRelease(NPM_VIEW_TIMEOUT_MS, timeout => (asked.push(timeout), '4.2.3\n'))).toBe('4.2.3')
    expect(asked).toEqual([NPM_VIEW_TIMEOUT_MS])
  })

  it.each([
    ['times out', () => {
      throw Object.assign(new Error('spawnSync npm ETIMEDOUT'), { code: 'ETIMEDOUT' })
    }],
    ['answers with nothing', () => ''],
    ['answers with something other than a version', () => 'undefined'],
  ])('says nothing when npm %s, so the allowlist is only stamped', (_, view) => {
    expect(latestRelease(NPM_VIEW_TIMEOUT_MS, view)).toBeUndefined()
  })
})
