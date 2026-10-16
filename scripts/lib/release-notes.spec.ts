import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { CHANGESET_DIR, checkNotesCoverChangesets, COVERED_FILE, NOTES_DIR, readNotes, writeReleaseNotes } from './release-notes.js'

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

  it('refuses a word GitHub turns into a mention, naming its line, and takes one in code, a link target, a URL or an address', () => {
    const folder = notes('4.1.0', {
      'fixes.md':
        '### Fixes\n\n- `@On` and `@everyone` read as code.\n' +
        '- [The page](https://github.com/@foo), [its copy](/users/@foo), https://example.com/@bar and a@b.c mention no one.\n',
    })
    expect(readNotes(folder)).toContain('`@everyone`')

    writeFileSync(path.join(folder, 'fixes.md'), '### Fixes\n\n- What the @everyone role may do.\n')
    expect(() => readNotes(folder)).toThrow(/fixes\.md has words GitHub turns into a mention[^]*  line 3: @everyone$/)
  })

  it('refuses a file that is not a section, and a folder with none', () => {
    const folder = notes('4.1.0', { 'highlight.md': '### Highlights\n\n- Message commands.\n' })
    expect(() => readNotes(folder)).toThrow('highlight.md is not a section')

    rmSync(path.join(folder, 'highlight.md'))
    expect(() => readNotes(folder)).toThrow('holds no notes')
  })
})

describe('checkNotesCoverChangesets', () => {
  const highlights = { 'highlights.md': '### Highlights\n\n- A change.\n' }

  /** A repository at `version` with `changesets` pending beside the changesets README, and 4.2.3's notes listing `covered`. */
  function pending(version: string, changesets: string[], covered: string): void {
    repository(version, [version])
    mkdirSync(path.join(root, CHANGESET_DIR), { recursive: true })
    for (const file of [...changesets, 'README.md']) writeFileSync(path.join(root, CHANGESET_DIR, file), '---\n---\n')
    notes('4.2.3', { ...highlights, [COVERED_FILE]: covered })
  }

  it('passes notes that list exactly the pending changesets, one with why it needs no line', () => {
    pending('4.2.2', ['a.md', 'b.md'], '- a.md\n- b.md: Only the package metadata changes.\n')

    expect(() => checkNotesCoverChangesets(root)).not.toThrow()
  })

  it.each(['4.2.2', '4.2.3-beta.1'])('names a changeset the notes leave out, from %s', version => {
    pending(version, ['a.md', 'b.md'], '- a.md\n')

    expect(() => checkNotesCoverChangesets(root)).toThrow(
      `b.md isn't in ${path.join(NOTES_DIR, '4.2.3', COVERED_FILE)}: cover it in the notes and list it, ` +
        'or list it with why it needs no line.',
    )
  })

  it('names a listed file that is not a pending changeset', () => {
    pending('4.2.2', ['a.md'], '- a.md\n- gone.md\n')

    expect(() => checkNotesCoverChangesets(root)).toThrow(
      `${path.join(NOTES_DIR, '4.2.3', COVERED_FILE)} lists gone.md, which is not a pending changeset: remove it.`,
    )
  })

  it('refuses a line that is not a list item, and a file listed twice', () => {
    pending('4.2.2', ['a.md'], '- a.md\nb.md\n')
    expect(() => checkNotesCoverChangesets(root)).toThrow('"b.md" is not a "- <file>" or "- <file>: <why it needs no line>" item.')

    pending('4.2.2', ['a.md'], '- a.md\n- a.md: Twice.\n')
    expect(() => checkNotesCoverChangesets(root)).toThrow('lists a.md twice')
  })

  it.each(['4.2.3', '4.2.4'])("checks nothing at %s, when no version's notes are later", version => {
    pending(version, ['a.md'], '')

    expect(() => checkNotesCoverChangesets(root)).not.toThrow()
  })

  it('reads notes without the list, and deletes it with them', () => {
    pending('4.2.3', ['a.md'], '- a.md\n')
    const folder = path.join(root, NOTES_DIR, '4.2.3')

    expect(readNotes(folder)).toBe('### Highlights\n\n- A change.')
    expect(writeReleaseNotes(root)).toBe(true)
    expect(existsSync(folder)).toBe(false)
  })
})

// The notes waiting in this repository, checked now rather than when the release's version step runs
describe("the repository's notes", () => {
  const notesRoot = path.join(repoRoot, NOTES_DIR)
  // None wait once a version step has written and deleted them, as on the release pull request
  const versions = existsSync(notesRoot) ? readdirSync(notesRoot) : []

  it('each read as the docs site shows them, when any are waiting', () => {
    for (const version of versions) expect(() => readNotes(path.join(notesRoot, version)), version).not.toThrow()
  })
})
