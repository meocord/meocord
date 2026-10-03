/**
 * Installs the packed framework into one project per test runner (jest, vitest, node:test, bun test), typechecks each
 * against the built declarations, and runs its test of `meocord/testing` the way that runner's users write one. Run
 * after `bun run build`. The projects live in scripts/runner-consumers, sharing one app.
 */

import { spawnSync } from 'child_process'
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { cleanEnv, outputOf, pack, repoRoot } from './lib/packed-app.js'

const consumersDir = path.join(repoRoot, 'scripts', 'runner-consumers')
const tsc = path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc')

/** Outside the repository, so a consumer resolves only what it installed. */
const workDir = mkdtempSync(path.join(tmpdir(), 'meocord-runners-'))

/** Runs a command, printing one line on success and its full output on failure. */
function run(label: string, command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = cleanEnv()): void {
  const started = performance.now()
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env })
  if (result.status !== 0) {
    const where = `${[command, ...args].join(' ')}, in ${path.relative(workDir, cwd) || '.'}`
    throw new Error(`${label} failed (${where}):\n\n` + (outputOf(result) || String(result.error ?? `exit code ${result.status}`)))
  }
  console.log(`  ok  ${label} (${((performance.now() - started) / 1000).toFixed(1)}s)`)
}

/** Copies a consumer and the shared app into the work directory, its meocord dependency pointed at `tarball`. */
function consumer(name: string, tarball: string): string {
  const dir = path.join(workDir, name)
  cpSync(path.join(consumersDir, name), dir, { recursive: true })
  cpSync(path.join(consumersDir, 'shared'), path.join(dir, 'shared'), { recursive: true })
  const manifest = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }
  manifest.dependencies.meocord = `file:${tarball}`
  writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  run(`${name}: install`, process.execPath, ['install'], dir)
  // Its own module kind decides the declarations: a CommonJS project reads the .d.cts files, an ES module one the .d.ts
  run(`${name}: typecheck`, 'node', [tsc, '--noEmit', '--project', 'tsconfig.json'], dir)
  return dir
}

const node = (dir: string, bin: string) => path.join(dir, 'node_modules', bin)

const runners: Record<string, (dir: string) => void> = {
  // meocord's CommonJS build requires ES-module-only packages, which jest loads only with Node's VM modules enabled
  jest: dir =>
    run('jest: test', 'node', [node(dir, 'jest/bin/jest.js')], dir, cleanEnv({ NODE_OPTIONS: '--experimental-vm-modules' })),
  vitest: dir => run('vitest: test', 'node', [node(dir, 'vitest/vitest.mjs'), 'run'], dir),
  // Compiled by SWC to CommonJS and to ES modules, each run by Node's own test runner
  'node-test': dir => {
    const swc = node(dir, '@swc/cli/bin/swc.js')
    for (const [out, type, moduleType] of [
      ['out-cjs', 'commonjs', 'commonjs'],
      ['out-esm', 'module', 'es6'],
    ] as const) {
      run(`node:test: compile to ${type}`, 'node', [swc, 'node.test.ts', 'shared', '-d', out, '-C', `module.type=${moduleType}`], dir)
      writeFileSync(path.join(dir, out, 'package.json'), `${JSON.stringify({ type })}\n`)
      run(`node:test: test ${type}`, 'node', ['--test', path.join(out, 'node.test.js')], dir)
    }
  },
  bun: dir => run('bun test: test', process.execPath, ['test', 'bun.test.ts'], dir),
}

console.log(`Test runners against the packed framework, in ${workDir}:`)
const tarball = pack(workDir)
for (const [name, test] of Object.entries(runners)) test(consumer(name, tarball))
console.log(`\nEvery runner passes its test of meocord/testing.`)
