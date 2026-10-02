import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { NOTES_DIR, readNotes, writeReleaseNotes } from './release-notes.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

let root: string

/** A repository whose package.json holds `version` and whose CHANGELOG.md has an entry for each of `entries`. */
function repository(version: string, entries: string[]): void {
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'meocord', version }))
  const body = entries.map(entry => `## ${entry}\n\n### Patch Changes\n\n- A change in ${entry}.\n`).join('\n')
  writeFileSync(path.join(root, 'CHANGELOG.md'), `# meocord\n\n${body}`)
}

function notes(version: string, sections: Record<string, string>): string {
  const folder = path.join(root, NOTES_DIR, version)
  mkdirSync(folder, { recursive: true })
  for (const [file, markdown] of Object.entries(sections)) writeFileSync(path.join(folder, file), markdown)
  return folder
}

const changelog = () => readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8')

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'meocord-notes-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('writeReleaseNotes', () => {
  it('writes a stable version its notes, in section order, in place of its entry, and deletes them', () => {
    repository('4.1.0', ['4.1.0', '4.1.0-beta.1', '4.0.1'])
    const folder = notes('4.1.0', {
      'upgrading.md': '### Upgrading from 4.0\n\n- **Case.** Keywords match in any case.\n  Set `caseSensitive`.\n',
      'highlights.md': '### Highlights\n\n- Message commands.\n',
    })

    expect(writeReleaseNotes(root)).toBe(true)

    expect(changelog()).toBe(
      '# meocord\n\n## 4.1.0\n\n### Highlights\n\n- Message commands.\n\n### Upgrading from 4.0\n\n' +
        '- **Case.** Keywords match in any case.\n  Set `caseSensitive`.\n\n' +
        '## 4.1.0-beta.1\n\n### Patch Changes\n\n- A change in 4.1.0-beta.1.\n\n## 4.0.1\n\n### Patch Changes\n\n- A change in 4.0.1.\n',
    )
    expect(existsSync(folder)).toBe(false)
  })

  // A beta.11 versions as usual while the stable release's notes wait
  it("leaves a prerelease's entry alone, with a later version's notes waiting", () => {
    repository('4.1.0-beta.11', ['4.1.0-beta.11', '4.1.0-beta.10'])
    const folder = notes('4.1.0', { 'highlights.md': '### Highlights\n\n- Message commands.\n' })
    const before = changelog()

    expect(writeReleaseNotes(root)).toBe(false)

    expect(changelog()).toBe(before)
    expect(existsSync(folder)).toBe(true)
  })

  it('refuses a stable version that follows its own prereleases with no notes', () => {
    repository('4.1.0', ['4.1.0', '4.1.0-beta.10', '4.0.1'])

    expect(() => writeReleaseNotes(root)).toThrow(
      '4.1.0 follows its prereleases, so changesets wrote every one of their changes again. Write its notes in',
    )
  })

  it.each([
    ['a patch after a stable version', '4.1.1', ['4.1.1', '4.1.0']],
    ["another version's prereleases", '4.2.0', ['4.2.0', '4.1.0-beta.10']],
    ['a release candidate of another version', '4.1.1', ['4.1.1', '4.1.0-rc.1']],
  ])("leaves a stable version that follows %s without notes as changesets wrote it", (_, version, entries) => {
    repository(version, entries)
    const before = changelog()

    expect(writeReleaseNotes(root)).toBe(false)

    expect(changelog()).toBe(before)
  })

  it("leaves another version's notes alone", () => {
    repository('4.1.1', ['4.1.1', '4.1.0'])
    const folder = notes('4.2.0', { 'highlights.md': '### Highlights\n\n- Later.\n' })

    expect(writeReleaseNotes(root)).toBe(false)

    expect(existsSync(folder)).toBe(true)
  })

  it('refuses notes the docs site would cut, naming the lines, and changes nothing', () => {
    repository('4.1.0', ['4.1.0', '4.1.0-beta.10'])
    notes('4.1.0', { 'highlights.md': 'MeoCord 4.1 adds to 4.0.\n\n### Highlights\n\n- Message commands.\nNot indented.\n' })
    const before = changelog()

    expect(() => writeReleaseNotes(root)).toThrow(/highlights\.md has lines outside[^]*  MeoCord 4\.1 adds to 4\.0\.\n  Not indented\./)
    expect(changelog()).toBe(before)
  })

  it('refuses a file that is not a section, and a folder with none', () => {
    const folder = notes('4.1.0', { 'highlight.md': '### Highlights\n\n- Message commands.\n' })
    expect(() => readNotes(folder)).toThrow('highlight.md is not a section')

    rmSync(path.join(folder, 'highlight.md'))
    expect(() => readNotes(folder)).toThrow('holds no notes')
  })
})

// The notes waiting in this repository, checked now rather than when the release's version step runs
describe("the repository's notes", () => {
  const notesRoot = path.join(repoRoot, NOTES_DIR)
  const versions = existsSync(notesRoot) ? readdirSync(notesRoot) : []

  it.each(versions)('%s reads as the docs site shows it', version => {
    expect(() => readNotes(path.join(notesRoot, version))).not.toThrow()
  })
})
