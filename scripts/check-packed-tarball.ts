/**
 * Checks, before anything is published, that the tarball Pack made is the one Build packed and its checks installed,
 * and the one its publish plan records:
 *
 *   bun --no-install scripts/check-packed-tarball.ts <Build's package directory> <Pack's artifact directory>
 *
 * It runs in a job with no install, so it imports only Node's own modules and the scripts' own.
 */
import { spawnSync } from 'child_process'
import { existsSync, readdirSync, readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { checkPackage, PackageMismatch, type PublishPlan } from './lib/packed-tarball.js'
import { parseVersions } from './lib/published-state.js'

/** How long npm may take to list the versions, connecting included */
const REQUEST_TIMEOUT_MS = 30_000

/** The file `changeset pack` writes beside the tarballs */
const PLAN_FILE = 'publish-plan.json'

const [testedDir, packedDir] = process.argv.slice(2)
if (!testedDir || !packedDir) {
  console.error("Usage: bun --no-install scripts/check-packed-tarball.ts <Build's directory> <Pack's directory>")
  process.exit(2)
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { name, version } = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
  name: string
  version: string
}

const tgz = readdirSync(testedDir).filter(file => file.endsWith('.tgz'))
if (tgz.length !== 1) throw new Error(`${testedDir} should hold Build's one tarball, and holds ${tgz.length}`)

// The artifact holds the plan at its root, or in a directory named after the artifact
const planDir = [packedDir, ...readdirSync(packedDir).map(entry => path.join(packedDir, entry))].find(dir =>
  existsSync(path.join(dir, PLAN_FILE)),
)
if (!planDir) throw new Error(`No ${PLAN_FILE} in ${packedDir}`)

function listed(): boolean | Error {
  const npm = spawnSync('npm', ['view', name, 'versions', '--json', '--prefer-online', '--fetch-retries', '0'], {
    encoding: 'utf8',
    timeout: REQUEST_TIMEOUT_MS,
  })
  if (npm.status !== 0) return npm.error ?? new Error(npm.stderr.trim().split('\n')[0] || `npm exited ${npm.status}`)
  try {
    return parseVersions(npm.stdout).includes(version)
  } catch (error) {
    return error as Error
  }
}

try {
  const lines = checkPackage({
    name,
    version,
    plan: JSON.parse(readFileSync(path.join(planDir, PLAN_FILE), 'utf8')) as PublishPlan,
    packed: planPath => {
      const file = path.join(planDir, planPath)
      return existsSync(file) ? readFileSync(file) : undefined
    },
    tested: readFileSync(path.join(testedDir, tgz[0]!)),
    listed,
  })
  console.log(lines.join('\n'))
} catch (error) {
  if (!(error instanceof PackageMismatch)) throw error
  console.log(error.message)
  console.log(`::error title=Package check::${error.message.split('\n').at(-1)}`)
  process.exit(1)
}
