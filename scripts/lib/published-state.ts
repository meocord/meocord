/** What the Release job learns about the committed version before `pack` and `publish` decide whether to run. */
export interface PublishedFacts {
  /** The package's name */
  name: string
  /** The version package.json commits */
  version: string
  /** npm's published versions of the package, or why they could not be read */
  versions: string[] | Error
  /** Whether the `v<version>` tag exists, `undefined` when that could not be checked */
  tag?: boolean
  /** Whether the version's GitHub release exists, `undefined` when that could not be checked */
  release?: boolean
}

/** The decision: whether `pack` and `publish` run, and what the run should note on the way. */
export interface PublishedState {
  unpublished: boolean
  warnings: string[]
}

/** A version npm serves without its tag or GitHub release, which a re-run of the workflow cannot repair */
export class ReleaseUnfinished extends Error {
  override name = 'ReleaseUnfinished'
}

/** `git ls-remote --exit-code`'s status when no ref matches */
const NO_MATCHING_REF = 2

/** What `gh api` prints for a release that doesn't exist */
const NOT_FOUND = /HTTP 404/

/** Whether `git ls-remote --exit-code` found the tag, from its exit status; `undefined` when git itself failed */
export function tagFound(status: number | null): boolean | undefined {
  if (status === 0) return true
  return status === NO_MATCHING_REF ? false : undefined
}

/** Whether `gh api` found the release, from its exit status and what it printed; `undefined` when the call failed */
export function releaseFound(status: number | null, stderr: string): boolean | undefined {
  if (status === 0) return true
  return NOT_FOUND.test(stderr) ? false : undefined
}

/** The versions `npm view <name> versions --json` printed, which in JSON is a list even for one version */
export function parseVersions(json: string): string[] {
  const versions: unknown = JSON.parse(json)
  if (!Array.isArray(versions) || !versions.every(version => typeof version === 'string')) {
    throw new Error(`npm printed no list of versions: ${json.slice(0, 200)}`)
  }
  return versions
}

/**
 * Whether the committed version still has to be published, by the test changesets itself applies: membership in npm's
 * published versions. An npm error counts as unpublished, so `pack` and `publish` run and changesets publishes only
 * what npm lacks. A published version must also have its tag and GitHub release, or the release is unfinished.
 */
export function publishedState({ name, version, versions, tag, release }: PublishedFacts): PublishedState {
  if (versions instanceof Error) {
    return {
      unpublished: true,
      warnings: [
        `npm's versions could not be read (${versions.message}), so the version is packed and offered to publish.`,
      ],
    }
  }
  if (!versions.includes(version)) return { unpublished: true, warnings: [] }

  const missing = [tag === false && `its v${version} tag`, release === false && 'its GitHub release'].filter(Boolean)
  if (missing.length > 0) {
    throw new ReleaseUnfinished(
      `${name}@${version} is on npm without ${missing.join(' or ')}. Create ${missing.length > 1 ? 'them' : 'it'} by ` +
        "hand on the merge commit of the `chore: release` pull request (CONTRIBUTING.md, 'How a release happens').",
    )
  }
  const unchecked = [tag === undefined && `the v${version} tag`, release === undefined && 'its GitHub release']
  const unknown = unchecked.filter(Boolean).join(' and ')
  return {
    unpublished: false,
    warnings: unknown ? [`${name}@${version} is on npm, but ${unknown} could not be checked.`] : [],
  }
}
