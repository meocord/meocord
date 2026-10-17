/**
 * Decides, in the Release job, whether the committed version is still to be published, and writes `unpublished` to
 * the step's outputs for `pack` and `publish`. It fails when npm serves the version without its tag or GitHub release,
 * which no re-run of the workflow repairs.
 */
import { spawnSync } from 'child_process'
import { appendFileSync, readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { parseVersions, publishedState, ReleaseUnfinished, releaseFound, tagFound } from './lib/published-state.js'

/** How long one registry, git or GitHub read may take, connecting included, before it counts as unanswered */
const REQUEST_TIMEOUT_MS = 30_000

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const run = (command: string, args: string[]) =>
  spawnSync(command, args, { cwd: repoRoot, encoding: 'utf8', timeout: REQUEST_TIMEOUT_MS })

const { name, version } = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
  name: string
  version: string
}

function readVersions(): string[] | Error {
  const npm = run('npm', ['view', name, 'versions', '--json', '--prefer-online', '--fetch-retries', '0'])
  if (npm.status !== 0) return npm.error ?? new Error(npm.stderr.trim().split('\n')[0] || `npm exited ${npm.status}`)
  try {
    return parseVersions(npm.stdout)
  } catch (error) {
    return error as Error
  }
}

function hasTag(): boolean | undefined {
  return tagFound(run('git', ['ls-remote', '--exit-code', '--tags', 'origin', `refs/tags/v${version}`]).status)
}

function hasRelease(): boolean | undefined {
  const repository = process.env.GITHUB_REPOSITORY
  if (!repository) return undefined
  const gh = run('gh', ['api', `repos/${repository}/releases/tags/v${version}`, '--silent'])
  return releaseFound(gh.status, gh.stderr)
}

const versions = readVersions()
const listed = Array.isArray(versions) && versions.includes(version)
try {
  const state = publishedState({
    name,
    version,
    versions,
    ...(listed && { tag: hasTag(), release: hasRelease() }),
  })
  for (const warning of state.warnings) console.log(`::warning title=Published state::${warning}`)
  console.log(`${name}@${version}: unpublished=${state.unpublished}`)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `unpublished=${state.unpublished}\n`)
} catch (error) {
  if (!(error instanceof ReleaseUnfinished)) throw error
  console.log(`::error title=Release unfinished::${error.message}`)
  process.exit(1)
}
