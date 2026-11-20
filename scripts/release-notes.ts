// `release:version`'s check before `changeset version`, with --check, and its step after: see scripts/lib/release-notes.ts
import path from 'path'
import { fileURLToPath } from 'url'
import { ALLOWLIST_FILE, latestRelease, stampAllowlistFile } from './lib/allowlist.js'
import { checkChangesetMentions, checkNotesCoverChangesets, writeReleaseNotes } from './lib/release-notes.js'

/** Checks the notes cover every pending changeset and no changeset mentions a user, writing nothing. */
const CHECK_FLAG = '--check'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

if (process.argv.includes(CHECK_FLAG)) {
  const failures = [checkNotesCoverChangesets, checkChangesetMentions].flatMap(check => {
    try {
      check(root)
      return []
    } catch (error) {
      return [(error as Error).message]
    }
  })
  if (failures.length > 0) {
    console.error(failures.join('\n'))
    process.exit(1)
  }
  console.log('The release notes cover every pending changeset, and no changeset mentions a user.')
} else {
  if (writeReleaseNotes(root)) console.log('Wrote the release notes into CHANGELOG.md.')
  // The release npm has decides which allowlist entries are retired; without it the entries are only stamped
  const latest = latestRelease()
  if (latest === undefined) console.warn(`npm's latest meocord could not be read, so ${ALLOWLIST_FILE} is stamped but not tidied.`)
  if (stampAllowlistFile(root, latest)) console.log(`Stamped ${ALLOWLIST_FILE} for this release.`)
}
