/**
 * Puts a stable release's curated notes in CHANGELOG.md in place of the entry `changeset version` wrote from the
 * release's changesets, so a release that leaves prereleases reads as one story rather than every beta's changes again.
 * The notes sit in `.changeset/release-notes/<version>/`, one file per section, and are deleted once written.
 */

import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import path from 'path'

/** Where each version's notes sit, relative to the repository root. */
export const NOTES_DIR = path.join('.changeset', 'release-notes')

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

/** A version's notes, its section files joined in order; throws for a file that isn't a section or that the site would cut. */
export function readNotes(folder: string): string {
  const files = readdirSync(folder)
  const unknown = files.filter(file => !SECTIONS.includes(file))
  if (unknown.length > 0) {
    throw new Error(`${folder}: ${unknown.join(', ')} is not a section; name each file one of ${SECTIONS.join(', ')}.`)
  }
  const sections = SECTIONS.filter(file => files.includes(file)).map(file => {
    const markdown = readFileSync(path.join(folder, file), 'utf8').trim()
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
  const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string }
  const parsed = parseVersion(version)
  if (!parsed) throw new Error(`package.json's version, "${version}", is not a version.`)
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
