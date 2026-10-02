// The step after `changeset version` in `release:version`: see scripts/lib/release-notes.ts
import path from 'path'
import { fileURLToPath } from 'url'
import { writeReleaseNotes } from './lib/release-notes.js'

if (writeReleaseNotes(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'))) {
  console.log('Wrote the release notes into CHANGELOG.md.')
}
