#!/usr/bin/env node

import path from 'path'
import { createRsbuild } from '@rsbuild/core'
import { Logger } from '@src/common/index.js'
import { spawn, ChildProcess } from 'node:child_process'
import { capitalize } from 'lodash-es'
import wait from '@src/util/wait.util.js'
import { GeneratorCLI } from '@src/bin/generator.js'
import { AppGeneratorHelper, runtimePrefixFor } from '@src/bin/helper/app-generator.helper.js'
import { makeInitialCommit } from '@src/bin/helper/initial-commit.helper.js'
import * as fs from 'node:fs'
import { compileAndValidateConfig, setEnvironment, validateDiscordToken, validateRunConfig } from '@src/util/common.util.js'
import { Command } from 'commander'
import { execSync } from 'child_process'
import * as p from '@clack/prompts'
import { detectInstalledPMs, getInstallCommand, type PackageManager } from '@src/util/package-manager.util.js'
import { configureCommandHelp, ensureReady } from '@src/util/meocord-cli.util.js'
import { resolveOwnVersion } from '@src/util/package-version.util.js'
import { buildAppCommand, resolveRuntime } from '@src/util/runtime.util.js'
import { stopRequests } from '@src/util/stop-request.util.js'
import { DEFAULT_SHUTDOWN_TIMEOUT_MS } from '@src/util/shutdown-timeout.util.js'
import { DEV_RUNNER_ENV, isDevRunnerMessage } from '@src/util/dev-runner.util.js'
import packageJson from '../../package.json' with { type: 'json' }
import { fileURLToPath } from 'url'
import {
  assertNoWebpackHook,
  createRsbuildConfig,
  optionalExternalConflicts,
  optionalExternalNames,
} from '@src/build/rsbuild-config.js'
import {
  assertNoBundledNativeAddons,
  bundledModuleFiles,
  copyPackagesInto,
  createNativeExternals,
  findBundledNativeAddons,
  installedPackages,
  type NativePackage,
} from '@src/build/native-addons.js'
import { PLATFORM_MANIFEST, writePlatformManifest } from '@src/util/platform.util.js'
import { loadMeoCordCliConfig, loadMeoCordSourceConfig } from '@src/util/meocord-source-config.util.js'
import { type MeoCordConfig } from '@src/interface/index.js'
import { FORCE_REGISTER_ENV, REGISTER_GUILD_ENV, REGISTER_ONLY_ENV } from '@src/util/registration-mode.util.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * A Command Line Interface (CLI) for managing the MeoCord application.
 */
/**
 * Oldest Node the framework supports, mirroring `engines.node`.
 *
 * A test holds the two together, since a floor that drifted from the manifest would warn
 * about versions npm is happy to install on.
 */
export const MINIMUM_NODE_MAJOR = 22

/**
 * Warns when the running Node is older than the framework supports.
 *
 * Advisory only. Comparing against the newest LTS release meant warning about being a
 * patch behind, and reaching the network to find out meant a failed request could stop
 * the command outright — for a check whose only outcome is a warning.
 */
function warnIfNodeIsBelowSupported(): void {
  const major = Number.parseInt(process.versions.node.split('.')[0], 10)

  if (Number.isFinite(major) && major < MINIMUM_NODE_MAJOR) {
    p.log.warn(
      `Node ${process.versions.node} is older than the supported minimum (v${MINIMUM_NODE_MAJOR}). ` +
        `The app will be created, but may not run.`,
    )
  }
}

/**
 * The package manager's own complaint, which `execSync` buries on the thrown object.
 *
 * Its `message` says only that a command exited non-zero, which is never the part worth
 * reading.
 */
function installFailure(error: unknown): Error {
  const { stderr, message } = (error ?? {}) as { stderr?: Buffer | string; message?: string }
  const reported = stderr?.toString().trim()

  return new Error(reported || message || String(error))
}

/**
 * Whether a child is still running. `killed` says only that a signal was sent, and stays false for a
 * child that exited on its own, such as an application that failed at startup.
 */
export function stillRunning(child: ChildProcess | null): child is ChildProcess {
  return child !== null && child.exitCode === null && child.signalCode === null
}

/** How long the application has to stop itself on a repeated signal before the CLI kills it. */
export const FORCE_STOP_GRACE_MS = 2_000

export class MeoCordCLI {
  private readonly appName = 'MeoCord'
  readonly logger = new Logger(this.appName)
  private readonly projectRoot = process.cwd()
  private readonly mainJSPath = path.join(this.projectRoot, 'dist', 'main.js')
  private readonly generatorCLI = new GeneratorCLI(this.appName)
  private readonly appGeneratorHelper = new AppGeneratorHelper()
  private readonly version = resolveOwnVersion(__dirname, packageJson.version)

  /**
   * Binary the application is spawned with, so it runs on the same runtime as the CLI
   * rather than on whichever one happens to be named in the source.
   */
  private readonly runtime = resolveRuntime(process.env, process.execPath)

  /**
   * Configures and runs the MeoCord CLI.
   */
  async run() {
    this.program().showHelpAfterError().parse(process.argv)
  }

  /**
   * The CLI's commands, options and arguments, configured but not parsed: what `run` parses, and what the build
   * describes in `dist/cli.json`, so the two cannot differ.
   */
  program(): Command {
    let program = new Command()

    program
      .name(this.appName.toLowerCase())
      .description(`CLI for managing the ${this.appName} application`)
      .version(this.version)

    program
      .command('show')
      .description('Display information')
      .option('-w, --warranty', 'Display warranty disclaimer')
      .option('-c, --license', 'Display license')
      .action(options => {
        if (!options.warranty && !options.license) {
          const show = `${program.name()} show`
          console.error(`Say what to show: \`${show} --license\` for the license, or \`${show} --warranty\` for the warranty disclaimer.`)
          process.exit(1)
        }
        if (options.warranty) {
          console.log(`
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
      `)
        }
        if (options.license) {
          console.log(`
MIT License

Copyright (c) 2025-present Ukasyah Rahmatullah Zada

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
      `)
        }
      })

    program
      .command('create')
      .description('Create a new MeoCord application')
      .argument('<app-name>', 'Name of the application and of the directory it is created in, such as my-bot')
      .option('--use-npm', 'Use npm as the package manager')
      .option('--use-yarn', 'Use Yarn as the package manager')
      .option('--use-pnpm', 'Use pnpm as the package manager')
      .option('--use-bun', 'Use Bun as the package manager')
      .action(async (appName, options) => await this.createApp(appName, options))

    program
      .command('build')
      .description('Build the application')
      .option('-d, --dev', 'Build in development mode')
      .option('-p, --prod', 'Build in production mode')
      .action(async options => {
        await ensureReady()

        const mode = options.prod ? 'production' : 'development'
        setEnvironment(mode)

        await compileAndValidateConfig()

        await this.build(mode)
        await this.compileConfig()
      })

    program
      .command('start')
      .description('Start the application')
      .option('-b, --build', 'Pre-build before starting')
      .option('-d, --dev', 'Start in development mode')
      .option('-p, --prod', 'Start in production mode')
      .option('--force-register', 'Register commands even when unchanged since the last development start')
      .action(async options => {
        await ensureReady()

        if (options.forceRegister) this.appEnv[FORCE_REGISTER_ENV] = '1'

        const mode = options.prod ? 'production' : 'development'
        setEnvironment(mode)

        if (options.build || !options.prod) {
          await compileAndValidateConfig()
        } else {
          // The compiled config, when there is one, is what the bot will run with
          await validateRunConfig()
        }

        // Checked for every start, including one that skips the build: this is the point
        // where the application actually needs to log in.
        await validateDiscordToken()

        // Watch mode builds as it starts, so --build would only build twice.
        if (options.build && options.prod) {
          await this.build(mode)
          await this.compileConfig()
        }

        options.prod ? await this.startProd() : await this.startDev()
      })

    program
      .command('register')
      .description('Register the application commands with Discord, without starting the bot')
      .option('-b, --build', 'Build before registering')
      .option('-d, --dev', 'Register as development does, to commands.developmentGuild')
      .option('-g, --guild <id>', 'Register every command to this guild only')
      .action(async options => {
        await ensureReady()

        const mode = options.dev ? 'development' : 'production'
        setEnvironment(mode)

        await compileAndValidateConfig()
        await validateDiscordToken()

        if (options.build) {
          await this.build(mode)
          await this.compileConfig()
        }

        await this.register(options.guild)
      })

    program = this.generatorCLI.register(program)

    configureCommandHelp(program)

    return program
  }

  async createApp(
    appName: string,
    options: { useNpm?: boolean; useYarn?: boolean; usePnpm?: boolean; useBun?: boolean },
  ) {
    const kebabCaseAppName = appName
      .replace(/([a-z])([A-Z])/g, '$1-$2')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')

    const appPath = path.resolve(process.cwd(), kebabCaseAppName)

    p.intro(`meocord v${this.version}`)

    // A name of only symbols would resolve to the current directory itself.
    if (!kebabCaseAppName) {
      p.cancel(`"${appName}" needs a name with letters or digits, such as my-bot: it names the app's directory.`)
      await wait(100)
      process.exit(1)
    }

    // Validate directory
    if (fs.existsSync(appPath)) {
      p.cancel(`Directory "${kebabCaseAppName}" already exists.`)
      await wait(100)
      process.exit(1)
    }

    warnIfNodeIsBelowSupported()

    // Determine package manager
    const installedPMs = detectInstalledPMs()
    let pm: PackageManager

    const flagMap: Record<string, PackageManager> = {
      useNpm: 'npm',
      useYarn: 'yarn',
      usePnpm: 'pnpm',
      useBun: 'bun',
    }

    const selectedFlag = Object.entries(flagMap).find(([key]) => options[key as keyof typeof options])

    if (selectedFlag) {
      pm = selectedFlag[1]
      if (!installedPMs.includes(pm)) {
        p.cancel(`${pm} is not installed.`)
        await wait(100)
        process.exit(1)
      }
    } else {
      const defaultPM = installedPMs.includes('bun') ? 'bun' : 'npm'
      const selected = await p.select<PackageManager>({
        message: 'Which package manager do you want to use?',
        options: installedPMs.map(name => ({
          value: name,
          label: name,
          hint: name === defaultPM ? 'default' : undefined,
        })),
        initialValue: defaultPM,
      })

      // `select` types its cancel sentinel as plain `symbol`, while `isCancel` narrows only
      // that sentinel's own `unique symbol` — so the guard leaves `symbol` in its false
      // branch and `pm` stops being a PackageManager. The prompt returns a symbol in no
      // other case, so the cancel is detected on that instead.
      if (typeof selected === 'symbol') {
        p.cancel('Operation cancelled.')
        process.exit(0)
      }

      pm = selected
    }

    const s = p.spinner()

    s.start(`Creating a new MeoCord app: ${kebabCaseAppName}`)
    try {
      this.appGeneratorHelper.generateApp(appPath, {
        appName: kebabCaseAppName,
        displayName: appName,
        version: this.version,
        packageManager: pm,
        runtimePrefix: runtimePrefixFor(pm),
      })
    } catch (error) {
      s.stop('Failed to create the app.')
      await this.abortCreate(appPath, error)
    }
    s.stop(`App created at: ${appPath}`)

    s.start(`Installing dependencies with ${pm}...`)
    try {
      // Output is captured rather than discarded: a failed install is only actionable
      // if the resolver's complaint survives to the error message.
      execSync(getInstallCommand(pm), { cwd: appPath, stdio: 'pipe' })
    } catch (error) {
      s.stop('Failed to install dependencies.')
      await this.abortCreate(appPath, installFailure(error))
    }
    s.stop('Dependencies installed.')

    // After the install, so the lockfile is in the first commit. A git failure leaves the app as it is: it is ready
    s.start('Making the first commit...')
    const commit = await makeInitialCommit(appPath)
    switch (commit.outcome) {
      case 'committed':
        s.stop('Git repository initialized with the first commit.')
        break
      case 'inside-repository':
        s.stop("Inside an existing Git repository, so no new one was made; the app's files are left for you to commit.")
        break
      case 'not-committed':
        s.stop(`Git repository initialized, but the first commit failed: ${commit.reason}`)
        p.log.warn(
          `Fix what git said, such as setting user.name and user.email, then run:\n  cd ${kebabCaseAppName} && git add -A && git commit -m "Initial commit"`,
        )
        break
      case 'no-repository':
        s.stop(`Skipped the Git repository: ${commit.reason}`)
        p.log.warn(
          `The app is ready without one. To add it later, run:\n  cd ${kebabCaseAppName} && git init && git add -A && git commit -m "Initial commit"`,
        )
        break
    }

    p.outro(`MeoCord app "${kebabCaseAppName}" is ready!`)
  }

  /**
   * Builds the bundler configuration for this project and creates an Rsbuild instance.
   *
   * The base configuration comes from {@link createRsbuildConfig}; the application's
   * `rsbuild` hook, if it declares one, is given the chance to modify it.
   */
  private async createBundler(mode: 'production' | 'development') {
    // Read from source on every build: the compiled copy in dist is the previous build's.
    const meocordConfig = loadMeoCordSourceConfig()

    assertNoWebpackHook(meocordConfig)

    const base = createRsbuildConfig({
      mode,
      bundleDependencies: meocordConfig?.bundleDependencies,
      externals: meocordConfig?.externals,
      optionalExternals: meocordConfig?.optionalExternals,
    })
    for (const name of optionalExternalConflicts(meocordConfig?.optionalExternals, meocordConfig?.externals)) {
      this.logger.warn(
        `"${name}" is in both optionalExternals and externals. In externals it becomes an import that runs ` +
          `before the bot's code and fails when the package is missing; remove it from externals.`,
      )
    }
    const config = meocordConfig?.rsbuild?.(base) ?? base

    // A native addon cannot be inlined into JavaScript, so when bundling, each one is kept out of
    // the bundle as the bundler meets it and recorded for build() to copy into dist. Added after
    // the application's hook, so a hook that sets externals of its own does not drop it.
    const natives = meocordConfig?.bundleDependencies ? createNativeExternals(this.projectRoot) : undefined
    if (natives) {
      config.output ??= {}
      const existing = config.output.externals
      config.output.externals = [
        ...(Array.isArray(existing) ? existing : existing ? [existing] : []),
        natives.externals,
      ]
    }

    const rsbuild = await createRsbuild({ cwd: this.projectRoot, config })
    return { rsbuild, meocordConfig, natives }
  }

  /**
   * Makes a bundled build's dist runnable on its own: copies every package the bundle still
   * imports -- the native addons found while building, anything listed in `externals`, and the
   * optional externals, discord.js's accelerators included, if they are installed -- into `dist/node_modules`, and
   * marks dist as ESM. Deploying is then copying dist, with no install step.
   */
  private packDependencies(meocordConfig: MeoCordConfig, natives: Map<string, NativePackage>) {
    const dist = path.join(this.projectRoot, 'dist')
    const packages = new Map<string, string>([...natives].map(([name, { dir }]) => [name, dir]))
    const nativeNames = new Set(natives.keys())

    const listed = (meocordConfig.externals ?? []).filter((item): item is string => typeof item === 'string')
    const wanted = [...listed, ...optionalExternalNames(meocordConfig.optionalExternals)].filter(name => !packages.has(name))
    for (const { name, dir, native } of installedPackages(wanted, this.projectRoot)) {
      packages.set(name, dir)
      if (native) nativeNames.add(name)
    }

    // Replaced rather than merged, so a package dropped from the application does not linger.
    fs.rmSync(path.join(dist, 'node_modules'), { recursive: true, force: true })
    const copied = copyPackagesInto(packages, this.projectRoot, dist)
    fs.writeFileSync(path.join(dist, 'package.json'), `${JSON.stringify({ type: 'module' }, null, 2)}\n`)

    if (nativeNames.size > 0) {
      writePlatformManifest(dist)
      this.logger.info(`Native addons packed into dist: ${[...nativeNames].join(', ')}`)
    } else {
      fs.rmSync(path.join(dist, PLATFORM_MANIFEST), { force: true })
    }
    if (copied.length > 0) this.logger.info(`dist/node_modules holds ${copied.length} packages; nothing else to install.`)
  }

  /** Builds the application in the given mode. */
  async build(mode: 'production' | 'development') {
    try {
      this.logger.info(`Building ${mode} version...`)

      const { rsbuild, meocordConfig, natives } = await this.createBundler(mode)

      const bundledFiles: string[] = []
      if (meocordConfig?.bundleDependencies) {
        rsbuild.onAfterBuild(({ stats }) => {
          bundledFiles.push(...bundledModuleFiles(stats))
        })
      }
      await rsbuild.build()

      if (meocordConfig?.bundleDependencies && natives) {
        // A safety net behind the externals function: a native addon that still reached the
        // bundle would run on this machine -- through its node_modules -- and fail in production.
        assertNoBundledNativeAddons(findBundledNativeAddons(bundledFiles, this.projectRoot))
        this.packDependencies(meocordConfig, natives.found)
      }

      this.logger.info(`${capitalize(mode)} build completed successfully.`)
    } catch (error: any) {
      this.logger.error(`Build process failed: ${error.message}`)
      await wait(100)
      process.exit(1)
    }
  }

  /**
   * Compiles meocord.config.ts to dist/meocord.config.mjs so the config
   * can be loaded at runtime without jiti, tsconfig, or source files.
   *
   * @param options.exitOnFailure - Exits 1 when it fails; a watch session reloading the config keeps running instead.
   * @returns Whether the config compiled, or there was none to compile.
   */
  async compileConfig({ exitOnFailure = true } = {}): Promise<boolean> {
    const configPath = path.resolve(this.projectRoot, 'meocord.config.ts')
    if (!fs.existsSync(configPath)) return true

    // Compiled beside dist and moved in only once it built, so a failed compile leaves the last good one.
    // Each compile stages in a folder of its own, so two at once, such as the watcher's and a build's, never collide.
    const dist = path.resolve(this.projectRoot, 'dist')
    let staging: string | undefined
    try {
      // Built without the application's `rsbuild` hook, since this file declares that hook. It follows
      // `bundleDependencies`, because the config imports packages (dotenv) a bundled bot has no copy of.
      const meocordConfig = loadMeoCordSourceConfig()
      const bundleDependencies = meocordConfig?.bundleDependencies ?? false
      const base = createRsbuildConfig({
        mode: 'development',
        entry: configPath,
        bundleDependencies,
        externals: meocordConfig?.externals,
      })
      fs.mkdirSync(dist, { recursive: true })
      staging = fs.mkdtempSync(path.join(dist, '.meocord-config-'))
      const rsbuild = await createRsbuild({
        cwd: this.projectRoot,
        config: {
          ...base,
          source: { ...base.source, entry: { 'meocord.config': configPath } },
          output: {
            ...base.output,
            distPath: { root: staging, js: '' },
            filename: { js: '[name].mjs' },
            minify: { js: false },
            sourceMap: false,
            // Runs beside the application build in the same dist; cleaning would delete it.
            cleanDistPath: false,
          },
          // Its table would name the staging folder; the line after the build says where the config went
          performance: { ...base.performance, printFileSize: false },
        },
      })

      await rsbuild.build()
      fs.renameSync(path.join(staging, 'meocord.config.mjs'), path.join(dist, 'meocord.config.mjs'))
      fs.rmSync(staging, { recursive: true, force: true })
      this.logger.info('Config compiled to dist/meocord.config.mjs')
      return true
    } catch (error) {
      if (staging) fs.rmSync(staging, { recursive: true, force: true })
      this.logger.error(`Failed to compile meocord.config.ts: ${error instanceof Error ? error.message : error}`)
      // The built application reads only the compiled config, so without it the bot cannot start
      if (exitOnFailure) {
        await wait(100)
        process.exit(1)
      }
      return false
    }
  }

  /** Environment added to the application's own when it is spawned. */
  private readonly appEnv: NodeJS.ProcessEnv = {}

  /**
   * Runs the built application in register-only mode: it collects the commands from the bundle, sends
   * them over REST and exits, without logging in. Exits with the application's code.
   */
  async register(guild?: string) {
    if (!fs.existsSync(this.mainJSPath)) {
      this.logger.error('Main entry file (main.js) not found! Build first, or run `meocord register --build`.')
      await wait(100)
      process.exit(1)
      return
    }

    this.appEnv[REGISTER_ONLY_ENV] = '1'
    this.appEnv[FORCE_REGISTER_ENV] = '1'
    if (guild) this.appEnv[REGISTER_GUILD_ENV] = guild

    const child = this.spawnApp().on('exit', code => process.exit(code ?? 1))
    this.relayStopSignals(() => child)
  }

  /**
   * Passes SIGINT and SIGTERM on to the application: sent to the CLI alone, as Docker, pm2 and systemd
   * send them, they would otherwise stop the CLI and leave the bot running. A copy within
   * `REPEAT_SIGNAL_WINDOW_MS` is the same request. A repeat after it is passed on too, for the application
   * to stop at once; if it has not after `FORCE_STOP_GRACE_MS`, it is killed and the CLI exits 1.
   *
   * @param stopping - Runs on the first request, before the signal is passed on.
   */
  private relayStopSignals(app: () => ChildProcess | null, stopping?: () => void): void {
    const request = stopRequests()
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.on(signal, () => {
        const kind = request()
        if (kind === 'duplicate') return
        if (kind === 'first') stopping?.()

        const child = app()
        if (!stillRunning(child)) {
          if (kind === 'repeat') process.exit(1)
          return
        }
        // On Windows, kill() ends a process outright, and Ctrl+C reaches the application through the console
        if (process.platform !== 'win32') child.kill(signal)
        if (kind === 'repeat') {
          setTimeout(() => {
            if (stillRunning(child)) child.kill('SIGKILL')
            process.exit(1)
          }, FORCE_STOP_GRACE_MS).unref()
        }
      })
    }
  }

  /** The running application, while a watch session owns one, including while it exits to be replaced. */
  private appProcess: ChildProcess | null = null

  /** Whether the running application is exiting to be replaced; a build that finishes meanwhile joins that restart. */
  private restarting = false

  /** Whether a watch session is stopping, when a rebuild must not start the application again. */
  private stopping = false

  /** Ends a watch session with an exit code; `startDev` also closes its watchers first. */
  private endDevSession: (code: number) => void = code => process.exit(code)

  /**
   * Replaces the running application with one built from the current sources.
   *
   * The replacement is spawned only once the previous process has exited. Both would
   * hold the same gateway session, and claiming it before the first lets go produces a
   * login conflict rather than a reload. Builds that finish while it exits start nothing
   * more: the replacement runs `dist/main.js` as it stands at launch, the latest build.
   */
  private restartApp(): void {
    if (this.stopping || this.restarting) return
    const previous = this.appProcess

    if (!stillRunning(previous)) {
      this.launchDevApp()
      return
    }

    // The application gives up on its onShutdown hooks after shutdownTimeout; one still running after that and a
    // grace period would hold the restart forever, so it is killed
    const shutdownTimeout = loadMeoCordCliConfig()?.shutdownTimeout ?? DEFAULT_SHUTDOWN_TIMEOUT_MS
    const overdue = setTimeout(() => {
      if (!stillRunning(previous)) return
      this.logger.warn(
        `The application did not exit within ${shutdownTimeout + FORCE_STOP_GRACE_MS} ms of being asked to stop, ` +
          `its shutdownTimeout of ${shutdownTimeout} ms and ${FORCE_STOP_GRACE_MS} ms more; killing it to start the new build.`,
      )
      previous.kill('SIGKILL')
    }, shutdownTimeout + FORCE_STOP_GRACE_MS)
    overdue.unref()

    this.restarting = true
    previous.removeAllListeners('exit')
    previous.once('exit', () => {
      clearTimeout(overdue)
      this.restarting = false
      this.appProcess = null
      if (!this.stopping) this.launchDevApp()
    })
    previous.kill()
  }

  /**
   * Runs the application for a watch session, as the one `appProcess` tracks. After it exits on its own, the session
   * keeps watching, and the next change starts it again; a failed login is fixed in the code or in `.env`, and both
   * are watched.
   */
  private launchDevApp(): void {
    const child = this.spawnApp({ devRunner: true })
    this.appProcess = child
    let loginFailed = false
    child.on('message', message => {
      if (isDevRunnerMessage(message)) loginFailed = message.meocord === 'login-failed'
    })
    child.once('exit', (code, signal) => {
      // An exit the session asked for, to restart or to stop, is not the application's own
      if (this.appProcess !== child || this.stopping) return
      if (loginFailed) {
        this.logger.error('The bot could not log in; watch mode starts it again on the next change, in src or .env.')
        return
      }
      this.logger.warn(`The application exited with ${code === null ? signal : `code ${code}`}; waiting for changes.`)
    })
  }

  /**
   * Runs the built application. Both start modes use it, so watch mode launches the bundle exactly as production does.
   *
   * @param options.devRunner - Gives the application a channel to tell watch mode whether the bot could log in.
   */
  private spawnApp({ devRunner = false } = {}): ChildProcess {
    const sourceMaps = loadMeoCordCliConfig()?.sourceMappedStacks !== false
    const { command, args } = buildAppCommand(this.runtime, this.mainJSPath, { sourceMaps })

    return spawn(command, args, {
      cwd: this.projectRoot,
      env: { ...process.env, ...this.appEnv, ...(devRunner && { [DEV_RUNNER_ENV]: '1' }) },
      stdio: devRunner ? ['inherit', 'inherit', 'inherit', 'ipc'] : 'inherit',
    })
  }

  /**
   * Starts the MeoCord application in development mode with live updates.
   */
  async startDev() {
    try {
      this.clearScreen()
      this.logger.log('Starting watch mode...')
      await this.compileConfig()
      let isRunning = false
      let watching: { close: () => Promise<void> } | undefined

      const watch = async () => {
        const { rsbuild } = await this.createBundler('development')

        // Runs after every rebuild, which is where the application is restarted. A failed
        // rebuild reports its own errors and does not reach here, so the process already
        // running is left alone rather than being replaced by a broken build.
        rsbuild.onAfterBuild(() => {
          this.restartApp()
          isRunning = true
        })

        watching = await rsbuild.build({ watch: true })
      }
      await watch()

      // Inputs the bundler does not see: the config, and tsconfig.json, which the build reads through a copy MeoCord
      // writes and the bundler never watches. A change rebuilds from them, and the rebuild restarts the application.
      // .env needs no build: the bot reads it as it starts, so a change restarts it.
      const reloads: Record<string, string> = {
        'meocord.config.ts': 'MeoCord config change detected, reloading config...',
        'tsconfig.json': 'tsconfig.json change detected, rebuilding...',
        '.env': '.env change detected, restarting...',
      }
      const rebuilds = (files: Set<string>) => [...files].some(file => file !== '.env')
      let debounceWatcher: NodeJS.Timeout
      let changed = new Set<string>()

      // The folder rather than the files, so an editor that saves by replacing a file is still seen
      const fsWatcher = fs.watch(this.projectRoot, (_event, filename) => {
        if (!filename || !Object.hasOwn(reloads, filename)) return
        changed.add(filename)
        clearTimeout(debounceWatcher)
        debounceWatcher = setTimeout(async () => {
          if (!isRunning) return
          const files = changed
          changed = new Set()
          for (const file of files) this.logger.log(reloads[file])
          if (!rebuilds(files)) return this.restartApp()
          // A config that doesn't compile, say mid-edit, leaves the running bot and its build as they are
          if (files.has('meocord.config.ts') && !(await this.compileConfig({ exitOnFailure: false }))) return
          isRunning = false
          await watching?.close()
          await watch()
        }, 300)
      })

      const stopWatching = () => {
        this.stopping = true
        clearTimeout(debounceWatcher)
        fsWatcher.close()
      }
      const finish = async (code: number | null) => {
        await watching?.close()
        process.exit(code ?? 0)
      }
      this.endDevSession = code => {
        stopWatching()
        void finish(code)
      }

      this.relayStopSignals(
        () => this.appProcess,
        () => {
          stopWatching()
          const app = this.appProcess
          if (stillRunning(app)) app.on('exit', code => void finish(code))
          else void finish(0)
        },
      )
    } catch (error: any) {
      this.logger.error(`Failed to start: ${error.message}`)
      // The session ends with 1, as a failed build does, and stops a bot it started, which would outlive it
      this.stopping = true
      this.appProcess?.kill()
      this.endDevSession(1)
    }
  }

  /**
   * Starts the MeoCord application in production mode.
   */
  async startProd() {
    try {
      // Check if mainJS exists before proceeding
      if (!fs.existsSync(this.mainJSPath)) {
        this.logger.error(
          `Main entry file (main.js) not found! You might need to build before running in production mode.`,
        )
        await wait(100)
        process.exit(1)
      }

      this.logger.log('Starting...')

      const start = this.spawnApp()

      start.on('exit', code => {
        process.exit(code ?? 0)
      })
      this.relayStopSignals(() => start)
    } catch (error) {
      this.logger.error('Failed to start:', error instanceof Error ? error.message : String(error))
      await wait(100)
      process.exit(1)
    }
  }

  /**
   * Reports why creation failed and removes what was written.
   *
   * A directory left behind from a failed attempt is indistinguishable from one the user
   * meant to keep, and the next attempt refuses to start because the name is taken.
   */
  private async abortCreate(appPath: string, error: unknown): Promise<never> {
    fs.rmSync(appPath, { recursive: true, force: true })
    p.cancel(error instanceof Error ? error.message : String(error))
    await wait(100)
    process.exit(1)
  }

  /**
   * Clears the screen as watch mode starts, in a terminal only: a log file, CI or a process manager gets no escape
   * codes. The scrollback stays, so the output of earlier commands, such as a failing test run, can still be read.
   */
  private clearScreen() {
    if (process.stdout.isTTY) process.stdout.write('\u001b[2J\u001b[H')
  }
}

/**
 * Whether this file is what the process was started with. `argv[1]` is the `node_modules/.bin`
 * symlink while `import.meta.url` is its target, so both are resolved first; anything undecidable
 * counts as a launch, so the CLI still starts.
 */
function isProcessEntry(): boolean {
  const invoked = process.argv[1]
  if (invoked === undefined) return true

  try {
    return samePath(fs.realpathSync(invoked), __filename)
  } catch {
    return true
  }
}

/**
 * Whether two resolved paths name the same file, ignoring case and separators on Windows, where
 * npm's shim passes the script path in whatever form it recorded.
 */
function samePath(left: string, right: string): boolean {
  const normalise = (value: string) => (process.platform === 'win32' ? path.resolve(value).toLowerCase() : value)

  return normalise(left) === normalise(right)
}

// Importing this module must not launch the command parser: its own tests do exactly
// that to inspect how the application is spawned.
if (isProcessEntry()) {
  const cli = new MeoCordCLI()
  cli.run().catch(async error => {
    cli.logger.error('Failed to initialize CLI:', error?.message || error)
    await wait(100)
    process.exit(1)
  })
}
