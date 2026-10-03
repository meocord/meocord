/**
 * Installs the packed framework into one project per test runner (jest, vitest, node:test, bun test), typechecks each
 * against the built declarations, and runs its test of `meocord/testing` the way that runner's users write one. Run
 * after `bun run build`. The projects live in scripts/runner-consumers, sharing one app.
 *
 * Each project installs the runner versions its bun.lock pins, so a release of jest or vitest cannot fail this check
 * without a change here. `--float` resolves them afresh instead, as a new user's install would.
 *
 *   bun scripts/verify-runners.ts [--float]
 */

import { spawnSync } from 'child_process'
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { cleanEnv, outputOf, pack, repoRoot } from './lib/packed-app.js'

const consumersDir = path.join(repoRoot, 'scripts', 'runner-consumers')
const tsc = path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc')
const float = process.argv.includes('--float')

/** Outside the repository, so a consumer resolves only what it installed. */
const workDir = mkdtempSync(path.join(tmpdir(), 'meocord-runners-'))

/** Runs a command, printing one line on success and its full output on failure, and returns that output. */
function run(label: string, command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = cleanEnv()): string {
  const started = performance.now()
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env })
  const output = outputOf(result)
  if (result.status !== 0) {
    const where = `${[command, ...args].join(' ')}, in ${path.relative(workDir, cwd) || '.'}`
    throw new Error(`${label} failed (${where}):\n\n` + (output || String(result.error ?? `exit code ${result.status}`)))
  }
  console.log(`  ok  ${label} (${((performance.now() - started) / 1000).toFixed(1)}s)`)
  return output
}

/**
 * Reads a runner's own count of passed and failed tests from its output, and throws unless it ran exactly the tests
 * expected: a runner that finds no test file exits 0 too. Prints the lines the counts came from.
 */
function expectCounts(label: string, output: string, patterns: { pass: RegExp; fail?: RegExp }, expected: number): void {
  const pass = patterns.pass.exec(output)
  const fail = patterns.fail?.exec(output)
  const failed = fail ? Number(fail[1]) : 0
  if (!pass || Number(pass[1]) !== expected || failed !== 0) {
    throw new Error(`${label}: expected ${expected} passing and none failing, but the runner reported:\n\n${output}`)
  }
  for (const line of [pass[0], fail?.[0]].filter(Boolean)) console.log(`      ${line!.trim()}`)
}

/** Copies a consumer and the shared app into the work directory, and installs it with meocord from `tarball`. */
function consumer(name: string, tarball: string): string {
  const dir = path.join(workDir, name)
  cpSync(path.join(consumersDir, name), dir, { recursive: true })
  cpSync(path.join(consumersDir, 'shared'), path.join(dir, 'shared'), { recursive: true })
  if (float) rmSync(path.join(dir, 'bun.lock'))
  run(`${name}: install`, process.execPath, ['install', ...(float ? [] : ['--frozen-lockfile'])], dir)
  // Added after the locked install, so the runners stay as the lockfile pins them
  run(`${name}: add the packed meocord`, process.execPath, ['add', `meocord@file:${tarball}`], dir)
  // Its own module kind decides the declarations: a CommonJS project reads the .d.cts files, an ES module one the .d.ts
  run(`${name}: typecheck`, 'node', [tsc, '--noEmit', '--project', 'tsconfig.json'], dir)
  return dir
}

const node = (dir: string, bin: string) => path.join(dir, 'node_modules', bin)

const runners: Record<string, (dir: string) => void> = {
  // meocord's CommonJS build requires ES-module-only packages, which jest loads only with Node's VM modules enabled
  jest: dir => {
    const env = cleanEnv({ NODE_OPTIONS: '--experimental-vm-modules' })
    const output = run('jest: test', 'node', [node(dir, 'jest/bin/jest.js')], dir, env)
    expectCounts('jest', output, { pass: /^Tests:\s+(\d+) passed.*$/m, fail: /^Tests:.*?(\d+) failed.*$/m }, 1)
  },
  vitest: dir => {
    const output = run('vitest: test', 'node', [node(dir, 'vitest/vitest.mjs'), 'run'], dir)
    expectCounts('vitest', output, { pass: /^\s*Tests\s+(\d+) passed.*$/m, fail: /^\s*Tests\s+(\d+) failed.*$/m }, 1)
  },
  // Compiled by SWC to CommonJS and to ES modules, each run by Node's own test runner
  'node-test': dir => {
    const swc = node(dir, '@swc/cli/bin/swc.js')
    for (const [out, type, moduleType] of [
      ['out-cjs', 'commonjs', 'commonjs'],
      ['out-esm', 'module', 'es6'],
    ] as const) {
      run(`node:test: compile to ${type}`, 'node', [swc, 'node.test.ts', 'shared', '-d', out, '-C', `module.type=${moduleType}`], dir)
      writeFileSync(path.join(dir, out, 'package.json'), `${JSON.stringify({ type })}\n`)
      const output = run(`node:test: test ${type}`, 'node', ['--test', '--test-reporter=tap', path.join(out, 'node.test.js')], dir)
      expectCounts(`node:test (${type})`, output, { pass: /^# pass (\d+)$/m, fail: /^# fail (\d+)$/m }, 1)
    }
  },
  bun: dir => {
    const output = run('bun test: test', process.execPath, ['test', 'bun.test.ts'], dir)
    // The test.failing case counts as a pass while it fails as expected
    expectCounts('bun test', output, { pass: /^\s*(\d+) pass$/m, fail: /^\s*(\d+) fail$/m }, 2)
    const expectedFailure = output.split('\n').find(line => line.includes("bun's mock matchers read meocord's mocks"))
    if (!expectedFailure) throw new Error(`bun test: the expected-failure case did not run:\n\n${output}`)
    console.log(`      ${expectedFailure.trim()}`)
  },
}

console.log(`Test runners against the packed framework, ${float ? 'resolved afresh' : 'as their lockfiles pin them'}, in ${workDir}:`)
const tarball = pack(workDir)
for (const [name, test] of Object.entries(runners)) test(consumer(name, tarball))
console.log(`\nEvery runner passes its test of meocord/testing.`)
