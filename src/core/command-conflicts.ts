import { ApplicationCommandOptionType, ApplicationCommandType } from 'discord.js'
import { Logger } from '@src/common/logger.js'
import { getAutocompleteHandlers, getCommandMap } from '@src/decorator/controller.decorator.js'
import { registrationKey, serialise } from '@src/core/command-registration.js'
import { CommandType } from '@src/enum/index.js'
import { type AutocompleteMeta, type CommandMeta } from '@src/interface/command-decorator.interface.js'
import { isCustomIdRouted } from '@src/util/interaction.util.js'
import { refuse } from '@src/util/refusal.util.js'

type ControllerClass = new (...args: any[]) => unknown

/** One `@Command` handler, as an error names it. */
interface Declared {
  controllerClass: ControllerClass
  meta: CommandMeta
}

const where = ({ controllerClass, meta }: Declared) => `${controllerClass.name}.${meta.methodName}`

/** The context menu kind a handler's builder registers; `undefined` for one without a builder, which takes both. */
const contextMenuKind = (meta: CommandMeta): unknown => (meta.builder as { type?: unknown } | undefined)?.type

/** A kind of command as an error names it: `slash command`, `user context menu command`. */
function label(type: CommandType, kind?: unknown): string {
  if (type === CommandType.PRIMARY_ENTRY_POINT) return 'entry point command'
  if (type !== CommandType.CONTEXT_MENU) return 'slash command'
  return `${kind === ApplicationCommandType.User ? 'user ' : kind === ApplicationCommandType.Message ? 'message ' : ''}context menu command`
}

/** A command as an error names it: `slash command "settings notify"`, `user context menu command "Report"`. */
const describe = (type: CommandType, name: string, kind?: unknown) => `${label(type, kind)} "${name}"`

/** Whether two handlers declared under one name would both be sent the same interactions. */
function overlap(a: CommandMeta, b: CommandMeta): boolean {
  if (a.type !== CommandType.CONTEXT_MENU) return true
  const [kindA, kindB] = [contextMenuKind(a), contextMenuKind(b)]
  return kindA === undefined || kindB === undefined || kindA === kindB
}

/**
 * Refuses the commands of which only one could ever run or be registered: two handlers of one slash command
 * name or subcommand path, or of one context menu name and kind, and two builder classes that build one
 * application command. One builder on a command and its own subcommand paths builds one command, and a user and a
 * message context menu may share a name. The app's start, `meocord register`, the shard manager and the testing
 * module call it before anything registers or runs.
 *
 * @throws Error naming both handlers, and both builders when two build one command, with what to do instead.
 */
export function assertDistinctCommands(controllerClasses: readonly ControllerClass[]): void {
  const handlers = new Map<string, Declared[]>()
  const builders = new Map<string, Declared & { name: string }>()

  // A controller listed twice is one controller
  for (const controllerClass of new Set(controllerClasses)) {
    const commandMap = getCommandMap(controllerClass.prototype) ?? {}
    for (const [name, metas] of Object.entries(commandMap)) {
      for (const meta of metas) {
        // Components route on a pattern, which the component routes check
        if (isCustomIdRouted(meta.type)) continue
        const here: Declared = { controllerClass, meta }

        const key = `${meta.type}\0${name}`
        const earlier = (handlers.get(key) ?? []).find(other => overlap(other.meta, meta))
        if (earlier) {
          throw refuse(new Error(
            `${where(earlier)}: it and ${where(here)} both handle the ${describe(meta.type, name, contextMenuKind(meta) ?? contextMenuKind(earlier.meta))}, ` +
              `so only ${where(earlier)} would ever run. Keep one handler for it, or give the other a name or ` +
              `subcommand path of its own.`,
          ))
        }
        handlers.set(key, [...(handlers.get(key) ?? []), here])

        if (!meta.builder || !meta.builderClass) continue
        let body: ReturnType<typeof serialise>
        try {
          body = serialise(meta.builder)
        } catch {
          // Registration reports a builder that cannot be serialised
          continue
        }
        const registered = registrationKey(body, name)
        const built = builders.get(registered)
        if (!built) {
          builders.set(registered, { ...here, name: typeof body.name === 'string' ? body.name : name })
        } else if (built.meta.builderClass !== meta.builderClass) {
          throw refuse(new Error(
            `${where(built)}: its builder ${built.meta.builderClass!.name} and ${meta.builderClass.name} on ${where(here)} both ` +
              `build the ${describe(meta.type, built.name, contextMenuKind(meta))}, and Discord registers one command ` +
              `per name and type, so only the first would be. Keep one builder, on a single @Command, and declare ` +
              `the other handlers with CommandType.${meta.type}.`,
          ))
        }
      }
    }
  }
}

const logger = new Logger('Commands')

/** The application command types Discord sends a handler of each name-routed type. */
const SENT_AS: Partial<Record<CommandType, readonly ApplicationCommandType[]>> = {
  [CommandType.SLASH]: [ApplicationCommandType.ChatInput],
  [CommandType.CONTEXT_MENU]: [ApplicationCommandType.User, ApplicationCommandType.Message],
  [CommandType.PRIMARY_ENTRY_POINT]: [ApplicationCommandType.PrimaryEntryPoint],
}

type Body = ReturnType<typeof serialise>
interface CommandOption {
  type?: unknown
  name?: unknown
  autocomplete?: unknown
  options?: CommandOption[]
}

/** The subcommand paths a slash command's JSON registers: `settings view`, `settings alerts email`. */
function subcommandPaths(body: Body): string[] {
  const paths: string[] = []
  for (const option of (body.options ?? []) as CommandOption[]) {
    if (option.type === ApplicationCommandOptionType.Subcommand) paths.push(`${body.name} ${option.name}`)
    if (option.type !== ApplicationCommandOptionType.SubcommandGroup) continue
    for (const sub of option.options ?? []) {
      if (sub.type === ApplicationCommandOptionType.Subcommand) paths.push(`${body.name} ${option.name} ${sub.name}`)
    }
  }
  return paths
}

/** Whether an option holds other options: a subcommand or a group of them. */
const nests = (option: CommandOption) =>
  option.type === ApplicationCommandOptionType.Subcommand || option.type === ApplicationCommandOptionType.SubcommandGroup

/**
 * The options an autocomplete at a path can be for: a subcommand's own, or at the command itself every option of the
 * command, its subcommands' included, since each autocomplete of the command falls back to its name.
 */
function optionsAt(body: Body, rest: readonly string[]): CommandOption[] {
  const all = (options: readonly CommandOption[]): CommandOption[] =>
    options.flatMap(option => (nests(option) ? all(option.options ?? []) : [option]))
  const top = (body.options ?? []) as CommandOption[]
  if (rest.length === 0) return all(top)
  let scope: CommandOption | undefined = { options: top }
  for (const part of rest) scope = scope?.options?.find(option => option.name === part)
  return (scope?.options ?? []).filter(option => !nests(option))
}

const quoted = (names: string[]) =>
  names.length < 2 ? names.map(name => `"${name}"`).join('') : `${names.slice(0, -1).map(name => `"${name}"`).join(', ')} and "${names.at(-1)}"`

/**
 * Warns, in one message, about every name-routed handler Discord never sends an interaction to: a subcommand path
 * the builder of its command does not register, a customId pattern given as a command name, a builder that
 * registers another name than its `@Command`'s, and a command no builder registers at all. An `@Autocomplete`
 * handler is checked the same way, and for an option the builder does not register with autocomplete on.
 *
 * @param options - `missingBuilders: false` leaves out the commands no builder registers, as the testing
 *   module does, where a handler with no builder is how a fixture is written.
 */
export function warnUnregisteredCommands(controllerClasses: readonly ControllerClass[], { missingBuilders = true } = {}): void {
  const declared: (Declared & { name: string })[] = []
  const completions: { controllerClass: ControllerClass; meta: AutocompleteMeta }[] = []
  const built = new Map<CommandMeta, Body>()
  // Each registered command by type and name, with its JSON; `undefined` for one whose builder cannot be serialised
  const registered = new Map<string, Body | undefined>()

  for (const controllerClass of new Set(controllerClasses)) {
    for (const meta of getAutocompleteHandlers(controllerClass.prototype)) completions.push({ controllerClass, meta })
    for (const [name, metas] of Object.entries(getCommandMap(controllerClass.prototype) ?? {})) {
      for (const meta of metas) {
        if (isCustomIdRouted(meta.type)) continue
        declared.push({ controllerClass, meta, name })
        if (!meta.builder) continue
        try {
          const body = serialise(meta.builder)
          built.set(meta, body)
          registered.set(registrationKey(body, name), body)
        } catch {
          // Registration reports it; what it would register is unknown, so nothing under its name is flagged
          for (const type of SENT_AS[meta.type] ?? []) registered.set(`${type}:${name.split(' ')[0]}`, undefined)
        }
      }
    }
  }

  const problems: string[] = []
  for (const here of declared) {
    const problem = unregistered(here.name, here.meta, built.get(here.meta), registered, missingBuilders)
    if (problem) problems.push(`  ${where(here)}: ${problem}`)
  }
  for (const { controllerClass, meta } of completions) {
    const problem = unasked(meta, registered, missingBuilders)
    if (problem) problems.push(`  ${controllerClass.name}.${meta.methodName}: ${problem}`)
  }
  if (problems.length === 0) return

  const one = problems.length === 1
  logger.warn(
    `${problems.length} command ${one ? 'handler handles' : 'handlers handle'} what Discord never sends, so ` +
      `${one ? 'it never runs' : 'they never run'}:\n${problems.join('\n')}\n` +
      'The next major version (5.0) refuses to start with these.',
  )
}

/** What keeps Discord from sending a handler its command, or `undefined` when a builder registers it. */
function unregistered(
  name: string,
  meta: CommandMeta,
  body: Body | undefined,
  registered: ReadonlyMap<string, Body | undefined>,
  missingBuilders: boolean,
): string | undefined {
  if (/[/{]/.test(name)) {
    return `"${name}" is a customId pattern, and a ${label(meta.type)} is matched by its name. Declare it with the component type that sends that customId, such as CommandType.BUTTON.`
  }

  // Only a slash command's name is a path; a context menu's may hold spaces
  const [command, ...rest] = meta.type === CommandType.SLASH ? name.split(' ') : [name]
  if (body && meta.builderClass && typeof body.name === 'string' && body.name !== command) {
    return (
      `its builder ${meta.builderClass.name} registers the ${describe(meta.type, body.name, contextMenuKind(meta))}, not "${command}", so ` +
      `Discord sends "${body.name}". Declare it as @Command('${[body.name, ...rest].join(' ')}', ${meta.builderClass.name}), or have ` +
      `the builder use the name build() is given.`
    )
  }

  const key = (SENT_AS[meta.type] ?? []).map(type => `${type}:${command}`).find(key => registered.has(key))
  if (key === undefined) {
    return missingBuilders
      ? `no builder registers the ${describe(meta.type, command)}. Correct the name, or declare the command with a builder.`
      : undefined
  }

  const json = registered.get(key)
  if (rest.length === 0 || !json) return undefined
  return pathProblem(name, command, json)
}

/** Why a slash command's subcommand path is not one its builder registers, or `undefined` when it is. */
function pathProblem(path: string, command: string, json: Body): string | undefined {
  const paths = subcommandPaths(json)
  if (paths.includes(path)) return undefined
  return (
    `"${path}" is not a subcommand of the ${describe(CommandType.SLASH, command)}, whose builder registers ` +
    `${paths.length ? quoted(paths) : 'no subcommands'}. Correct the path.`
  )
}

/** What keeps Discord from asking an `@Autocomplete` handler to complete, or `undefined` when a builder asks it. */
function unasked(
  { commandPath, optionName }: AutocompleteMeta,
  registered: ReadonlyMap<string, Body | undefined>,
  missingBuilders: boolean,
): string | undefined {
  const [command, ...rest] = commandPath.split(' ')
  const key = `${ApplicationCommandType.ChatInput}:${command}`
  if (!registered.has(key)) {
    return missingBuilders
      ? `no builder registers the ${describe(CommandType.SLASH, command)}. Correct the name, or declare the command with a builder.`
      : undefined
  }
  const json = registered.get(key)
  if (!json) return undefined
  const path = rest.length ? pathProblem(commandPath, command, json) : undefined
  if (path) return path

  const options = optionsAt(json, rest)
  const completed = [...new Set(options.filter(option => option.autocomplete === true).map(option => String(option.name)))]
  if (optionName === undefined) {
    if (completed.length) return undefined
    return (
      `"${commandPath}" has no option with autocomplete on, so Discord never asks it to complete one. Turn it on for ` +
      `an option in the builder with setAutocomplete(true).`
    )
  }
  if (completed.includes(optionName)) return undefined
  if (options.some(option => option.name === optionName)) {
    return (
      `the option "${optionName}" of "${commandPath}" does not have autocomplete on, so Discord never asks to complete ` +
      `it. Turn it on in the builder with setAutocomplete(true).`
    )
  }
  const others = completed.length ? `; its options with autocomplete are ${quoted(completed)}` : ', nor any option with autocomplete on'
  return `"${commandPath}" has no option "${optionName}"${others}. Correct the option name.`
}

/**
 * Warns about `@Autocomplete` handlers that complete what another already does: the same option of the same command
 * path, or every option of the same path. Dispatch runs the first, in the order the controllers are listed, so the
 * others never run.
 */
export function warnDuplicateAutocompletes(controllerClasses: readonly ControllerClass[]): void {
  const first = new Map<string, string>()
  const problems: string[] = []
  for (const controllerClass of new Set(controllerClasses)) {
    for (const { commandPath, optionName, methodName } of getAutocompleteHandlers(controllerClass.prototype)) {
      const key = `${commandPath}\0${optionName ?? ''}`
      const here = `${controllerClass.name}.${methodName}`
      const earlier = first.get(key)
      if (earlier === undefined) {
        first.set(key, here)
        continue
      }
      const what = optionName === undefined ? `every option of "${commandPath}"` : `the option "${optionName}" of "${commandPath}"`
      problems.push(`  ${here}: ${earlier} also completes ${what}, and runs first. Keep one, or give this one a path or option of its own.`)
    }
  }
  if (problems.length === 0) return

  const one = problems.length === 1
  logger.warn(
    `${problems.length} @Autocomplete ${one ? 'handler never runs' : 'handlers never run'}, since another completes the ` +
      `same first:\n${problems.join('\n')}\nThe next major version (5.0) refuses to start with these.`,
  )
}
