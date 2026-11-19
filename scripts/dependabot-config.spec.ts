import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { parse } from 'yaml'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * A range that stops below a release line: `<2.3.0`, `<2.3` and `<2.3.0-0` stop below 2.3, and `<3.0.0` and `<3`
 * below 3. The groups are that line's major and minor. One that stops inside a line, as `<2.3.5` does, holds none.
 */
const CAP = /<(\d+)(?:\.(\d+))?(?:\.0(?:-0)?)?$/

/** A version written out in full, as an exact pin or a skipped release names it: `5.1.0` */
const EXACT = /^(\d+)\.(\d+)\.(\d+)$/

/** The update entry for the package itself */
const PACKAGE_ENTRY = { ecosystem: 'bun', directory: '/' }

/** The update entry for the test runner projects, found by one of its directories */
const RUNNER_ENTRY = { ecosystem: 'bun', directory: '/scripts/runner-consumers/vitest' }

type Ranges = Record<string, string>

interface IgnoreRule {
  'dependency-name': string
  versions?: string[]
}

interface Update {
  'package-ecosystem': string
  directory?: string
  directories?: string[]
  ignore?: IgnoreRule[]
}

const { updates } = parse(readFileSync(path.join(repoRoot, '.github', 'dependabot.yml'), 'utf8')) as {
  updates: Update[]
}

/** The ranges a project's package.json asks for, its dependencies and devDependencies together */
function ranges(directory: string): Ranges {
  const manifest = JSON.parse(readFileSync(path.join(repoRoot, directory, 'package.json'), 'utf8')) as {
    dependencies?: Ranges
    devDependencies?: Ranges
  }
  return { ...manifest.dependencies, ...manifest.devDependencies }
}

/** The update entry with this ecosystem that updates this directory */
function entry({ ecosystem, directory }: { ecosystem: string; directory: string }): Update {
  const found = updates.find(
    update =>
      update['package-ecosystem'] === ecosystem &&
      (update.directory === directory || update.directories?.includes(directory)),
  )
  if (!found) throw new Error(`dependabot.yml has no ${ecosystem} update entry for ${directory}`)
  return found
}

/** The line a range holds a dependency below, as an ignore rule names it: `2.3.x`, or `3.x` for a whole major */
function heldLine(range: string): string | undefined {
  const cap = CAP.exec(range)
  if (!cap) return undefined
  const [, major, minor] = cap
  return minor === undefined || Number(minor) === 0 ? `${major}.x` : `${major}.${minor}.x`
}

/** Whether exact version `version` comes after exact version `pin` */
function isAfter(version: RegExpExecArray, pin: RegExpExecArray): boolean {
  for (let part = 1; part <= 3; part++) {
    if (Number(version[part]) !== Number(pin[part])) return Number(version[part]) > Number(pin[part])
  }
  return false
}

/**
 * Why a dependency's skipped versions don't match the range one manifest asks for, or undefined when they do. A line
 * cap is skipped as exactly that line; an exact pin may skip exact releases after it, the broken ones it is held from.
 */
function mismatch(range: string | undefined, skipped: string[] | undefined): string | undefined {
  const line = range === undefined ? undefined : heldLine(range)
  if (line) return skipped?.length === 1 && skipped[0] === line ? undefined : `holds below ${line} but skips ${skipped}`
  if (!skipped) return undefined
  const pin = range === undefined ? null : EXACT.exec(range)
  if (!pin) return `skips ${skipped} but ${range === undefined ? 'is not a dependency' : `asks for ${range}`}`
  const early = skipped.filter(version => {
    const exact = EXACT.exec(version)
    return !exact || !isAfter(exact, pin)
  })
  return early.length ? `is pinned at ${range} but skips ${early}` : undefined
}

/** Each mismatch between an update entry's ignore rules and the manifests it updates, as `name: reason` */
function mismatches(manifests: Ranges[], rules: IgnoreRule[]): string[] {
  const skipped = new Map(rules.filter(rule => rule.versions).map(rule => [rule['dependency-name'], rule.versions]))
  const names = new Set([...skipped.keys(), ...manifests.flatMap(manifest => Object.keys(manifest))])
  return [...names].flatMap(name => {
    const declared = manifests.filter(manifest => name in manifest).map(manifest => manifest[name])
    const reasons = (declared.length ? declared : [undefined]).map(range => mismatch(range, skipped.get(name)))
    return [...new Set(reasons.filter(reason => reason !== undefined))].map(reason => `${name}: ${reason}`)
  })
}

describe('a range that holds a dependency back', () => {
  it.each([
    ['>=2.2.11 <2.3.0', '2.3.x'],
    ['>=2.2.11 <2.3', '2.3.x'],
    ['>=2.2.11 <2.3.0-0', '2.3.x'],
    ['>=2.2.11 <3.0.0', '3.x'],
    ['>=2.2.11 <3', '3.x'],
  ])('%s holds %s back', (range, line) => {
    expect(heldLine(range)).toBe(line)
  })

  // An ordinary range ends somewhere too: reading one as a hold would ask for a rule per dependency
  it.each(['^2.2.11', '~2.2.11', '2.2.x', '<=2.2.x', '>=2.2.11 <2.3.5', '>=2.2.11 <2.3.0 || >=2.4.1'])(
    '%s holds nothing back',
    range => {
      expect(heldLine(range)).toBeUndefined()
    },
  )
})

describe('ignore rules against the manifests they update', () => {
  const skip = (...versions: string[]): IgnoreRule[] => [{ 'dependency-name': 'tool', versions }]

  it('takes a line cap skipped as exactly its line', () => {
    expect(mismatches([{ tool: '>=2.2.11 <2.3.0' }], skip('2.3.x'))).toEqual([])
  })

  it('refuses a line cap left unskipped, skipped as another line or with more than its line', () => {
    expect(mismatches([{ tool: '>=2.2.11 <2.3.0' }], [])).toEqual(['tool: holds below 2.3.x but skips undefined'])
    expect(mismatches([{ tool: '>=2.2.11 <2.3.0' }], skip('2.4.x'))).toEqual(['tool: holds below 2.3.x but skips 2.4.x'])
    expect(mismatches([{ tool: '>=2.2.11 <2.3.0' }], skip('2.3.x', '2.4.0'))).toEqual([
      'tool: holds below 2.3.x but skips 2.3.x,2.4.0',
    ])
  })

  it('takes an exact pin skipping exact releases after it', () => {
    expect(mismatches([{ tool: '5.1.0' }], skip('5.1.1', '5.2.0'))).toEqual([])
  })

  it('refuses a skipped release that nothing pins', () => {
    expect(mismatches([{ tool: '^5.0.5' }], skip('5.1.1'))).toEqual(['tool: skips 5.1.1 but asks for ^5.0.5'])
    expect(mismatches([{}], skip('5.1.1'))).toEqual(['tool: skips 5.1.1 but is not a dependency'])
  })

  it('refuses a pin skipping its own release, an earlier one or a line', () => {
    expect(mismatches([{ tool: '5.1.0' }], skip('5.1.0', '5.0.9', '5.2.x'))).toEqual([
      'tool: is pinned at 5.1.0 but skips 5.1.0,5.0.9,5.2.x',
    ])
  })

  it('checks every manifest that declares the dependency', () => {
    expect(mismatches([{ tool: '5.1.0' }, { other: '^1.0.0' }], skip('5.1.1'))).toEqual([])
    expect(mismatches([{ tool: '5.1.0' }, { tool: '^5.0.5' }], skip('5.1.1'))).toEqual([
      'tool: skips 5.1.1 but asks for ^5.0.5',
    ])
  })
})

describe('.github/dependabot.yml', () => {
  // Dependabot rewrites a range or pin rather than respect it, so a hold it does not skip comes back as a pull request
  // that cannot pass, and a skipped version nothing holds would hide releases from the weekly update. A hold is a
  // range capped below a release line, or an exact pin kept below the releases after it that break.
  it('skips exactly what package.json holds back', () => {
    expect(mismatches([ranges('.')], entry(PACKAGE_ENTRY).ignore ?? [])).toEqual([])
  })

  it('skips exactly what the runner projects hold back', () => {
    const runners = entry(RUNNER_ENTRY)
    expect(mismatches(runners.directories!.map(ranges), runners.ignore ?? [])).toEqual([])
  })
})
