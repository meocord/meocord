import { createHash } from 'crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import path from 'path'
import { ApplicationCommandType, REST, type RESTOptions } from 'discord.js'
import Table from 'cli-table3'
import { type CommandRegistrationConfig } from '@src/interface/index.js'
import {
  type CollectedCommand,
  collectCommands,
  type RegistrationLogger,
  type RegistrationScope,
  routeFor,
  scopeKey,
} from '@src/core/command-identity.js'

/** The part of discord.js's `REST` registration uses, so a client's own and a standalone one both fit. */
export interface RegistrationRest {
  get(route: `/${string}`): Promise<unknown>
  put(route: `/${string}`, options: { body: unknown }): Promise<unknown>
}

export interface RegistrationTarget {
  scope: RegistrationScope
  commands: CollectedCommand[]
}

/**
 * The REST client a registration outside the bot sends with, made from the bot's `clientOptions.rest`, so a REST proxy,
 * another `api` or a `timeout` applies to it as to the bot's own requests. Without one, it sends to Discord.
 */
export function registrationRest(token: string, options?: Partial<RESTOptions>): REST {
  return new REST(options).setToken(token)
}

/** What decides where each command goes. */
export interface TargetOptions {
  config?: CommandRegistrationConfig
  /** Whether `NODE_ENV` is `development`, which is when `developmentGuild` applies. */
  development: boolean
  /** A guild every command goes to, as `meocord register --guild` asks. */
  onlyGuild?: string
}

const ids = (list: (string | undefined)[] | undefined): string[] => [
  ...new Set((list ?? []).map(id => id?.trim()).filter((id): id is string => !!id)),
]

/** Where every command goes regardless of `guilds`: `--guild`, or `developmentGuild` in development. */
const everythingTarget = ({ config, development, onlyGuild }: TargetOptions): string | undefined =>
  onlyGuild?.trim() || (development ? config?.developmentGuild?.trim() : undefined)

/**
 * Whether `commands.guilds` names guilds but no ids, as `[process.env.GUILD_ID]` does with the variable
 * unset. The default scope is then nowhere: registering globally instead would publish the commands
 * everywhere.
 */
function defaultGuildsEmpty(options: TargetOptions): boolean {
  const guilds = options.config?.guilds ?? []
  return !everythingTarget(options) && guilds.length > 0 && ids(guilds).length === 0
}

/** Whether a command is an activity's primary entry point, which Discord takes only globally. */
const isEntryPoint = (command: CollectedCommand): boolean => command.body.type === ApplicationCommandType.PrimaryEntryPoint

/** What a blank guild to register every command to says, as an unset variable gives one. */
const BLANK_GUILD = 'No commands were registered: the guild to register to is blank. Give a guild id, or leave it out to register where commands.* says.'

/**
 * Names every command whose builder lists guilds but no guild id, each with its builder, and says the run registers
 * none of them yet still succeeds.
 */
function blankGuildsWarning(commands: CollectedCommand[]): string {
  const one = commands.length === 1
  const lines = commands.map(command => `  ${command.builder ? `${command.builder}: ` : ''}"${command.name}"`)
  return (
    `${commands.length} ${one ? 'command is' : 'commands are'} not registered: ${one ? 'its builder lists' : 'their builders list'} ` +
    'no guild ids, as when the variable holding them is unset.\n' +
    `${lines.join('\n')}\n` +
    'Set the guild ids; a builder without guilds registers where commands.* says. `meocord register` still exits 0 for ' +
    'these; the next major version (5.0) exits 1.'
  )
}

/**
 * Where each command is sent: one bulk update per scope. A scope's update replaces everything the application has
 * there, so the default scope is included even when it ends up empty, unless `commands.guilds` lists no guild id.
 *
 * A primary entry point command goes in the global update, as Discord refuses a guild update that holds one. A run
 * that sends everything to one guild sends nothing global, so it leaves the entry point out.
 */
export function planTargets(commands: CollectedCommand[], options: TargetOptions, logger: RegistrationLogger): RegistrationTarget[] {
  // Registering to the default scopes instead could publish everywhere
  if (options.onlyGuild !== undefined && !options.onlyGuild.trim()) {
    logger.error(BLANK_GUILD)
    return []
  }
  const everythingTo = everythingTarget(options)
  if (everythingTo) {
    // A global update from here would hold only what this run sends, deleting the application's other global commands
    for (const command of commands.filter(isEntryPoint)) {
      logger.warn(`Entry point command "${command.name}" is registered globally only; a production run or \`meocord register\` registers it.`)
    }
    return [{ scope: { guild: everythingTo }, commands: commands.filter(command => !isEntryPoint(command)) }]
  }

  const defaultGuilds = ids(options.config?.guilds)
  const nowhere = defaultGuildsEmpty(options)
  const targets = new Map<string, RegistrationTarget>()
  const add = (scope: RegistrationScope, command?: CollectedCommand) => {
    const key = scopeKey(scope)
    if (!targets.has(key)) targets.set(key, { scope, commands: [] })
    if (command) targets.get(key)!.commands.push(command)
  }

  if (defaultGuilds.length === 0 && !nowhere) add('global')
  for (const guild of defaultGuilds) add({ guild })

  const unregistered: string[] = []
  const blankGuilds: CollectedCommand[] = []
  for (const command of commands) {
    if (isEntryPoint(command)) {
      if (command.guilds) {
        logger.warn(`Entry point command "${command.name}" can only be registered globally, so the guilds its builder lists are ignored.`)
      }
      add('global', command)
    } else if (command.guilds) {
      const own = ids(command.guilds)
      // Falling back to the default scope could publish a staff-only command everywhere.
      if (own.length === 0) blankGuilds.push(command)
      for (const guild of own) add({ guild }, command)
    } else if (nowhere) {
      unregistered.push(`"${command.name}"`)
    } else if (defaultGuilds.length === 0) {
      add('global', command)
    } else {
      for (const guild of defaultGuilds) add({ guild }, command)
    }
  }

  if (blankGuilds.length > 0) logger.warn(blankGuildsWarning(blankGuilds))

  if (nowhere) {
    const outcome =
      unregistered.length === 0
        ? targets.has('global')
          ? 'only the entry point command is registered globally'
          : 'nothing is registered globally'
        : `${unregistered.join(', ')} ${unregistered.length === 1 ? 'is' : 'are'} not registered, rather than registered globally`
    logger.warn(
      `commands.guilds lists no guild id, as an unset environment variable leaves it, so ${outcome}. ` +
        `Set the guild ids, or remove commands.guilds to register globally.`,
    )
  }

  return [...targets.values()]
}

/** The scopes this configuration names that registration is not sending to, where leftovers can sit. */
export function otherScopes(commands: CollectedCommand[], targets: RegistrationTarget[], config?: CommandRegistrationConfig): RegistrationScope[] {
  const sent = new Set(targets.map(({ scope }) => scopeKey(scope)))
  const named: RegistrationScope[] = [
    'global',
    ...ids([...(config?.guilds ?? []), config?.developmentGuild, ...commands.flatMap(command => command.guilds ?? [])]).map(guild => ({ guild })),
  ]
  return named.filter(scope => !sent.has(scopeKey(scope)))
}

const describeScope = (scope: RegistrationScope) => (scope === 'global' ? 'globally' : `to guild ${scope.guild}`)

/** The development cache of what was last sent, per application and scope. Undefined without node_modules. */
export function cacheFile(applicationId: string, scope: RegistrationScope): string | undefined {
  const nodeModules = path.resolve(process.cwd(), 'node_modules')
  if (!existsSync(nodeModules)) return undefined
  return path.join(nodeModules, '.cache', 'meocord', `commands-${applicationId}-${scopeKey(scope)}.json`)
}

const hashOf = (commands: CollectedCommand[]) =>
  createHash('sha256')
    .update(JSON.stringify(commands.map(({ body }) => body)))
    .digest('hex')

/** What development last sent to a scope: the commands' hash, and each command's `id:version` as Discord answered. */
interface SentRecord {
  hash: string
  /** Absent in a record written before versions were kept, which then sends once more. */
  versions?: string[]
}

function readRecord(file: string | undefined, logger: RegistrationLogger): SentRecord | undefined {
  if (!file || !existsSync(file)) return undefined
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as SentRecord
  } catch (error) {
    logger.debug(`Could not read the registered commands, so they are sent again: ${String(error)}`)
    return undefined
  }
}

function writeRecord(file: string | undefined, record: SentRecord, logger: RegistrationLogger): void {
  if (!file) return
  try {
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify(record)}\n`)
  } catch (error) {
    logger.debug(`Could not record the registered commands: ${String(error)}`)
  }
}

/** Forgets what development last sent to a scope, once that scope is written some other way. */
export function forgetRecord(file: string | undefined, logger: RegistrationLogger): void {
  if (!file || !existsSync(file)) return
  try {
    rmSync(file)
  } catch (error) {
    logger.debug(`Could not forget the registered commands: ${String(error)}`)
  }
}

/**
 * Each command's `id:version`, sorted, from what Discord lists or answers a bulk update with; `undefined` for anything
 * else. Discord gives a command a new version whenever it is updated, so the set changes with any edit, removal or
 * re-registration, from this checkout or any other.
 */
function versionsOf(commands: unknown): string[] | undefined {
  if (!Array.isArray(commands)) return undefined
  const versions = commands.map(command => {
    const { id, version } = (command ?? {}) as { id?: unknown; version?: unknown }
    return typeof id === 'string' && typeof version === 'string' ? `${id}:${version}` : undefined
  })
  return versions.every(version => version !== undefined) ? (versions as string[]).sort() : undefined
}

/** Whether Discord still holds a scope as development last sent it, by each command's version; a failed listing doesn't. */
async function stillAsSent(
  rest: RegistrationRest,
  route: `/${string}`,
  record: SentRecord,
  scope: RegistrationScope,
  { logger, listed }: Pick<RegisterCommandsOptions, 'logger' | 'listed'>,
): Promise<boolean> {
  if (!record.versions) return false
  let registered: unknown
  try {
    registered = await rest.get(route)
  } catch (error) {
    logger.debug(`Could not list the commands registered ${describeScope(scope)}, so they are sent again: ${String(error)}`)
    return false
  }
  const unchanged = versionsOf(registered)?.join('\n') === record.versions.join('\n')
  if (unchanged) listed?.(scope, registered)
  return unchanged
}

function logRegistered(target: RegistrationTarget, logger: RegistrationLogger): void {
  const table = new Table({ head: ['Name', 'Type', 'Sub-commands'], colWidths: [null, null, 30], wordWrap: true })
  const typeNames: Record<number, string> = { 1: 'SlashCommand', 2: 'UserContextMenu', 3: 'MessageContextMenu', 4: 'PrimaryEntryPoint' }

  for (const { name, body } of target.commands) {
    const options = Array.isArray(body.options) ? (body.options as { name?: string; type?: unknown }[]) : []
    // A subcommand or a subcommand group, not a plain option
    const subcommands = options.filter(option => option.type === 1 || option.type === 2)
    table.push([name, typeNames[typeof body.type === 'number' ? body.type : 1] ?? 'Command', subcommands.map(option => option.name).join(', ')])
  }

  logger.log(`Registered ${target.commands.length} bot commands ${describeScope(target.scope)}:\n${table.toString()}`)
}

/**
 * Warns, once per guild, about each guild this checkout's development runs registered to, by the records they left,
 * that the configuration neither sends to nor names: commands may be left there. It only warns, and keeps the record,
 * which proves a past send from here and not what Discord holds now.
 */
function warnAboutUnnamedGuilds(
  applicationId: string,
  commands: CollectedCommand[],
  targets: RegistrationTarget[],
  config: CommandRegistrationConfig | undefined,
  logger: RegistrationLogger,
): void {
  const anyRecord = cacheFile(applicationId, 'global')
  const directory = anyRecord && path.dirname(anyRecord)
  if (!directory || !existsSync(directory)) return
  const owned = new Set(
    [...targets.map(({ scope }) => scope), ...otherScopes(commands, targets, config)].map(scope => scopeKey(scope)),
  )
  const prefix = `commands-${applicationId}-guild-`
  const guilds = readdirSync(directory)
    .filter(file => file.startsWith(prefix) && file.endsWith('.json'))
    .map(file => file.slice(prefix.length, -'.json'.length))
    // By ID: the file system lists a directory in an order of its own
    .sort(byId)
  for (const guild of guilds) {
    if (owned.has(scopeKey({ guild }))) continue
    logger.warn(
      `Commands may be left in server ${guild}, which this configuration no longer registers to; run \`meocord register --prune\` to find and remove them.`,
    )
  }
}

/** Orders snowflake IDs by value: a shorter ID is a smaller one, and IDs of one length compare digit by digit. */
function byId(a: string, b: string): number {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)
}

/** Everything one registration needs. */
export interface RegisterCommandsOptions extends TargetOptions {
  rest: RegistrationRest
  applicationId: string
  controllerClasses: (new (...args: any[]) => any)[]
  logger: RegistrationLogger
  /** Send every scope even when development's cache says it is unchanged. */
  force?: boolean
  /** Hears what Discord answered a scope's bulk update with, or listed there for a scope left as it was. */
  listed?: (scope: RegistrationScope, commands: unknown) => void
}

/**
 * Registers the commands, one bulk update per scope; development skips a scope unchanged since its last send and still
 * registered as sent, which one listing per skipped scope checks by each command's version, unless `force`. A blank `onlyGuild` registers nothing. Once one is sent, and not to `onlyGuild`, the other scopes the configuration names are checked for
 * leftovers, which `clearOther` removes; a development-guild run or a `commands.guilds` with no id only warns. Never
 * throws.
 * @returns Whether every scope was sent or unchanged, and `commands.guilds`, if set, lists a guild id.
 */
export async function registerCommands(options: RegisterCommandsOptions): Promise<boolean> {
  const { rest, applicationId, controllerClasses, logger, config, development, onlyGuild, force = false } = options
  // An unset variable passed as the guild; registering to the default scopes instead could publish everywhere
  if (onlyGuild !== undefined && !onlyGuild.trim()) {
    logger.error(BLANK_GUILD)
    return false
  }

  const commands = collectCommands(controllerClasses, logger)
  if (!commands) return false

  const targets = planTargets(commands, { config, development, onlyGuild }, logger)
  if (development) warnAboutUnnamedGuilds(applicationId, commands, targets, config, logger)
  // Commands the configuration meant for guilds went nowhere, and what it would clear cannot be trusted
  const guildsEmpty = defaultGuildsEmpty({ config, development, onlyGuild })
  let succeeded = !guildsEmpty
  let sent = false

  for (const target of targets) {
    const file = cacheFile(applicationId, target.scope)
    const hash = hashOf(target.commands)
    const route = routeFor(applicationId, target.scope)

    // Unchanged since development last sent it, and still what Discord holds there
    const record = development && !force ? readRecord(file, logger) : undefined
    if (record?.hash === hash && (await stillAsSent(rest, route, record, target.scope, options))) {
      logger.log(`Commands ${describeScope(target.scope)} are unchanged; not registering them again.`)
      continue
    }

    try {
      const answered = await rest.put(route, { body: target.commands.map(({ body }) => body) })
      sent = true
      options.listed?.(target.scope, answered)
      // Outside development the record would be stale, so the next development start sends again
      if (development) writeRecord(file, { hash, versions: versionsOf(answered) }, logger)
      else forgetRecord(file, logger)
      logRegistered(target, logger)
    } catch (error) {
      succeeded = false
      logger.error(`Error registering commands ${describeScope(target.scope)}:`, error)
    }
  }

  // Development and production often share one application, so a development guild run never clears.
  const toDevelopmentGuild = development && !!config?.developmentGuild?.trim()
  const keptBecause = toDevelopmentGuild
    ? 'while commands go to the development guild, since a production bot sharing this application may own them'
    : guildsEmpty
      ? 'while commands.guilds lists no guild id'
      : undefined
  if (sent && !onlyGuild) await reportOtherScopes(options, commands, targets, keptBecause)

  return succeeded
}

/**
 * Warns about, or with `clearOther` removes, this application's commands left in scopes not sent to.
 * Given `keptBecause`, as for a development guild run, it only warns, saying why.
 */
async function reportOtherScopes(
  { rest, applicationId, config, logger }: RegisterCommandsOptions,
  commands: CollectedCommand[],
  targets: RegistrationTarget[],
  keptBecause: string | undefined,
): Promise<void> {
  for (const scope of otherScopes(commands, targets, config)) {
    let existing: { name?: string }[]
    try {
      existing = (await rest.get(routeFor(applicationId, scope))) as { name?: string }[]
    } catch (error) {
      // A guild the bot is not in answers 50001; there is nothing of ours to find there.
      logger.debug(`Could not list the commands registered ${describeScope(scope)}: ${String(error)}`)
      continue
    }
    if (!Array.isArray(existing) || existing.length === 0) continue

    const names = existing.map(({ name }) => name).join(', ')
    if (!config?.clearOther || keptBecause) {
      // Advising clearOther when it would not apply sends the reader to a setting that changes nothing
      const advice = !keptBecause
        ? 'Set commands.clearOther to remove them.'
        : config?.clearOther
          ? `clearOther is on, but they are not removed ${keptBecause}.`
          : `They are not removed ${keptBecause}, even with commands.clearOther.`
      logger.warn(
        `${existing.length} command(s) are still registered ${describeScope(scope)} (${names}), which this ` +
          `configuration does not register to, so Discord keeps showing them there. ${advice}`,
      )
      continue
    }

    try {
      await rest.put(routeFor(applicationId, scope), { body: [] })
      // What development last sent there is gone, so its next start sends again
      forgetRecord(cacheFile(applicationId, scope), logger)
      logger.log(`Removed ${existing.length} command(s) left registered ${describeScope(scope)}: ${names}`)
    } catch (error) {
      logger.error(`Error removing the commands left registered ${describeScope(scope)}:`, error)
    }
  }
}
