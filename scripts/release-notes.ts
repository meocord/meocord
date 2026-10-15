// `release:version`'s check before `changeset version`, with --check, and its step after: see scripts/lib/release-notes.ts
import path from 'path'
import { fileURLToPath } from 'url'
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
} else if (writeReleaseNotes(root)) {
  console.log('Wrote the release notes into CHANGELOG.md.')
}
