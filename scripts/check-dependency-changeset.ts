// Fails when a change reaches what a consumer installs and adds no changeset: see scripts/lib/dependency-changeset.ts.
// Compares HEAD with `--base <rev>`, or in GitHub Actions with the base of the pull request or queued merge. A
// changeset counts when the net diff adds it: one added and deleted again, an edit or a rename doesn't.
import { execFileSync, spawnSync } from 'child_process'
import { readFileSync } from 'fs'
import { parseArgs } from 'util'
import {
  addedChangesets,
  baseOf,
  CHANGESET_DIR,
  consumerChanges,
  LOCKFILE,
  type Lockfile,
  MANIFEST,
  type Manifest,
  missingChangesetMessage,
  type Side,
  TEMPLATE,
} from './lib/dependency-changeset.js'

/** Bun's parser for bun.lock, which is JSON with trailing commas */
declare const Bun: { JSONC: { parse(text: string): unknown } }

/** The revision a run compares: the commit checked out, so what the check reads is what merges */
const HEAD = 'HEAD'

/** Room for `git show` of a bun.lock that grows past Node's 1 MB default for a child's output */
const GIT_OUTPUT_LIMIT = 64 * 1024 * 1024

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: GIT_OUTPUT_LIMIT })
}

/** Whether this object exists, asked quietly: `git cat-file -e` reports a missing one on stderr */
function exists(object: string): boolean {
  return spawnSync('git', ['cat-file', '-e', object], { stdio: 'ignore' }).status === 0
}

/** The commit where HEAD's history left `rev`'s */
function mergeBaseOf(rev: string): string {
  const run = spawnSync('git', ['merge-base', rev, HEAD], { encoding: 'utf8' })
  if (run.status !== 0) {
    console.error(`${rev} and ${HEAD} share no commit to compare from.`)
    process.exit(2)
  }
  return run.stdout.trim()
}

/** A file's text at a revision, or undefined when the revision has no such file */
function fileAt(rev: string, file: string): string | undefined {
  return exists(`${rev}:${file}`) ? git('show', `${rev}:${file}`) : undefined
}

function sideAt(rev: string): Side {
  const manifest = fileAt(rev, MANIFEST)
  const lock = fileAt(rev, LOCKFILE)
  if (manifest === undefined || lock === undefined) throw new Error(`${rev} has no ${MANIFEST} or no ${LOCKFILE}`)
  const template = fileAt(rev, TEMPLATE)
  return {
    manifest: JSON.parse(manifest) as Manifest,
    template: template === undefined ? {} : (JSON.parse(template) as Manifest),
    lock: Bun.JSONC.parse(lock) as Lockfile,
  }
}

const { values } = parseArgs({ options: { base: { type: 'string' } } })
const eventPath = process.env.GITHUB_EVENT_PATH
const base =
  values.base === undefined
    ? baseOf(process.env.GITHUB_EVENT_NAME, eventPath ? JSON.parse(readFileSync(eventPath, 'utf8')) : undefined)
    : { rev: values.base, fetch: false }

if (base === undefined) {
  if (process.env.GITHUB_EVENT_NAME === undefined) {
    console.error('Name the revision to compare with: --base <rev>.')
    process.exit(2)
  }
  console.log(`Skipped on ${process.env.GITHUB_EVENT_NAME}: only a pull request or a queued merge has a base.`)
  process.exit(0)
}

if (base.fetch) git('fetch', '--no-tags', '--depth=1', 'origin', base.rev)

// A shallow checkout holds only the commits it fetched
if (!exists(`${base.rev}^{commit}`)) {
  console.error(`${base.rev} is not in this checkout. Fetch it first; in CI, Lint's checkout fetches two commits.`)
  process.exit(2)
}

// A branch behind `--base` is compared from where it left it, or the base's own later changes would show reversed.
// CI's bases are ancestors already, and a shallow queue checkout couldn't find a merge base.
const from = values.base === undefined ? base.rev : mergeBaseOf(base.rev)

const changes = consumerChanges(sideAt(from), sideAt(HEAD))
const added = git('diff', '--name-only', '--find-renames', '--diff-filter=A', '-z', from, HEAD, '--', CHANGESET_DIR)
  .split('\0')
  .filter(Boolean)
const changesets = addedChangesets(added)

if (changes.length === 0) {
  console.log('Nothing a consumer installs changed.')
} else if (changesets.length === 0) {
  console.error(missingChangesetMessage(changes))
  process.exit(1)
} else {
  console.log(`${changesets.join(', ')} covers what a consumer installs:\n${changes.map(line => `  ${line}`).join('\n')}`)
}
