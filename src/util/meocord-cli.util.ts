import { Argument, Command, Help, Option } from 'commander'
import CliTable3 from 'cli-table3'
import { findModulePackageDir } from '@src/util/common.util.js'
import path from 'node:path'
import fs from 'node:fs'
import wait from '@src/util/wait.util.js'
import chalk from 'chalk'

export function configureCommandHelp(command: Command) {
  command.configureHelp({
    formatHelp: (cmd, helper) => {
      return formatHelp(cmd, helper, command.options)
    },
  })

  command.commands.forEach(cmd => {
    configureCommandHelp(cmd)
  })
}

/** Formats a command's help output, with its options and arguments as tables. */
export function formatHelp(cmd: Command, helper: Help, options: readonly Option[]): string {
  let helpText = `MeoCord Copyright (c) 2025-present Ukasyah Rahmatullah Zada — MIT License\n\n`

  helpText += `${helper.commandUsage(cmd)}\n\n`
  helpText += `${helper.commandDescription(cmd)}\n\n`

  if (cmd.registeredArguments.length > 0) {
    helpText += generateArgumentsTable(cmd.registeredArguments)
    helpText += '\n\n'
  }

  if (options.length > 0) {
    helpText += 'Available Options:\n'
    helpText += generateOptionsTable(options, helper)
    helpText += '\n\n'
  }

  if (cmd.commands.length > 0) {
    helpText += 'Available Commands:\n'
    helpText += generateCommandsTable(cmd)
    helpText += '\n'
  }

  return helpText
}

/** Renders a command's subcommands, with their aliases and descriptions, as a table. */
export function generateCommandsTable(cmd: Command): string {
  const table = new CliTable3({
    head: ['Command', 'Alias', 'Description'],
  })

  cmd.commands.forEach(cmd => {
    const alias = cmd.aliases().length > 0 ? cmd.aliases().join(', ') : '—'
    const description = cmd.description() || 'No description provided'
    table.push([cmd.name(), alias, description])
  })

  return table.toString()
}

/** Renders a command's options, with their descriptions, as a table. */
export function generateOptionsTable(options: readonly Option[], helper: Help): string {
  const table = new CliTable3({
    head: ['Option', 'Description'],
  })

  options.forEach(option => table.push([helper.optionTerm(option), helper.optionDescription(option)]))

  return table.toString()
}

/** Renders a command's arguments as a table, after a table of choices when an argument has them. */
export function generateArgumentsTable(args: readonly Argument[]): string {
  const table = new CliTable3({
    head: ['Argument', 'Description'],
  })

  const choiceTable = new CliTable3({
    head: ['Choice'],
  })

  let hasChoices = false

  args.forEach(arg => {
    if (arg.argChoices) {
      hasChoices = true
      arg.argChoices.forEach(choice => {
        choiceTable.push([choice])
      })
    }
    table.push([arg.name(), arg.description || 'No description provided'])
  })

  let text = ''

  if (hasChoices) {
    text += 'Available Choices:\n'
    text += choiceTable.toString()
    text += '\n\n'
  }

  text += 'Available Arguments:\n'
  text += table.toString()

  return text
}

/**
 * Exits unless the CLI runs from a project root: package.json is there, the meocord package is installed, and the
 * project's `dependencies` list it.
 */
export async function ensureReady() {
  const meocordPath = findModulePackageDir('meocord')
  const packageJsonPath = path.resolve(process.cwd(), 'package.json')

  try {
    // Ensure the root package.json exists
    if (!fs.existsSync(packageJsonPath)) {
      throw new Error('package.json not found. This script must be run from the root directory of the project.')
    }

    // Ensure the MeoCord package directory is found
    if (!meocordPath) {
      throw new Error('Cannot locate the "MeoCord" package directory.')
    }

    // Read and parse the root package.json
    const { dependencies } = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))

    // Read and parse the MeoCord package.json
    const internalPackageJsonPath = path.join(meocordPath, 'package.json')
    const { name: internalPackageName } = JSON.parse(fs.readFileSync(internalPackageJsonPath, 'utf-8'))

    // Validate that MeoCord is listed as a dependency in the root package.json
    if (!dependencies?.[internalPackageName]) {
      throw new Error('The package.json does not list "MeoCord" as a dependency. Ensure you are in the root directory.')
    }
  } catch (error) {
    // Log the error and exit the process
    console.error(chalk.red(error instanceof Error ? error.message : 'An unknown error occurred during validation.'))
    await wait(100)
    process.exit(1)
  }
}
