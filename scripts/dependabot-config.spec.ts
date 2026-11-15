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

/** The update entry for the package itself: the runner projects and the workflows' actions have their own */
const PACKAGE_ENTRY = { ecosystem: 'bun', directory: '/' }

interface Update {
  'package-ecosystem': string
  directory?: string
  ignore?: { 'dependency-name': string; versions?: string[] }[]
}

const manifest = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
}

const { updates } = parse(readFileSync(path.join(repoRoot, '.github', 'dependabot.yml'), 'utf8')) as {
  updates: Update[]
}

/** The line a range holds a dependency below, as an ignore rule names it: `2.3.x`, or `3.x` for a whole major */
function heldLine(range: string): string | undefined {
  const cap = CAP.exec(range)
  if (!cap) return undefined
  const [, major, minor] = cap
  return minor === undefined || Number(minor) === 0 ? `${major}.x` : `${major}.${minor}.x`
}

/** Each dependency package.json holds below a release line, with that line */
function heldLines(): Record<string, string[]> {
  const held: Record<string, string[]> = {}
  for (const [name, range] of Object.entries({ ...manifest.dependencies, ...manifest.devDependencies })) {
    const line = heldLine(range)
    if (line) held[name] = [line]
  }
  return held
}

/** Each dependency the package's entry skips some versions of; one skipped whole carries no `versions` */
function skippedLines(): Record<string, string[]> {
  const entry = updates.find(
    update => update['package-ecosystem'] === PACKAGE_ENTRY.ecosystem && update.directory === PACKAGE_ENTRY.directory,
  )
  if (!entry) throw new Error('dependabot.yml has no update entry for the package itself')
  const skipped: Record<string, string[]> = {}
  for (const rule of entry.ignore ?? []) {
    if (rule.versions) skipped[rule['dependency-name']] = rule.versions
  }
  return skipped
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

describe('.github/dependabot.yml', () => {
  // Dependabot rewrites a range rather than respect its cap, so a held line it does not skip comes back as a
  // pull request that cannot pass; a skipped line nothing holds would hide releases from the weekly update.
  it('skips exactly the release lines package.json holds a dependency below', () => {
    expect(skippedLines()).toEqual(heldLines())
  })
})
