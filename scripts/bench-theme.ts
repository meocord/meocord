/**
 * Checks that theming stays within its budget, under Bun and under Node: every handler call goes through it. Each
 * cost is what theming adds to a plain handler call with no theme, as a fraction of that call, measured on the same
 * machine in the same run, so the budgets hold on a laptop and on a shared CI runner alike.
 */
import { spawnSync } from 'child_process'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { CASES, type Case, type Measured, run } from './lib/theme-bench.js'

/**
 * What theming may add to a plain call, as a fraction of it, for each runtime. An app theme alone needs no scope,
 * so it adds a check; a `@UseTheme` adds a scope, and reading the theme a lookup; a server's and a user's themes
 * found in their caches add two lookups and two merges. Each is two to three times the highest measured: 0.05,
 * 0.24, 0.25 and 0.45 of a call under Node; 0.05, 0.07, 0.08 and 0.30 under Bun.
 */
const BUDGETS: Record<'bun' | 'node', Record<Case, number>> = {
  bun: { app: 0.12, scoped: 0.2, read: 0.25, resolved: 0.6 },
  node: { app: 0.12, scoped: 0.45, read: 0.5, resolved: 0.9 },
}

function underNode(): Measured {
  const dir = mkdtempSync(path.join(tmpdir(), 'meocord-bench-'))
  try {
    const built = spawnSync(
      process.execPath,
      ['build', path.join(import.meta.dirname, 'lib/theme-bench.ts'), '--target=node', '--outfile', path.join(dir, 'theme-bench.mjs')],
      { encoding: 'utf8' },
    )
    if (built.status !== 0) throw new Error(`Could not bundle the benchmark for Node:\n${built.stderr}`)
    const ran = spawnSync('node', [path.join(dir, 'theme-bench.mjs')], { encoding: 'utf8' })
    if (ran.status !== 0) throw new Error(`The benchmark failed under Node:\n${ran.stderr}`)
    return JSON.parse(ran.stdout.trim().split('\n').at(-1)!) as Measured
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const failures: string[] = []
for (const [runtime, { plainNs, results }] of [
  ['bun', await run()],
  ['node', underNode()],
] as const) {
  console.log(`${runtime}: a plain call ${plainNs.toFixed(0)} ns`)
  for (const c of CASES) {
    const added = (results[c] - plainNs) / plainNs
    console.log(`  ${c.padEnd(7)} ${results[c].toFixed(0).padStart(5)} ns  adds ${added.toFixed(2).padStart(5)} of a call (budget ${BUDGETS[runtime][c]})`)
    if (added > BUDGETS[runtime][c]) failures.push(`${runtime}: ${c} adds ${added.toFixed(2)} of a call, over its ${BUDGETS[runtime][c]} budget`)
  }
}

if (failures.length > 0) {
  console.error(`\nTheming is over budget:\n${failures.map(f => `  ${f}`).join('\n')}`)
  process.exit(1)
}
console.log('\nTheming is within budget.')
