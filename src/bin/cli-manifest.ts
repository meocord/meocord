import type { EventEmitter } from 'node:events'
import { type Argument, type Command, Help, type Option } from 'commander'

/** The shape's version: raised only when a change to it would break a reader. */
export const CLI_MANIFEST_SCHEMA_VERSION = 1

/** One positional argument, in the order the command takes them. */
export interface CliManifestArgument {
  name: string
  description: string | null
  required: boolean
  variadic: boolean
  default: unknown
  defaultDescription: string | null
  choices: string[] | null
}

/** One option: a flag, or a flag that takes a value. */
export interface CliManifestOption {
  flags: string
  short: string | null
  long: string | null
  description: string | null
  /** The value the option takes, or `null` for a flag that takes none. */
  value: { name: string; required: boolean; variadic: boolean } | null
  /** Whether the command refuses to run without it. */
  mandatory: boolean
  default: unknown
  defaultDescription: string | null
  choices: string[] | null
  /** The environment variable it is read from, if any. */
  env: string | null
  negate: boolean
}

/** One command, with the subcommands under it. */
export interface CliManifestCommand {
  name: string
  /** The words that run it after the program's name, such as `['generate', 'controller']`. */
  path: string[]
  aliases: string[]
  summary: string | null
  description: string | null
  usage: string | null
  arguments: CliManifestArgument[]
  options: CliManifestOption[]
  /** Text the command's help shows before and after its own. */
  helpText: { before: string | null; after: string | null }
  commands: CliManifestCommand[]
}

/** The CLI as `dist/cli.json` describes it, for a reference to be generated from. */
export interface CliManifest {
  schemaVersion: number
  meocordVersion: string
  name: string
  description: string | null
  usage: string | null
  options: CliManifestOption[]
  commands: CliManifestCommand[]
}

const help = new Help()

const text = (value: string | undefined): string | null => value || null

/** A default as JSON can hold it; `undefined`, or a value JSON cannot represent, is `null`. */
const json = (value: unknown): unknown => (value === undefined ? null : JSON.parse(JSON.stringify(value) ?? 'null'))

/** The text `addHelpText` gives a command's help at one position, read by running its listeners. */
function helpTextOf(command: Command, position: 'before' | 'after'): string | null {
  let written = ''
  const context = { error: false, command, write: (part: string) => (written += part) }
  ;(command as unknown as EventEmitter).emit(`${position}Help`, context)
  return text(written.replace(/\n$/, ''))
}

function argumentOf(argument: Argument): CliManifestArgument {
  return {
    name: argument.name(),
    description: text(argument.description),
    required: argument.required,
    variadic: argument.variadic,
    default: json(argument.defaultValue),
    defaultDescription: text(argument.defaultValueDescription),
    choices: argument.argChoices ? [...argument.argChoices] : null,
  }
}

function optionOf(option: Option): CliManifestOption {
  // The value's name as the flags spell it: `<id>` or `[id...]`
  const placeholder = /[<[]([^>\]]+)[>\]]/.exec(option.flags)?.[1]
  return {
    flags: option.flags,
    short: option.short ?? null,
    long: option.long ?? null,
    description: text(option.description),
    value: placeholder
      ? { name: placeholder.replace(/\.\.\.$/, ''), required: option.required, variadic: option.variadic }
      : null,
    mandatory: option.mandatory,
    default: json(option.defaultValue),
    defaultDescription: text(option.defaultValueDescription),
    choices: option.argChoices ? [...option.argChoices] : null,
    env: option.envVar ?? null,
    negate: option.negate,
  }
}

// What help lists, less the implicit help option and command, in the order they were declared
const options = (command: Command): CliManifestOption[] =>
  help
    .visibleOptions(command)
    .filter(option => command.options.includes(option))
    .map(optionOf)

const subcommands = (command: Command, path: string[]): CliManifestCommand[] =>
  help
    .visibleCommands(command)
    .filter(child => command.commands.includes(child))
    .map(child => commandOf(child, path))

function commandOf(command: Command, parents: string[]): CliManifestCommand {
  const path = [...parents, command.name()]
  return {
    name: command.name(),
    path,
    aliases: [...command.aliases()],
    summary: text(command.summary()),
    description: text(command.description()),
    usage: text(command.usage()),
    arguments: command.registeredArguments.map(argumentOf),
    options: options(command),
    helpText: { before: helpTextOf(command, 'before'), after: helpTextOf(command, 'after') },
    commands: subcommands(command, path),
  }
}

/**
 * Describes the CLI from the program it runs: every public command and subcommand, with its aliases, arguments,
 * options and descriptions, in the order the program declares them, so the same program always gives the same
 * manifest.
 *
 * @param program - The configured program, as `MeoCordCLI.program()` returns it.
 * @param meocordVersion - The package's version.
 * @returns The manifest, ready for `JSON.stringify`.
 */
export function cliManifest(program: Command, meocordVersion: string): CliManifest {
  return {
    schemaVersion: CLI_MANIFEST_SCHEMA_VERSION,
    meocordVersion,
    name: program.name(),
    description: text(program.description()),
    usage: text(program.usage()),
    options: options(program),
    commands: subcommands(program, []),
  }
}
