import fs from 'fs'
import path from 'path'
import { loadMeoCordCliConfig, readMeoCordSourceConfig } from '@src/util/meocord-source-config.util.js'
import { compiledConfigMessage, compiledConfigProblem, loadMeoCordConfig } from '@src/util/meocord-config-loader.util.js'
import { configProblems } from '@src/util/meocord-config-validation.util.js'
import wait from '@src/util/wait.util.js'
import chalk from 'chalk'

/** The directory of an installed package, searching `node_modules` upward from `baseDir`, or null. */
export const findModulePackageDir = (moduleName: string, baseDir: string = process.cwd()): string | null => {
  try {
    // Resolve the node_modules directory from the base directory
    let currentDir = baseDir

    // Traverse the node_modules directories upwards until the package is found
    while (currentDir !== path.parse(currentDir).root) {
      const modulePath = path.join(currentDir, 'node_modules', moduleName)

      if (fs.existsSync(modulePath)) {
        return modulePath // Return the full path to the module directory
      }

      // Move up one level in the directory structure
      currentDir = path.join(currentDir, '..')
    }

    throw new Error(`Module ${moduleName} not found in node_modules.`)
  } catch (error) {
    if (error instanceof Error) {
      console.error(chalk.red(`Error finding package directory for ${moduleName}:`, error.message))
    } else {
      console.error(chalk.red(`Error finding package directory for ${moduleName}:`, error))
    }
    return null
  }
}

/**
 * Loads `meocord.config.ts` and checks its shape, exiting when it is missing, fails to load, or has
 * options of the wrong type; options it does not know are reported and left alone.
 */
export async function compileAndValidateConfig() {
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
}

/**
 * Checks the configuration a start that skips the build runs with: the compiled config when a build
 * made one, else `meocord.config.ts`, reported as {@link compileAndValidateConfig} reports it.
 */
export async function validateRunConfig() {
  const compiled = loadMeoCordConfig()
  if (compiled) return assertConfigShape(compiled)
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
 * Ensures a Discord token is configured.
 *
 * Kept apart from {@link compileAndValidateConfig} because producing a bundle needs no
 * credentials — only connecting to the gateway does. Requiring one to build would stop a
 * freshly created application from building until it has a token.
 */
export async function validateDiscordToken() {
  if (!loadMeoCordCliConfig()?.discordToken) {
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
