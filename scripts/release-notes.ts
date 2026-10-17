// `release:version`'s check before `changeset version`, with --check, and its step after: see scripts/lib/release-notes.ts
import path from 'path'
import { fileURLToPath } from 'url'
import { execFileSync } from 'child_process'
import { ALLOWLIST_FILE, stampAllowlistFile } from './lib/allowlist.js'
import { checkNotesCoverChangesets, writeReleaseNotes } from './lib/release-notes.js'

/** Checks the notes cover every pending changeset, writing nothing. */
const CHECK_FLAG = '--check'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

if (process.argv.includes(CHECK_FLAG)) {
  try {
    checkNotesCoverChangesets(root)
  } catch (error) {
    console.error((error as Error).message)
    process.exit(1)
  }
  console.log('The release notes cover every pending changeset.')
} else {
  if (writeReleaseNotes(root)) console.log('Wrote the release notes into CHANGELOG.md.')
  // The release npm has decides which allowlist entries are retired; without it the entries are only stamped
  let latest: string | undefined
  try {
    latest = execFileSync('npm', ['view', 'meocord', 'dist-tags.latest'], { encoding: 'utf8' }).trim() || undefined
  } catch {
    // Reported below, as an empty answer is
  }
  if (latest === undefined) console.warn(`npm's latest meocord could not be read, so ${ALLOWLIST_FILE} is stamped but not tidied.`)
  if (stampAllowlistFile(root, latest)) console.log(`Stamped ${ALLOWLIST_FILE} for this release.`)
}
