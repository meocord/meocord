import { readFileSync } from 'fs'
import path from 'path'
import { readPreState } from '@changesets/pre'
import { readChangesets } from '@changesets/read'

/** The changeset bump that raises the package to its next major version */
const MAJOR = 'major'

/**
 * The pending changesets that bump the package by `major` while the repository is not in pre-release mode, each
 * named by its file. Outside pre-release mode `main` is the current major's line, so one such changeset would make
 * the next release a major; in pre-release mode (`.changeset/pre.json`) `main` is building the next major.
 */
export async function majorChangesetsOutsidePre(root: string): Promise<string[]> {
  if ((await readPreState(root)) !== undefined) return []
  const { name } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { name: string }
  const changesets = await readChangesets(root)
  return changesets
    .filter(changeset => changeset.releases.some(release => release.name === name && release.type === MAJOR))
    .map(changeset => `${changeset.id}.md`)
    .sort()
}

/** Why each named changeset can't merge yet, and what its author does instead. */
export function majorChangesetMessage(files: string[]): string {
  return files
    .map(
      file =>
        `.changeset/${file} bumps the package by major, but main is still the current major's line, so the next ` +
        'release would be a major. Hold the change in a draft pull request until the next major opens, or make it ' +
        'non-breaking: a deprecated alias, or an opt-in the major makes the default. See CONTRIBUTING.md, ' +
        '"Release lines and the next major".',
    )
    .join('\n')
}
