import fs from 'fs'
import path from 'path'
import { readMeoCordSourceConfig } from '@src/util/meocord-source-config.util.js'
import { compiledConfigMessage, compiledConfigProblem, loadMeoCordConfig } from '@src/util/meocord-config-loader.util.js'
import { configProblems } from '@src/util/meocord-config-validation.util.js'
import wait from '@src/util/wait.util.js'
import chalk from 'chalk'
import { type MeoCordConfig } from '@src/interface/index.js'

/**
 * The directory of an installed package, searching `node_modules` from `baseDir` up to the filesystem root's, or
 * null, logging that it was not found.
 */
export const findModulePackageDir = (moduleName: string, baseDir: string = process.cwd()): string | null => {
  for (let dir = path.resolve(baseDir); ; dir = path.dirname(dir)) {
    const modulePath = path.join(dir, 'node_modules', moduleName)
    if (fs.existsSync(modulePath)) return modulePath
    if (dir === path.dirname(dir)) break
  }
  console.error(chalk.red(`Error finding package directory for ${moduleName}: Module ${moduleName} not found in node_modules.`))
  return null
}

/**
 * Loads `meocord.config.ts` and checks its shape, exiting when it is missing, fails to load, or has
 * options of the wrong type; options it does not know are reported and left alone.
 *
 * @returns The config, which a build compiles and the bot then runs with.
 */
export async function compileAndValidateConfig(): Promise<MeoCordConfig | undefined> {
  const meocordConfigPath = path.resolve(process.cwd(), 'meocord.config.ts')
  if (!fs.existsSync(meocordConfigPath)) {
    console.error(chalk.red('Configuration file "meocord.config.ts" is missing!'))
    await wait(100)
    process.exit(1)
    return
  }

  const loaded = readMeoCordSourceConfig()
  if ('error' in loaded) {
    console.error(chalk.red(`meocord.config.ts could not be loaded, so nothing was built or started:\n  ${loaded.error}`))
    await wait(100)
    process.exit(1)
    return
  }

  await assertConfigShape(loaded.config)
  return loaded.config
}

/**
 * Checks the configuration a command that skips the build runs with: the compiled config when a build
 * made one, else `meocord.config.ts`, reported as {@link compileAndValidateConfig} reports it.
 *
 * @returns The config the bot will run with.
 */
export async function validateRunConfig(): Promise<MeoCordConfig | undefined> {
  const compiled = loadMeoCordConfig()
  if (compiled) {
    await assertConfigShape(compiled)
    return compiled
  }
  // Only a missing one falls back: a broken one is what the bot would run, so it stops here as the bot would
  if (compiledConfigProblem()?.missing === false) {
    console.error(chalk.red(compiledConfigMessage()))
    await wait(100)
    process.exit(1)
    return
  }
  return compileAndValidateConfig()
}

/** Exits with every problem when a configuration has options of the wrong type, and warns about unknown ones. */
export async function assertConfigShape(config: unknown) {
  const { errors, warnings } = configProblems(config)
  for (const warning of warnings) console.warn(chalk.yellow(`meocord.config.ts: ${warning}`))
  if (errors.length === 0) return

  console.error(chalk.red(`meocord.config.ts has ${errors.length} problem(s):\n${errors.map(error => `  - ${error}`).join('\n')}`))
  await wait(100)
  process.exit(1)
}

/**
 * Exits unless the config {@link compileAndValidateConfig} or {@link validateRunConfig} returned has a Discord token.
 * Starting or registering needs one and building does not, so a new app builds before it has a token.
 */
export async function validateDiscordToken(config: MeoCordConfig | undefined) {
  if (!config?.discordToken) {
    console.error(
      chalk.red(
        'Discord token is missing: meocord.config.ts sets discordToken, and a new app reads it from DISCORD_TOKEN in .env.',
      ),
    )
    await wait(100)
    process.exit(1)
  }
}

/** Sets `NODE_ENV` to `mode` unless it is already set. */
export function setEnvironment(mode: 'production' | 'development') {
  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = mode
  }
}
