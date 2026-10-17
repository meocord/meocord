/**
 * Runs mutation testing module by module, as stryker.config.mjs defines them, and prints each
 * module's score. `bun run test:mutation` runs every module; name modules to run only those, and add
 * `--force` to retest every mutant instead of reusing the incremental results.
 */

import { spawnSync } from 'child_process'
import { readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { modules } from '../stryker.config.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
/** The flag that makes Stryker ignore a module's incremental results and test every mutant again. */
const FORCE_FLAG = '--force'

const args = process.argv.slice(2).filter(arg => arg !== '--')
const force = args.includes(FORCE_FLAG)
const requested = args.filter(arg => arg !== FORCE_FLAG)
const unknown = requested.filter(name => !(name in modules))
if (unknown.length > 0) {
  console.error(`Unknown module(s): ${unknown.join(', ')}. Choose from: ${Object.keys(modules).join(', ')}.`)
  process.exit(1)
}

interface Mutant {
  status: string
}

/** Counts a module's mutants by outcome from its JSON report; the score counts timeouts as killed. */
function summarise(name: string) {
  const report = JSON.parse(readFileSync(path.join(repoRoot, 'reports', 'mutation', `${name}.json`), 'utf8')) as {
    files: Record<string, { mutants: Mutant[] }>
  }
  const mutants = Object.values(report.files).flatMap(file => file.mutants)
  const count = (status: string) => mutants.filter(mutant => mutant.status === status).length
  const detected = count('Killed') + count('Timeout')
  const undetected = count('Survived') + count('NoCoverage')
  const score = detected + undetected === 0 ? 100 : (100 * detected) / (detected + undetected)
  return { name, killed: count('Killed'), timeout: count('Timeout'), survived: count('Survived'), noCoverage: count('NoCoverage'), score }
}

const results: ReturnType<typeof summarise>[] = []
for (const name of requested.length > 0 ? requested : Object.keys(modules)) {
  console.log(`\n== ${name}`)
  const run = spawnSync('bunx', ['stryker', 'run', ...(force ? [FORCE_FLAG] : [])], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, MUTATION_MODULE: name },
  })
  if (run.status !== 0) {
    console.error(`Stryker failed for ${name} (exit code ${run.status}).`)
    process.exit(run.status ?? 1)
  }
  results.push(summarise(name))
}

console.log('\nModule                  Score   Killed  Timeout  Survived  No coverage')
for (const { name, score, killed, timeout, survived, noCoverage } of results) {
  console.log(
    `${name.padEnd(22)} ${score.toFixed(1).padStart(6)}% ${String(killed).padStart(7)} ${String(timeout).padStart(8)} ${String(survived).padStart(9)} ${String(noCoverage).padStart(12)}`,
  )
}
