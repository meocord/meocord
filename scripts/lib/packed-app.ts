/**
 * What the scripts that check a generated application share: packing the framework as npm would
 * publish it, rendering the application template against that tarball, and running commands with a
 * clean environment and readable output.
 */

import { spawnSync, type SpawnSyncReturns } from 'child_process'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
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
 * Runs a command to completion, throwing with its full output when it fails. On Windows, npm is a
 * `.cmd` script, which Node starts only through a shell.
 */
export function mustRun(label: string, command: string, args: string[], cwd: string, env = cleanEnv()): void {
  const shell = process.platform === 'win32' && command === 'npm'
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env, shell })
  if (result.status !== 0) {
    throw new Error(`${label} failed (${[command, ...args].join(' ')}, in ${cwd}):\n\n${outputOf(result) || String(result.error)}`)
  }
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
