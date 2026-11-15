/**
 * Loads both builds in one process after `bun run build`, under Node and under Bun, as a project that mixes `import`
 * and `require()` of meocord does, through `scripts/dual-build-probe.js`. The CommonJS build carries its own copy of
 * each ES-module-only dependency (`scripts/es-module-only.js`), so the process runs two copies of inversify and chalk:
 *
 * - An app from either build, as a testing module and as a started bot, with each build loaded first: a service and
 *   a theme resolver the other build decorated are injected, the theme reads the same from either build, and every
 *   store the builds share is walked for inversify containers, each of which must answer through its own methods.
 * - The same under Node, with the ES module build on the lowest inversify the range in package.json admits, installed
 *   for the check: each inversify release pins its own @inversifyjs/core, and the range promises each works beside
 *   the bundled one. That install has no lockfile, so its packages' own dependencies resolve afresh, as for a
 *   consumer on the floor: a failure here can come from one of their new releases.
 * - The classes MeoCord binds (Translator, ThemeCache, ExecutionContext, CooldownStore, HandlerRegistry, ShardContext)
 *   and MemoryCooldownStore are one class object for both builds of a version, so a file typed against either build
 *   is given the app's instance, while a copy of `dist` with another version keeps its own.
 * - Each build's Logger writes the same lines, colour forced on, forced off, and left to the environment, under Node.
 *
 * A run keeps its temporary files in one folder named for its host and process. A run killed by a signal leaves it, and
 * the next run on the host removes those of runs whose process is gone, where it can.
 */
import { spawnSync } from 'child_process'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { createRequire } from 'module'
import { hostname, tmpdir } from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PROBE = path.join('scripts', 'dual-build-probe.js')
const BUILDS = ['esm', 'cjs'] as const
const MODES = ['module', 'bot'] as const

/** Colour settings a Logger is compared under: forced off, forced at each level, and left to a stream that's no TTY. */
const COLOR_ENVIRONMENTS: Record<string, Record<string, string>> = {
  'NO_COLOR=1': { NO_COLOR: '1' },
  'FORCE_COLOR=0': { FORCE_COLOR: '0' },
  'FORCE_COLOR=1': { FORCE_COLOR: '1' },
  'FORCE_COLOR=3': { FORCE_COLOR: '3' },
  'neither set': {},
}

/** The runtimes the probe runs under: a project may run its tests or its bot with either. */
const RUNTIMES = ['node', 'bun'] as const

/** Runs the probe of `root`, a checkout or a copy of one, with the `dist` and `node_modules` beside it. */
function runProbe(runtime: (typeof RUNTIMES)[number], args: string[], env: Record<string, string> = {}, root = repoRoot): unknown {
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NO_COLOR' && key !== 'FORCE_COLOR'))
  // Bun installs a package it can't resolve unless told not to
  const probe = path.join(root, PROBE)
  const command = runtime === 'bun' ? ['--no-install', probe, ...args] : [probe, ...args]
  const run = spawnSync(runtime, command, { cwd: root, encoding: 'utf8', env: { ...inherited, NODE_ENV: 'production', ...env } })
  const last = run.stdout.trim().split('\n').at(-1) ?? ''
  try {
    return JSON.parse(last)
  } catch {
    return { problems: [`the probe did not finish (exit ${run.status}):\n${run.stdout}${run.stderr}`] }
  }
}

/** How long installing the lowest inversify may take: seconds as a rule; a registry that never answers would hang. */
const INSTALL_TIMEOUT_MS = 120_000

/** This host's name as it appears in a run's folder, with no `-` so the folder's name splits back into its parts. */
const HOST = hostname().replace(/[^A-Za-z0-9.]/g, '_')
/** A run's folder: `meocord-dual-build-<host>-<pid>-<random>`. */
const RUN_FOLDER = /^meocord-dual-build-([A-Za-z0-9._]+)-(\d+)-[A-Za-z0-9]+$/

/** Whether a process runs: one owned by another user still counts, and a reused PID only keeps a folder longer. */
function running(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

// Another host's runs may share the temporary folder, and their PIDs mean nothing here, so only this host's are judged
for (const name of readdirSync(tmpdir())) {
  const [, host, pid] = RUN_FOLDER.exec(name) ?? []
  if (host !== HOST || running(Number(pid))) continue
  try {
    rmSync(path.join(tmpdir(), name), { recursive: true, force: true })
  } catch {
    // Best-effort: an ended run's folder this user can't remove, such as another user's, is no reason to fail
  }
}
const runFolder = mkdtempSync(path.join(tmpdir(), `meocord-dual-build-${HOST}-${process.pid}-`))

const failures: string[] = []
for (const runtime of RUNTIMES) {
  for (const first of BUILDS) {
    for (const app of BUILDS) {
      for (const mode of MODES) {
        const label = `${runtime}, ${first} loaded first, app from ${app}, ${mode === 'module' ? 'testing module' : 'started bot'}`
        const result = runProbe(runtime, ['app', first, app, mode]) as { problems: string[]; stores?: number; containers?: number }
        for (const problem of result.problems) failures.push(`${label}: ${problem}`)
        if (result.problems.length === 0) console.log(`${label}: ${result.stores} shared stores, ${result.containers} containers reached`)
      }
    }
  }
}

// The ES module build on the lowest inversify package.json admits, beside the one the CommonJS build bundles: each
// release pins its own @inversifyjs/core, and the range promises every one of them works with the bundled copy
const ES_MODULE_INVERSIFY = ['inversify', '@inversifyjs']
const { dependencies } = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }
const floor = /^[\^~]?(\d+\.\d+\.\d+)$/.exec(dependencies.inversify)?.[1]
if (!floor) failures.push(`inversify's range ${dependencies.inversify} names no lowest version to run the ES module build on`)
else {
  const lowest = path.join(runFolder, 'inversify')
  try {
    mkdirSync(lowest)
    writeFileSync(path.join(lowest, 'package.json'), JSON.stringify({ private: true, dependencies: { inversify: floor } }))
    const install = spawnSync(process.execPath, ['install'], { cwd: lowest, encoding: 'utf8', timeout: INSTALL_TIMEOUT_MS })
    if ((install.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT') {
      throw new Error(`installing inversify ${floor} did not finish in ${INSTALL_TIMEOUT_MS / 1000} s`)
    }
    if (install.error) throw new Error(`installing inversify ${floor} failed: ${install.error.message}`)
    if (install.status !== 0) throw new Error(`installing inversify ${floor} failed:\n${install.stdout}${install.stderr}`)
    const root = path.join(lowest, 'root')
    mkdirSync(path.join(root, 'scripts'), { recursive: true })
    mkdirSync(path.join(root, 'node_modules'))
    cpSync(path.join(repoRoot, 'package.json'), path.join(root, 'package.json'))
    cpSync(path.join(repoRoot, PROBE), path.join(root, PROBE))
    cpSync(path.join(repoRoot, 'dist'), path.join(root, 'dist'), { recursive: true })
    // Every package as the checkout has it, except inversify's, which come from the lowest install
    for (const name of readdirSync(path.join(repoRoot, 'node_modules'))) {
      const from = ES_MODULE_INVERSIFY.includes(name) ? lowest : repoRoot
      if (!name.startsWith('.')) symlinkSync(path.join(from, 'node_modules', name), path.join(root, 'node_modules', name), 'junction')
    }
    const resolved = realpathSync(createRequire(path.join(root, 'dist', 'esm', 'core', 'index.js')).resolve('inversify'))
    const { version: found } = JSON.parse(readFileSync(path.join(lowest, 'node_modules', 'inversify', 'package.json'), 'utf8')) as { version: string }
    if (!resolved.startsWith(realpathSync(path.join(lowest, 'node_modules', 'inversify'))) || found !== floor) {
      failures.push(`the ES module build resolves inversify at ${resolved} (${found}), not the lowest install of ${floor}`)
    } else {
      for (const first of BUILDS) {
        for (const app of BUILDS) {
          for (const mode of MODES) {
            const label = `node, the ES module build on inversify ${floor}, ${first} loaded first, app from ${app}, ${mode === 'module' ? 'testing module' : 'started bot'}`
            const result = runProbe('node', ['app', first, app, mode], {}, root) as { problems: string[]; stores?: number; containers?: number }
            for (const problem of result.problems) failures.push(`${label}: ${problem}`)
            if (result.problems.length === 0) console.log(`${label}: ${result.stores} shared stores, ${result.containers} containers reached`)
          }
        }
      }
    }
  } catch (error) {
    failures.push(`the ES module build on inversify ${floor}: ${(error as Error).message}`)
  } finally {
    rmSync(lowest, { recursive: true, force: true })
  }
}

// A copy of dist whose builds say another version, beside the real one: what the builds share is keyed per version
const { version } = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as { version: string }
const VERSION_LINE = `var version = ${JSON.stringify(version)};`
const copy = path.join(runFolder, 'copy')
try {
  mkdirSync(copy)
  cpSync(path.join(repoRoot, 'dist'), path.join(copy, 'dist'), { recursive: true })
  // A junction needs no elevation on Windows, and is a plain symlink elsewhere
  symlinkSync(path.join(repoRoot, 'node_modules'), path.join(copy, 'node_modules'), 'junction')
  let rewritten = 0
  for (const file of readdirSync(path.join(copy, 'dist'), { recursive: true, encoding: 'utf8' })) {
    if (!/\.c?js$/.test(file)) continue
    const full = path.join(copy, 'dist', file)
    const text = readFileSync(full, 'utf8')
    if (!text.includes(VERSION_LINE)) continue
    writeFileSync(full, text.replaceAll(VERSION_LINE, `var version = ${JSON.stringify(`${version}-copy`)};`))
    rewritten++
  }
  if (rewritten < BUILDS.length) failures.push(`the copy of dist: found \`${VERSION_LINE}\` in ${rewritten} files, expected one per build`)
  else {
    for (const runtime of RUNTIMES) {
      for (const first of BUILDS) {
        const label = `${runtime}, a copy with another version, ${first} loaded first`
        const result = runProbe(runtime, ['versions', first, path.join(copy, 'dist')]) as { problems: string[] }
        for (const problem of result.problems) failures.push(`${label}: ${problem}`)
        if (result.problems.length === 0) console.log(`${label}: each version keeps its own classes`)
      }
    }
  }
} finally {
  rmSync(copy, { recursive: true, force: true })
}

// Under Node only: Bun's console writes past process.stdout.write and process.stderr.write, which the probe captures
for (const [name, env] of Object.entries(COLOR_ENVIRONMENTS)) {
  for (const first of BUILDS) {
    const label = `node, Logger with ${name}, ${first} loaded first`
    const result = runProbe('node', ['logger', first], env) as { captured?: Record<string, { stdout: string; stderr: string }>; problems?: string[] }
    if (!result.captured) {
      failures.push(`${label}: ${result.problems?.join('; ')}`)
      continue
    }
    if (!`${result.captured.esm.stdout}${result.captured.esm.stderr}`.includes('log line')) {
      failures.push(`${label}: the esm build's Logger wrote nothing that was captured`)
    }
    for (const stream of ['stdout', 'stderr'] as const) {
      const { esm, cjs } = { esm: result.captured.esm[stream], cjs: result.captured.cjs[stream] }
      if (esm !== cjs) failures.push(`${label}, ${stream} differs:\n  esm ${JSON.stringify(esm)}\n  cjs ${JSON.stringify(cjs)}`)
    }
  }
}

try {
  rmSync(runFolder, { recursive: true, force: true })
} catch (error) {
  // This run's own folder: reported with the rest, so the run fails without hiding what the legs found
  failures.push(`removing this run's folder ${runFolder}: ${(error as Error).message}`)
}
if (failures.length > 0) {
  console.error(`Both builds in one process disagree:\n${failures.map(failure => `- ${failure}`).join('\n')}`)
  process.exit(1)
}
console.log('Both builds run in one process, under Node and Bun, each with its own copies of its ES-module-only dependencies.')
