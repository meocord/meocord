/**
 * What the scripts that check a generated application share: packing the framework as npm would
 * publish it, rendering the application template against that tarball, and running commands with a
 * clean environment and readable output.
 */

import { spawnSync, type SpawnSyncReturns } from 'child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { AppGeneratorHelper } from '../../src/bin/helper/app-generator.helper.js'
import { assertFreshBuild } from './build-stamp.js'

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** The CLI as the repository built it. */
export const builtCli = path.join(repoRoot, 'dist', 'esm', 'bin', 'meocord.js')

/** The CLI as an application installed it, from the packed tarball. */
export const installedCliOf = (appDir: string): string => path.join(appDir, 'node_modules', 'meocord', 'dist', 'esm', 'bin', 'meocord.js')

/**
 * The environment commands run in. `NODE_ENV` is dropped because the CLI keeps an inherited one,
 * which would make `build --dev` build for production; so is what the package script running this
 * one exported, which the CLI reads to follow its launcher, and the test:e2e values Bun loads from a
 * .env file, tokens among them. Colour is off so output reads cleanly.
 */
export function cleanEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1' }
  delete env.npm_config_user_agent
  delete env.npm_execpath
  for (const key of Object.keys(env)) if (key.startsWith('MEOCORD_E2E_')) delete env[key]
  Object.assign(env, extra)
  delete env.FORCE_COLOR
  if (!('NODE_ENV' in extra)) delete env.NODE_ENV
  return env
}

/** A command's output without escape sequences: the CLI clears the screen, which would wipe what came before. */
export function outputOf(result: Pick<SpawnSyncReturns<string>, 'stdout' | 'stderr'>): string {
  return [result.stdout, result.stderr]
    .filter(Boolean)
    .join('\n')
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
    .trim()
}

/**
 * How long one setup step, such as an install, may run before it is stopped. The whole setup has taken up to 290 s on
 * CI's Windows runners, so a step past this is stuck, not slow.
 */
export const SETUP_BUDGET_MS = 600_000

/** Runs a step as one group and stops the whole group at its budget, or with its caller; see the script for why. */
export const boundedStep = path.join(path.dirname(fileURLToPath(import.meta.url)), 'bounded-step.mjs')

/** The descriptor the step's runner reports a stop at the budget on, which the step itself doesn't inherit. */
const STOP_REPORT_FD = 3

/**
 * Runs a command to completion, throwing with its full output when it fails. When it outlasts `budgetMs`, it and every
 * process it started are stopped, and it throws with its label and how long it ran. On Windows, npm is a `.cmd`
 * script, which Node starts only through a shell.
 */
export function mustRun(label: string, command: string, args: string[], cwd: string, env = cleanEnv(), budgetMs = SETUP_BUDGET_MS): void {
  const how = process.platform === 'win32' && command === 'npm' ? 'shell' : 'direct'
  const started = performance.now()
  const result = spawnSync(process.execPath, [boundedStep, String(budgetMs), how, command, ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env,
    stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
  })
  const ran = [command, ...args].join(' ')
  if (result.output[STOP_REPORT_FD]) {
    const seconds = ((performance.now() - started) / 1000).toFixed(1)
    throw new Error(`${label} did not finish within its ${budgetMs / 1000}s budget, stopped at ${seconds}s (${ran}, in ${cwd}):\n\n${outputOf(result)}`)
  }
  if (result.status !== 0) {
    throw new Error(`${label} failed (${ran}, in ${cwd}):\n\n${outputOf(result) || String(result.error)}`)
  }
}

/** Whether a process is running: on Windows too, where a process that has exited answers as gone. */
export function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // Running as another user: there, but not ours to signal
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** The script an application's own ESLint runs from, as its package names it for `eslint`, as the generator finds it. */
export function eslintScriptOf(appDir: string): string {
  const manifest = path.join(appDir, 'node_modules', 'eslint', 'package.json')
  if (!existsSync(manifest)) throw new Error(`${appDir} has no ESLint installed`)
  const { bin } = JSON.parse(readFileSync(manifest, 'utf8')) as { bin?: string | Record<string, string> }
  const script = typeof bin === 'string' ? bin : bin?.eslint
  if (!script) throw new Error(`${manifest} names no eslint script`)
  return path.resolve(path.dirname(manifest), script)
}

/**
 * Packs the framework as npm would publish it, so an application installs the tarball rather than a
 * link to the repository: only what `files` ships, resolved through `exports`.
 */
export function pack(into: string): string {
  // A dist built before the source changed would pass for the current code, and fail later on what it lacks
  assertFreshBuild(repoRoot)
  mustRun('pack the framework', 'npm', ['pack', '--ignore-scripts', '--silent', '--pack-destination', into], repoRoot)
  const tarball = readdirSync(into).find(name => name.endsWith('.tgz'))
  if (!tarball) throw new Error(`npm pack wrote no tarball into ${into}`)
  return path.join(into, tarball)
}

/** Renders the application template into `appDir`, with its framework dependency pointed at `tarball`. */
export function renderApp(appDir: string, tarball: string, packageManager: 'bun' | 'npm' | 'pnpm' = 'bun'): void {
  mkdirSync(appDir, { recursive: true })

  new AppGeneratorHelper().generateApp(appDir, {
    appName: 'generated-check',
    displayName: 'Generated Check',
    version: '0.0.0',
    packageManager,
    runtimePrefix: '',
  })

  const manifestPath = path.join(appDir, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  manifest.dependencies.meocord = `file:${tarball}`
  // npm lists a tarball's `prepare` as an unsettled install script, where it skips a registry package's, though it
  // runs `prepare` only for a directory. Allowed, matched by the dependency's own spec: a denied package's bins go unlinked.
  if (manifest.allowScripts) manifest.allowScripts[manifest.dependencies.meocord] = true
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
}
