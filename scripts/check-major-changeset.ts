// Fails while a pending changeset bumps the package by major outside pre-release mode: see scripts/lib/major-changeset.ts
import path from 'path'
import { fileURLToPath } from 'url'
import { majorChangesetMessage, majorChangesetsOutsidePre } from './lib/major-changeset.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const files = await majorChangesetsOutsidePre(root)
if (files.length > 0) {
  console.error(majorChangesetMessage(files))
  process.exit(1)
}
console.log('No pending changeset makes the next release a major.')
