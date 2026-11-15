import { createInterface } from 'node:readline/promises'
import { RESTJSONErrorCodes, Routes } from 'discord.js'
import {
  type CollectedCommand,
  collectCommands,
  type RegistrationLogger,
  registrationKey,
  SILENT_LOGGER,
} from '@src/core/command-identity.js'
import { cacheFile, forgetRecord, otherScopes, planTargets } from '@src/core/command-registration.js'
import { type CommandRegistrationConfig } from '@src/interface/index.js'
import { type PruneRequest } from '@src/util/registration-mode.util.js'

/** The most servers one page of `GET /users/@me/guilds` returns, the page size `--prune` asks for. */
export const GUILD_PAGE_LIMIT = 200

/**
 * The 401 and 403 answers a prune takes within {@link INVALID_REQUEST_WINDOW_MS} before it stops: a tenth of the 10,000
 * at which Discord restricts the address, so a bot in thousands of servers without command access stays well short.
 */
export const INVALID_REQUEST_CAP = 1_000

/** The window Discord counts invalid requests in, and a prune its 401 and 403 answers. */
export const INVALID_REQUEST_WINDOW_MS = 10 * 60_000

/** How many servers a prune checks between two lines of progress. */
export const PROGRESS_EVERY = 50

/** The REST calls a prune makes. */
export interface PruneRest {
  get(route: `/${string}`, options?: { query?: URLSearchParams }): Promise<unknown>
  put(route: `/${string}`, options: { body: unknown }): Promise<unknown>
  delete(route: `/${string}`): Promise<unknown>
}

/** What `--prune` removes: the commands the build declares, or with `all` every command of the app's. */
export type PruneMode = 'declared' | 'all'

/** What the person running `--prune all` decided about the commands the build doesn't declare. */
export type PruneConsent = 'remove' | 'keep' | 'refused'

export interface PruneOptions {
  rest: PruneRest
  applicationId: string
  /** The commands the build declares. */
  commands: readonly CollectedCommand[]
  /** The servers the configuration names or this run sent to, which registration owns. */
  skip: ReadonlySet<string>
  /** Servers `--prune-guild` adds, checked whether or not the bot is in them. */
  extraGuilds?: readonly string[]
  /** The server `--after` resumes the paging after, as a stop at the cap says. */
  after?: string
  mode: PruneMode
  /** Why it only reports what it would remove: `--dry-run`, or a development run to a `developmentGuild`. */
  reportOnly?: string
  /**
   * Asked once, with `all`, about the commands the build doesn't declare, each line a server and their names:
   * `refused` when it may not ask and was not told yes, which keeps them and fails the run.
   */
  consent: (servers: readonly string[]) => Promise<PruneConsent>
  /** Whether `--yes` was given, which a report-only run of `all` reports as consent, removing those too. */
  consented?: boolean
  logger: RegistrationLogger
  now?: () => number
}

/** A command as a server lists it. */
interface ServerCommand {
  id: string
  name: string
  type?: number
}

/** A server to check, by id, with its name when the bot is in it. */
interface Server {
  id: string
  name?: string
}

/** Ends the prune where it stands once the 401 and 403 answers reach the cap. */
class CapReached extends Error {}

const statusOf = (error: unknown) => (error as { status?: unknown })?.status
const isMissingAccess = (error: unknown) => statusOf(error) === 403 && (error as { code?: unknown })?.code === RESTJSONErrorCodes.MissingAccess
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))
const describeServer = ({ id, name }: Server) => (name ? `${name} (${id})` : `Server ${id}`)
const namesOf = (commands: readonly ServerCommand[]) => commands.map(command => command.name).join(', ')
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

/** What every line of a prune calls this application's commands that the build being registered doesn't declare. */
const UNDECLARED = 'not declared by this build'

/**
 * One server's line: what it removed, or would, what it kept, and, for a report-only run of `all` without `--yes`, what
 * the real run would ask about before removing.
 */
function serverLine(server: Server, gone: readonly ServerCommand[], kept: readonly ServerCommand[], verb: string, ask = false): string {
  const parts: string[] = []
  if (gone.length > 0) parts.push(`${verb} ${gone.length} (${namesOf(gone)})`)
  if (kept.length > 0) parts.push(`${ask ? 'would ask before removing' : 'kept'} ${kept.length} ${UNDECLARED} (${namesOf(kept)})`)
  return `${describeServer(server)}: ${parts.join('; ')}`
}

/**
 * Finds the app's commands left in servers the configuration doesn't name, and removes those the build declares by name
 * and type; with `all`, the others too, once consented to. It checks the servers the bot is in, paged, then those
 * `extraGuilds` adds, and stops at {@link INVALID_REQUEST_CAP} answers of 401 or 403 in
 * {@link INVALID_REQUEST_WINDOW_MS}.
 *
 * @returns Whether it finished with nothing failed, nothing refused, and before the cap.
 */
export async function pruneCommands(options: PruneOptions): Promise<boolean> {
  const { rest, applicationId, commands, mode, logger, reportOnly } = options
  const now = options.now ?? Date.now
  const declared = new Set(commands.map(({ body, name }) => registrationKey(body, name)))
  const isDeclared = (command: ServerCommand) => declared.has(registrationKey(command, command.name))
  const verb = reportOnly ? 'would remove' : 'removed'

  const invalid: number[] = []
  /** Counts a 401 or 403 answer within the window, and ends the prune at the cap. */
  const count = (error: unknown) => {
    const status = statusOf(error)
    if (status !== 401 && status !== 403) return
    const at = now()
    invalid.push(at)
    while (at - invalid[0] >= INVALID_REQUEST_WINDOW_MS) invalid.shift()
    if (invalid.length >= INVALID_REQUEST_CAP) throw new CapReached()
  }

  let removed = 0
  let kept = 0
  let asked = 0
  let noAccess = 0
  let refused = false
  const failed: string[] = []
  let lastPaged: string | undefined
  let stopped = false
  /**
   * With `all`, the servers holding commands the build doesn't declare, handled once consent is asked, each with the
   * server the bot's listing gave before it, from which a stop resumes so none of them is skipped.
   */
  const undeclared: { server: Server; found: ServerCommand[]; after: string | undefined; handled: boolean }[] = []

  /**
   * Removes `gone` from a server holding `found`, each listed command by its id, so a command registered there since the
   * listing stays; `clear`, as `--prune all` consented to, empties the server with one bulk update instead.
   */
  const remove = async (server: Server, found: readonly ServerCommand[], gone: readonly ServerCommand[], clear = false) => {
    if (!reportOnly) {
      try {
        if (clear) await rest.put(Routes.applicationGuildCommands(applicationId, server.id), { body: [] })
        // By id, so only what was listed goes: a command registered there since the listing stays
        else for (const command of gone) await rest.delete(Routes.applicationGuildCommand(applicationId, server.id, command.id))
      } catch (error) {
        failed.push(`${describeServer(server)}: ${messageOf(error)}`)
        count(error)
        return false
      }
      // The record of what development sent goes once every command listed there is gone
      if (clear || gone.length === found.length) forgetRecord(cacheFile(applicationId, { guild: server.id }), logger)
    }
    removed += gone.length
    return true
  }

  if (reportOnly) logger.log(`--prune only reports what it would remove: ${reportOnly}`)
  logger.log(`--prune costs one request per page of ${GUILD_PAGE_LIMIT} servers, one per server checked, and one per command removed.`)

  try {
    const servers = await serversToCheck(options, count)
    logger.log(`Checking ${plural(servers.length, 'server')} the configuration doesn't name…`)

    /** Lists a server's commands and removes or sets aside what it holds; a stop at the cap throws out of it. */
    const check = async (server: Server, previous: string | undefined) => {
      let found: unknown
      try {
        found = await rest.get(Routes.applicationGuildCommands(applicationId, server.id))
      } catch (error) {
        if (isMissingAccess(error)) noAccess++
        else failed.push(`${describeServer(server)}: ${messageOf(error)}`)
        count(error)
        return
      }
      // Not an empty server: its record of what development sent there stays until a listing says what it holds
      if (!Array.isArray(found)) {
        failed.push(`${describeServer(server)}: Discord answered its command listing with something other than a list of commands.`)
        return
      }
      if (found.length === 0) {
        if (!reportOnly) forgetRecord(cacheFile(applicationId, { guild: server.id }), logger)
        return
      }
      const commands = found as ServerCommand[]
      const ours = commands.filter(isDeclared)
      const others = commands.filter(command => !isDeclared(command))
      if (mode === 'all' && others.length > 0) {
        undeclared.push({ server, found: commands, after: previous, handled: false })
        return
      }
      if (ours.length > 0 && !(await remove(server, commands, ours))) return
      kept += others.length
      logger.log(serverLine(server, ours, others, verb))
    }

    for (const [index, server] of servers.entries()) {
      if (index > 0 && index % PROGRESS_EVERY === 0) logger.log(`Checked ${index} of ${servers.length} servers…`)
      await check(server, lastPaged)
      // Past a server only once it is handled, so a stop that its own listing or removal causes resumes from it
      if (server.name !== undefined) lastPaged = server.id
    }

    if (undeclared.length > 0) {
      // A report-only run asks no one: it says what the real run would do, which with --yes is to remove them too
      const consent: PruneConsent | 'ask' = reportOnly
        ? options.consented
          ? 'remove'
          : 'ask'
        : await options.consent(undeclared.map(({ server, found }) => `${describeServer(server)}: ${namesOf(found.filter(c => !isDeclared(c)))}`))
      refused = consent === 'refused'
      for (const entry of undeclared) {
        const { server, found } = entry
        const ours = found.filter(isDeclared)
        const others = found.filter(command => !isDeclared(command))
        if (consent === 'remove') {
          if (await remove(server, found, found, true)) logger.log(serverLine(server, found, [], verb))
        } else if (ours.length === 0 || (await remove(server, found, ours))) {
          if (consent === 'ask') asked += others.length
          else kept += others.length
          logger.log(serverLine(server, ours, others, verb, consent === 'ask'))
        }
        entry.handled = true
      }
    }
  } catch (error) {
    if (!(error instanceof CapReached)) throw error
    stopped = true
  }

  logger.log(
    `--prune ${verb} ${plural(removed, 'command')}, kept ${kept} ${UNDECLARED}, ` +
      (asked > 0 ? `would ask before removing ${asked} ${UNDECLARED}, ` : '') +
      `found ${plural(noAccess, 'server')} without command access, and failed in ${failed.length}.`,
  )
  for (const failure of failed) logger.error(`--prune failed in ${failure}`)
  if (refused) logger.error(`--prune all removed none of the commands ${UNDECLARED}: it can only ask in a terminal. Pass --yes to remove them.`)
  if (stopped) {
    // A server set aside for consent was not handled, so the run resumes from the server before the first of them
    const unhandled = undeclared.filter(({ handled }) => !handled)
    const after = unhandled.length > 0 ? unhandled[0].after : lastPaged
    const resume = ['meocord register --prune', ...(mode === 'all' ? ['all'] : []), ...(after ? [`--after ${after}`] : []), ...(options.extraGuilds ?? []).map(id => `--prune-guild ${id}`)].join(' ')
    logger.error(
      `--prune stopped after ${INVALID_REQUEST_CAP} answers of 401 or 403 in ${INVALID_REQUEST_WINDOW_MS / 60_000} minutes, well short ` +
        'of the number at which Discord restricts this address. ' +
        (unhandled.length > 0 ? `It had not yet handled ${unhandled.map(({ server }) => describeServer(server)).join(', ')}. ` : '') +
        `Run \`${resume}\` later to go on.`,
    )
  }
  logger.log('Servers the bot is not in are checked only with --prune-guild <id>.')
  return failed.length === 0 && !refused && !stopped
}

/** The servers to check: those the bot is in, paged from `after`, then those `extraGuilds` adds, less `skip`. */
async function serversToCheck({ rest, skip, extraGuilds = [], after }: PruneOptions, count: (error: unknown) => void): Promise<Server[]> {
  const servers: Server[] = []
  let cursor = after
  for (;;) {
    const query = new URLSearchParams({ limit: String(GUILD_PAGE_LIMIT), ...(cursor && { after: cursor }) })
    let page: Server[]
    try {
      page = (await rest.get(Routes.userGuilds(), { query })) as Server[]
    } catch (error) {
      count(error)
      throw error
    }
    servers.push(...page.map(({ id, name }) => ({ id, name: name ?? id })))
    if (page.length < GUILD_PAGE_LIMIT) break
    cursor = page[page.length - 1].id
  }
  const seen = new Set(servers.map(({ id }) => id))
  for (const id of extraGuilds) {
    if (seen.has(id)) continue
    seen.add(id)
    servers.push({ id })
  }
  return servers.filter(({ id }) => !skip.has(id))
}

/** The terminal a consent is asked in: where it reads the answer and writes the question. */
export interface ConsentTerminal {
  input: NodeJS.ReadableStream & { isTTY?: boolean }
  output: NodeJS.WritableStream & { isTTY?: boolean }
}

/**
 * Asks once, in a terminal, whether `--prune all` removes the commands the build doesn't declare, after listing them:
 * `remove` without asking given `--yes`, and `refused` with no terminal to ask in.
 */
export function terminalConsent(yes: boolean, logger: RegistrationLogger, terminal: ConsentTerminal = { input: process.stdin, output: process.stdout }) {
  return async (servers: readonly string[]): Promise<PruneConsent> => {
    logger.warn(`--prune all also removes the commands ${UNDECLARED}:\n${servers.map(line => `  ${line}`).join('\n')}`)
    if (yes) return 'remove'
    if (!terminal.input.isTTY || !terminal.output.isTTY) return 'refused'
    const prompt = createInterface({ input: terminal.input, output: terminal.output })
    try {
      return /^y(?:es)?$/i.test((await prompt.question('Remove them too? [y/N] ')).trim()) ? 'remove' : 'keep'
    } finally {
      prompt.close()
    }
  }
}

/** Everything `meocord register --prune` needs once registration has run, or been skipped by `--dry-run`. */
export interface PruneRunOptions {
  rest: PruneRest
  applicationId: string
  controllerClasses: (new (...args: any[]) => any)[]
  config?: CommandRegistrationConfig
  development: boolean
  onlyGuild?: string
  request: PruneRequest
  /** Whether this run's registration succeeded; a prune after a failed one could leave members with neither copy. */
  registered: boolean
  logger: RegistrationLogger
  consent?: PruneOptions['consent']
  now?: () => number
}

/**
 * Prunes after `meocord register`: only once its registration succeeded, or with `--dry-run`, skipping the servers the
 * configuration names and the ones this run sent to. Under development with a `developmentGuild`, it only reports.
 *
 * @returns Whether the prune ran and succeeded.
 */
export async function pruneAfterRegistration(options: PruneRunOptions): Promise<boolean> {
  const { rest, applicationId, controllerClasses, config, development, onlyGuild, request, registered, logger } = options
  if (!request.dryRun && !registered) {
    logger.error('--prune did not run, as registration failed: removing the old copies now could leave members with neither.')
    return false
  }
  const commands = collectCommands(controllerClasses, logger)
  if (!commands) return false
  const targets = planTargets(commands, { config, development, onlyGuild }, SILENT_LOGGER)
  const owned = [...targets.map(({ scope }) => scope), ...otherScopes(commands, targets, config)]
  const skip = new Set(owned.flatMap(scope => (scope === 'global' ? [] : [scope.guild])))
  const reportOnly = request.dryRun
    ? 'this is a dry run (--dry-run).'
    : development && config?.developmentGuild?.trim()
      ? 'commands go to the development guild, and a production bot sharing this application may own the ones elsewhere.'
      : undefined
  try {
    return await pruneCommands({
      rest,
      applicationId,
      commands,
      skip,
      extraGuilds: request.guilds,
      after: request.after,
      mode: request.mode,
      reportOnly,
      consent: options.consent ?? terminalConsent(request.yes, logger),
      consented: request.yes,
      logger,
      now: options.now,
    })
  } catch (error) {
    logger.error('--prune could not list the servers the bot is in:', error)
    return false
  }
}
