/**
 * Puts a stable release's curated notes in CHANGELOG.md in place of the entry `changeset version` wrote from the
 * release's changesets, so a release that leaves prereleases reads as one story rather than every beta's changes again.
 * The notes sit in `.changeset/release-notes/<version>/`, one file per section, and are deleted once written. As they
 * replace the changesets' entry whole, the folder's `covered.md` lists every pending changeset, and a check refuses one
 * it leaves out, so a change can't be dropped from the notes silently.
 */

import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import path from 'path'

/** Where the pending changesets sit, relative to the repository root. */
export const CHANGESET_DIR = '.changeset'

/** The file in the changesets folder that is not a changeset. */
const CHANGESET_README = 'README.md'

/** Where each version's notes sit, relative to the repository root. */
export const NOTES_DIR = path.join(CHANGESET_DIR, 'release-notes')

/**
 * The file in a version's notes that lists the changesets they cover, one `- <file>` item each, or
 * `- <file>: <reason>` for one that needs no line in the notes.
 */
export const COVERED_FILE = 'covered.md'

/** A line of `covered.md`: `- <file>`, or `- <file>: <reason>`, capturing the file. */
const COVERED_ITEM = /^- ([^\s:]+\.md)(?::[ \t]+\S.*)?$/

/** Where GitHub reads no mention in a line: a code span, a link's target, and a bare URL. */
const NOT_PROSE = /(`+).*?\1|\]\([^)]*\)|https?:\/\/\S+/g

/** A line that opens or closes a fenced code block, where GitHub reads no mention, capturing its fence. */
const FENCE = /^\s*(`{3,}|~{3,})/

/** What GitHub turns into a mention of a user: `@` and a username, unless a word character comes first, as in `a@b.c`. */
const MENTION = /(?<!\w)@[A-Za-z\d](?:[A-Za-z\d-]*[A-Za-z\d])?/g

/** The section files a version's notes may hold, in the order they're written. */
export const SECTIONS = ['highlights', 'upgrading', 'features', 'deprecations', 'fixes', 'security'].map(name => `${name}.md`)

interface Version {
  core: string
  prerelease?: string
}

/** `version` as semver splits it, or `undefined` for anything that isn't a version. */
export function parseVersion(version: string): Version | undefined {
  const match = /^(\d+\.\d+\.\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(version)
  return match ? { core: match[1], prerelease: match[2] } : undefined
}

/** Whether a stable `a` is a later version than `b`, by semver precedence. */
function isLater(a: Version, b: Version): boolean {
  const [x, y] = [a.core, b.core].map(core => core.split('.').map(Number))
  const differs = x.findIndex((part, index) => part !== y[index])
  return differs >= 0 ? x[differs] > y[differs] : b.prerelease !== undefined
}

/** The versions CHANGELOG.md has an entry for, newest first. */
export function changelogVersions(changelog: string): string[] {
  return [...changelog.matchAll(/^## (\S+)[ \t]*$/gm)].map(match => match[1])
}

/**
 * The lines of a section file the docs site would drop, as it keeps only `### ` groups and their `- ` entries, each
 * continued by lines indented two spaces.
 */
export function strayLines(markdown: string): string[] {
  const stray: string[] = []
  let group = false
  let entry = false
  for (const line of markdown.split('\n')) {
    if (line.trim() === '') continue
    if (/^### \S/.test(line)) [group, entry] = [true, false]
    else if (line.startsWith('- ') && group) entry = true
    else if (!(line.startsWith('  ') && entry)) stray.push(line)
  }
  return stray
}

/** Each word in `markdown` that GitHub would turn into a mention of a user, with its line number. */
function mentions(markdown: string): { line: number; word: string }[] {
  let fence: string | undefined
  return markdown.split('\n').flatMap((text, index) => {
    const marker = FENCE.exec(text)?.[1]
    // A fence closes only on a run of its own character at least as long as the one that opened it
    if (marker && (fence === undefined || (marker[0] === fence[0] && marker.length >= fence.length))) {
      fence = fence === undefined ? marker : undefined
      return []
    }
    if (fence !== undefined) return []
    return [...text.replace(NOT_PROSE, ' ').matchAll(MENTION)].map(([word]) => ({ line: index + 1, word }))
  })
}

/** A version's notes, its section files joined in order; throws for a file that isn't a section or that the site would cut. */
export function readNotes(folder: string): string {
  const files = readdirSync(folder).filter(file => file !== COVERED_FILE)
  const unknown = files.filter(file => !SECTIONS.includes(file))
  if (unknown.length > 0) {
    throw new Error(
      `${folder}: ${unknown.join(', ')} is not a section; name each file one of ${SECTIONS.join(', ')}, or ${COVERED_FILE}.`,
    )
  }
  const sections = SECTIONS.filter(file => files.includes(file)).map(file => {
    const raw = readFileSync(path.join(folder, file), 'utf8')
    // A release's notes become its GitHub release, which lists each user they mention among its contributors
    const mentioned = mentions(raw)
    if (mentioned.length > 0) {
      throw new Error(
        `${path.join(folder, file)} has words GitHub turns into a mention of a user; write each in backticks:\n` +
          mentioned.map(({ line, word }) => `  line ${line}: ${word}`).join('\n'),
      )
    }
    const markdown = raw.trim()
    const stray = strayLines(markdown)
    if (stray.length > 0) {
      throw new Error(
        `${path.join(folder, file)} has lines outside a "### " group's "- " entries, which the docs site drops:\n` +
          stray.map(line => `  ${line}`).join('\n'),
      )
    }
    return markdown
  })
  if (sections.length === 0) throw new Error(`${folder} holds no notes.`)
  return sections.join('\n\n')
}

/** The changeset files `covered.md` lists; throws for a line that isn't a `- <file>` item, and for a file listed twice. */
export function readCovered(file: string): string[] {
  const listed: string[] = []
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (line.trim() === '') continue
    const item = COVERED_ITEM.exec(line)
    if (!item) throw new Error(`${file}: "${line}" is not a "- <file>" or "- <file>: <why it needs no line>" item.`)
    if (listed.includes(item[1])) throw new Error(`${file} lists ${item[1]} twice.`)
    listed.push(item[1])
  }
  return listed
}

/** The version package.json holds, as written and as semver splits it; throws for anything that isn't a version. */
function packageVersion(root: string): { version: string; parsed: Version } {
  const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string }
  const parsed = parseVersion(version)
  if (!parsed) throw new Error(`package.json's version, "${version}", is not a version.`)
  return { version, parsed }
}

/**
 * Checks that the `covered.md` of each version's notes later than package.json's lists exactly the pending changesets:
 * `writeReleaseNotes` puts the notes in place of every changeset's line, so one they leave out would be dropped. Run
 * before `changeset version`, which deletes the changesets and moves package.json to the notes' version.
 */
export function checkNotesCoverChangesets(root: string): void {
  const notesRoot = path.join(root, NOTES_DIR)
  if (!existsSync(notesRoot)) return
  const current = packageVersion(root).parsed
  const pending = readdirSync(notesRoot).filter(version => {
    const parsed = parseVersion(version)
    if (!parsed || parsed.prerelease !== undefined) {
      throw new Error(`${path.join(NOTES_DIR, version)} is not named for a stable version, the only kind with notes.`)
    }
    return isLater(parsed, current)
  })
  if (pending.length === 0) return

  const changesets = readdirSync(path.join(root, CHANGESET_DIR))
    .filter(file => file.endsWith('.md') && file !== CHANGESET_README)
    .sort()
  const problems = pending.flatMap(version => {
    const covered = path.join(NOTES_DIR, version, COVERED_FILE)
    const listed = existsSync(path.join(root, covered)) ? readCovered(path.join(root, covered)) : []
    return [
      ...changesets
        .filter(file => !listed.includes(file))
        .map(file => `${file} isn't in ${covered}: cover it in the notes and list it, or list it with why it needs no line.`),
      ...listed
        .filter(file => !changesets.includes(file))
        .map(file => `${covered} lists ${file}, which is not a pending changeset: remove it.`),
    ]
  })
  if (problems.length > 0) throw new Error(problems.join('\n'))
}

/** `changelog` with the body of `version`'s entry replaced by `notes`. */
export function replaceEntry(changelog: string, version: string, notes: string): string {
  const heading = new RegExp(`^## ${version.replace(/[.+]/g, '\\$&')}[ \\t]*$`, 'm').exec(changelog)
  if (!heading) throw new Error(`CHANGELOG.md has no "## ${version}" entry to put the notes in.`)
  const start = heading.index + heading[0].length
  const next = /^## /m.exec(changelog.slice(start))
  const end = next ? start + next.index : changelog.length
  return `${changelog.slice(0, start)}\n\n${notes}\n${next ? '\n' : ''}${changelog.slice(end)}`
}

/**
 * Writes the notes of the version package.json now holds, when it's a stable version with notes, and deletes them.
 * A prerelease, and a stable version without notes, keep the entry changesets wrote, except a stable version that
 * follows its own prereleases, which would repeat every one of their changes: that's refused, as notes were forgotten.
 *
 * @returns Whether notes were written.
 */
export function writeReleaseNotes(root: string): boolean {
  const { version, parsed } = packageVersion(root)
  if (parsed.prerelease !== undefined) return false

  const changelogPath = path.join(root, 'CHANGELOG.md')
  const changelog = readFileSync(changelogPath, 'utf8')
  const folder = path.join(root, NOTES_DIR, version)
  if (!existsSync(folder)) {
    const previous = parseVersion(changelogVersions(changelog)[1] ?? '')
    if (previous?.prerelease !== undefined && previous.core === parsed.core) {
      throw new Error(
        `${version} follows its prereleases, so changesets wrote every one of their changes again. ` +
          `Write its notes in ${path.join(NOTES_DIR, version)} before releasing it.`,
      )
    }
    return false
  }

  writeFileSync(changelogPath, replaceEntry(changelog, version, readNotes(folder)))
  rmSync(folder, { recursive: true, force: true })
  return true
}
