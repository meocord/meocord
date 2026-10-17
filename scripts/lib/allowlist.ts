/**
 * The API allowlist: each deliberate break check-api-compat.ts accepts, by its id, with why it is deliberate and the
 * version that ships it. `release:version` stamps the version on entries that have none, so a contributor writes only
 * the reason. Once that version is the baseline the check compares with, the baseline has the change, and the entry is
 * retired: the check no longer reads it, and the next release removes it.
 */

import { execFileSync } from 'child_process'
import { readFileSync, writeFileSync } from 'fs'
import path from 'path'

/** One deliberate break: why, and the version that ships it once a release has stamped it. */
export interface AllowlistEntry {
  reason: string
  version?: string
}

/** Each allowlisted break by the id check-api-compat.ts reports it under, such as `decorator MeoCordOptions.controllers`. */
export type Allowlist = Record<string, AllowlistEntry>

/** A semver version, as `compareVersions` orders it. */
const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

/** The parts of `version` semver orders by, or `undefined` for anything that isn't a version. */
function partsOf(version: string): { core: number[]; prerelease: string[] } | undefined {
  const match = VERSION.exec(version)
  if (!match) return undefined
  return { core: match.slice(1, 4).map(Number), prerelease: match[4]?.split('.') ?? [] }
}

/** Negative, zero or positive as `a` is before, equal to or after `b` in semver precedence. */
export function compareVersions(a: string, b: string): number {
  const [x, y] = [a, b].map(version => {
    const parts = partsOf(version)
    if (!parts) throw new Error(`"${version}" is not a version.`)
    return parts
  })
  const core = x.core.findIndex((part, index) => part !== y.core[index])
  if (core >= 0) return x.core[core] - y.core[core]
  // A prerelease comes before its release; among prereleases, identifiers compare one by one, numbers as numbers
  if (x.prerelease.length === 0 || y.prerelease.length === 0) return y.prerelease.length - x.prerelease.length
  for (let index = 0; index < Math.min(x.prerelease.length, y.prerelease.length); index++) {
    const [p, q] = [x.prerelease[index], y.prerelease[index]]
    if (p === q) continue
    const [pn, qn] = [/^\d+$/.test(p), /^\d+$/.test(q)]
    if (pn && qn) return Number(p) - Number(q)
    if (pn !== qn) return pn ? -1 : 1
    return p < q ? -1 : 1
  }
  return x.prerelease.length - y.prerelease.length
}

/** Whether the baseline already has the change `entry` allows: a version stamped on it at or below the baseline. */
export function isRetired(entry: AllowlistEntry, baseline: string): boolean {
  return entry.version !== undefined && compareVersions(entry.version, baseline) <= 0
}

/** The allowlist file's contents, checked: each entry an object with a reason, and a version if any. */
export function parseAllowlist(json: unknown): Allowlist {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) throw new Error('The API allowlist is not a JSON object.')
  for (const [id, entry] of Object.entries(json)) {
    const { reason, version } = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>
    if (typeof reason !== 'string' || reason.trim() === '') {
      throw new Error(`The API allowlist's "${id}" needs { "reason": "…" }, saying why the break is deliberate.`)
    }
    if (version !== undefined && (typeof version !== 'string' || !partsOf(version))) {
      throw new Error(`The API allowlist's "${id}" has a version that isn't one: ${JSON.stringify(version)}.`)
    }
  }
  return json as Allowlist
}

/**
 * The allowlist as a release leaves it: each entry without a version stamped with `version`, the one being released,
 * and each one `latest` has retired removed. Without `latest`, as when npm can't be reached, nothing is removed, so
 * tidying never stops a release. The release pull request starts again from main's allowlist each time it is
 * regenerated, and stamping it twice gives the same file.
 */
export function stampAllowlist(allowlist: Allowlist, version: string, latest: string | undefined): Allowlist {
  return Object.fromEntries(
    Object.entries(allowlist)
      .filter(([, entry]) => latest === undefined || !isRetired(entry, latest))
      .map(([id, entry]) => [id, entry.version === undefined ? { ...entry, version } : entry]),
  )
}

/** The allowlist file, relative to the repository root. */
export const ALLOWLIST_FILE = path.join('scripts', 'api-compat-allowlist.json')

/**
 * Stamps the allowlist file under `root` for the version package.json now holds, as `release:version` does once
 * `changeset version` has set it, removing what `latest` has retired.
 *
 * @returns Whether the file changed.
 */
export function stampAllowlistFile(root: string, latest: string | undefined): boolean {
  const file = path.join(root, ALLOWLIST_FILE)
  const allowlist = parseAllowlist(JSON.parse(readFileSync(file, 'utf8')))
  const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string }
  // An answer that isn't a version, as an empty one, says nothing about what npm has
  const stamped = stampAllowlist(allowlist, version, latest !== undefined && partsOf(latest) ? latest : undefined)
  if (JSON.stringify(stamped) === JSON.stringify(allowlist)) return false
  writeFileSync(file, `${JSON.stringify(stamped, null, 2)}\n`)
  return true
}

/**
 * How long `release:version` waits for npm to name its latest release. Tidying the allowlist is optional, and npm's own
 * retries can take minutes when the registry stalls, so it gives up soon and the entries are only stamped.
 */
export const NPM_VIEW_TIMEOUT_MS = 15_000

/** Asks npm for meocord's dist-tag `latest`, within `timeout` milliseconds. */
type ViewLatest = (timeout: number) => string

const viewLatest: ViewLatest = timeout => execFileSync('npm', ['view', 'meocord', 'dist-tags.latest'], { encoding: 'utf8', timeout })

/** npm's latest meocord, or `undefined` when npm can't say in time or answers with something other than a version. */
export function latestRelease(timeout = NPM_VIEW_TIMEOUT_MS, view: ViewLatest = viewLatest): string | undefined {
  try {
    const latest = view(timeout).trim()
    return partsOf(latest) ? latest : undefined
  } catch {
    return undefined
  }
}
