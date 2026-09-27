/**
 * Marks dist with the source it was built from, so the scripts that pack dist refuse one built before the source
 * last changed rather than failing later on what the old build lacks. `bun run build` writes the stamp.
 */

import { createHash } from 'crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import path from 'path'

/** What a build is made from: the source, less its specs and type tests, and the files that configure the build. */
const INPUTS = ['src', 'package.json', 'rollup.config.js', 'tsconfig.json']
const isTestOnly = (file: string) => /\.(spec|test-d)\.ts$/.test(file)

export const STAMP_FILE = path.join('dist', '.build-stamp')

export const STALE_BUILD = 'dist is older than the source: run `bun run build` first'

/** The files under `input`, relative to `root` and with `/` separators, so the stamp is the same on every platform. */
function filesOf(root: string, input: string): string[] {
  const absolute = path.join(root, input)
  if (!existsSync(absolute)) return []
  if (!statSync(absolute).isDirectory()) return [input]
  return readdirSync(absolute, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
    .filter(file => !isTestOnly(file))
}

/** A hash of every build input's path and content under `root`. */
export function sourceStamp(root: string): string {
  const hash = createHash('sha256')
  for (const file of INPUTS.flatMap(input => filesOf(root, input)).sort()) {
    hash.update(file).update('\0').update(readFileSync(path.join(root, file))).update('\0')
  }
  return hash.digest('hex')
}

/** Records in dist the source it was just built from. */
export function writeBuildStamp(root: string): void {
  mkdirSync(path.join(root, 'dist'), { recursive: true })
  writeFileSync(path.join(root, STAMP_FILE), `${sourceStamp(root)}\n`)
}

/** Throws {@link STALE_BUILD} when dist has no stamp, or was built from other source than `root` holds now. */
export function assertFreshBuild(root: string): void {
  const stampFile = path.join(root, STAMP_FILE)
  const built = existsSync(stampFile) ? readFileSync(stampFile, 'utf8').trim() : undefined
  if (built !== sourceStamp(root)) throw new Error(STALE_BUILD)
}
