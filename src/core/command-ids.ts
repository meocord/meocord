import { ApplicationCommandOptionType, ApplicationCommandType, RESTJSONErrorCodes } from 'discord.js'
import { type Container } from 'inversify'
import {
  type CollectedCommand,
  DEFAULT_APPLICATION_COMMAND_TYPE,
  type RegistrationScope,
  routeFor,
  scopeKey,
} from '@src/core/command-identity.js'
import { listed } from '@src/util/user-text.util.js'
import { shared } from '@src/util/shared-state.util.js'
import { MS_PER_SECOND } from '@src/util/timer-limit.util.js'

/**
 * How long after a scope's last refetch a mention that no scope resolves lists that scope again. Discord sends a bot no
 * event when its commands change, so such a mention refetches, at most once in this interval per scope.
 */
export const COMMAND_REFETCH_INTERVAL_MS = 60_000

/** What every message of `commandMention` starts with. */
const PREFIX = 'commandMention'

/** What a wrong path, or a command that isn't registered, is fixed by. */
const REGISTER_FIX = 'Run `meocord register` to register the commands this build declares.'

/** A command, or an option of one, as far as a mention's path reads it. */
interface CommandNode {
  type?: unknown
  name?: unknown
  options?: unknown
}

/** A command as Discord lists it, with its ID. */
interface ListedCommand extends CommandNode {
  id: string
  name: string
}

/** A path checked against the app's own commands: the words a user types, and the command they start with. */
export interface CommandPath {
  /** The path as given, for messages. */
  text: string
  /** The command's name, then its group and subcommand, if any. */
  words: string[]
}

/** Where a mention finds the ID of one of an app's commands. */
export interface CommandIdSource {
  /** The commands the app declares, as registration sends them. */
  declared(): readonly CollectedCommand[]
  /** The ID of the command a checked path starts with, where a reader in `guild`, or outside any guild, can use it. */
  idOf(client: object, guild: string | undefined, path: CommandPath): Promise<string>
}

const sources = shared('commandIdSources', () => new WeakMap<Container, CommandIdSource>())

/** Makes `source` where the mentions of the app in `container` find their IDs. */
export function provideCommandIds(container: Container, source: CommandIdSource): void {
  sources.set(container, source)
}

/** Where the mentions of the app in `container` find their IDs, if it has said. */
export function commandIdSourceOf(container: Container): CommandIdSource | undefined {
  return sources.get(container)
}

const isBranch = (option: CommandNode) =>
  option.type === ApplicationCommandOptionType.Subcommand || option.type === ApplicationCommandOptionType.SubcommandGroup

/** The subcommands and groups directly under a command or a group. */
const branchesOf = (node: CommandNode): CommandNode[] =>
  (Array.isArray(node.options) ? (node.options as CommandNode[]) : []).filter(option => option && isBranch(option))

/** What a command's type is called in a message: only a slash command has a mention. */
const KIND_OF: Partial<Record<number, string>> = {
  [ApplicationCommandType.User]: 'a user context menu command',
  [ApplicationCommandType.Message]: 'a message context menu command',
  [ApplicationCommandType.PrimaryEntryPoint]: 'an entry point command',
}

const typeOf = (node: CommandNode): unknown => node.type ?? DEFAULT_APPLICATION_COMMAND_TYPE

/**
 * Checks a path against the slash commands the app declares.
 *
 * @throws RangeError naming the path: the name is no command of the app's, the command is not a slash command, the
 *   path names a subcommand or group the command doesn't declare, or it stops at a parent that has subcommands.
 */
export function checkPath(text: string, declared: readonly CollectedCommand[]): CommandPath {
  const words = typeof text === 'string' ? text.trim().split(/\s+/).filter(Boolean) : []
  if (words.length === 0) throw new RangeError(`${PREFIX} takes a command's name, then its group and subcommand, as in "settings channel".`)
  const shown = words.join(' ')
  const [name, ...rest] = words
  const named = declared.filter(command => command.name === name)
  const slash = named.find(command => typeOf(command.body) === ApplicationCommandType.ChatInput)
  if (!slash) {
    if (named.length > 0) {
      const kind = KIND_OF[typeOf(named[0].body) as number] ?? 'not a slash command'
      throw new RangeError(`${PREFIX}: "${name}" is ${kind}, which has no mention; only a slash command has one.`)
    }
    const names = declared.filter(command => typeOf(command.body) === ApplicationCommandType.ChatInput).map(command => command.name)
    throw new RangeError(
      `${PREFIX}: "${shown}" names no command of this app's. ` +
        (names.length > 0 ? `Its slash commands are ${listed(names.map(found => `"${found}"`))}.` : 'It declares no slash command.'),
    )
  }
  let branches = branchesOf(slash.body)
  let reached = name
  for (const word of rest) {
    const next = branches.find(branch => branch.name === word)
    if (!next) {
      const declaredHere = branches.map(branch => `"${String(branch.name)}"`)
      throw new RangeError(
        `${PREFIX}: "${shown}" names "${word}", which "${reached}" doesn't declare; ` +
          (declaredHere.length > 0 ? `it declares ${listed(declaredHere)}.` : 'it has no subcommands.'),
      )
    }
    reached = `${reached} ${word}`
    branches = next.type === ApplicationCommandOptionType.SubcommandGroup ? branchesOf(next) : []
  }
  if (branches.length > 0) {
    throw new RangeError(
      `${PREFIX}: "${shown}" has subcommands, and Discord runs only one of them; mention ` +
        `${listed(branches.map(branch => `"${reached} ${String(branch.name)}"`))}.`,
    )
  }
  return { text: shown, words }
}

/** Whether a registered command holds the rest of a path: its group and subcommand, as declared. */
function holdsPath(command: CommandNode, words: readonly string[]): boolean {
  let node = command
  for (const word of words.slice(1)) {
    const next = branchesOf(node).find(branch => branch.name === word)
    if (!next) return false
    node = next
  }
  return branchesOf(node).length === 0
}

/** One scope's commands for one client, as listed or registered, and when a miss last listed them again. */
interface ScopeIds {
  commands?: readonly ListedCommand[]
  /** When a mention no scope resolved last listed the scope, which the next waits {@link COMMAND_REFETCH_INTERVAL_MS} after. */
  refetchedAt?: number
  /** A listing under way, which every lookup of the scope meanwhile shares. */
  listing?: Promise<readonly ListedCommand[]>
  /**
   * How the last listing failed, other than in a scope the bot can't read, and when; cleared by one that succeeds. The
   * scope is listed again {@link COMMAND_REFETCH_INTERVAL_MS} after, as after a miss.
   */
  failure?: { error: unknown; at: number }
}

const scopesByClient = shared('commandIdScopes', () => new WeakMap<object, Map<string, ScopeIds>>())
const registering = shared('commandRegistrations', () => new WeakMap<object, Set<Promise<void>>>())

function scopeOf(client: object, scope: RegistrationScope): ScopeIds {
  let scopes = scopesByClient.get(client)
  if (!scopes) scopesByClient.set(client, (scopes = new Map()))
  const key = scopeKey(scope)
  let ids = scopes.get(key)
  if (!ids) scopes.set(key, (ids = {}))
  return ids
}

/** The commands in a listing or a bulk update's answer; `undefined` for anything else. */
function commandsIn(answer: unknown): ListedCommand[] | undefined {
  if (!Array.isArray(answer)) return undefined
  const commands = answer.filter(
    (command): command is ListedCommand => typeof command?.id === 'string' && typeof command?.name === 'string',
  )
  return commands.length === answer.length ? commands : undefined
}

/** Keeps what Discord answered this process's registration of a scope, or listed for it, as that scope's IDs. */
export function storeCommandIds(client: object, scope: RegistrationScope, answer: unknown): void {
  const commands = commandsIn(answer)
  if (commands) scopeOf(client, scope).commands = commands
}

/**
 * Records that this process is registering a client's commands, so a mention meanwhile waits for the IDs it answers.
 *
 * @returns What ends the record, once registration has settled.
 */
export function startRegistration(client: object): () => void {
  let running = registering.get(client)
  if (!running) registering.set(client, (running = new Set()))
  const { promise, resolve } = Promise.withResolvers<void>()
  running.add(promise)
  return () => {
    running.delete(promise)
    resolve()
  }
}

/** The client's REST and application, as far as a lookup uses them. */
interface ReadyClient {
  application?: { id?: unknown } | null
  rest: { get(route: `/${string}`): Promise<unknown> }
}

/** Whether a listing failed because the bot cannot read commands there, as in a guild it isn't in. */
const noCommandAccess = (error: unknown) =>
  (error as { status?: unknown })?.status === 403 && (error as { code?: unknown })?.code === RESTJSONErrorCodes.MissingAccess

/** Lists a scope's commands, sharing a listing already under way. A scope the bot can't read holds none. */
async function list(client: ReadyClient, applicationId: string, scope: RegistrationScope): Promise<readonly ListedCommand[]> {
  const ids = scopeOf(client, scope)
  if (ids.listing) return ids.listing
  const listing = (async () => {
    try {
      const commands = (ids.commands = commandsIn(await client.rest.get(routeFor(applicationId, scope))) ?? [])
      ids.failure = undefined
      return commands
    } catch (error) {
      if (noCommandAccess(error)) {
        ids.failure = undefined
        return (ids.commands = [])
      }
      ids.failure = { error, at: Date.now() }
      throw error
    }
  })()
  ids.listing = listing
  const done = () => {
    if (ids.listing === listing) ids.listing = undefined
  }
  listing.then(done, done)
  return listing
}

/** A failed listing's error on one line, such as `DiscordAPIError[50013]: Missing Permissions`. */
function failureText(error: unknown): string {
  try {
    return String(error)
  } catch {
    return 'an error that cannot be printed'
  }
}

const describe = (scope: RegistrationScope) => (scope === 'global' ? 'globally' : `in guild ${scope.guild}`)

/**
 * The IDs Discord gives an app's commands: from this process's registration, else one listing on a scope's first
 * lookup, listed again when no scope holds the path, at most once every {@link COMMAND_REFETCH_INTERVAL_MS} per scope.
 * A mention that resolves costs nothing after each scope's first listing; a guild copy registered while the bot runs is
 * used once the global copy no longer resolves, or after a restart, and an ID gone stale because the command was deleted
 * and registered again elsewhere shows as plain `/name` text until then. A failed listing leaves its scope to the next
 * and waits the same interval; a listing another lookup has under way is shared.
 *
 * @param declared - The commands the app declares.
 * @param guildsOf - The guilds the app's configuration registers a command to, when it registers it to no other scope.
 */
export function discordCommandIds(
  declared: () => readonly CollectedCommand[],
  guildsOf: (name: string) => readonly string[] | undefined,
): CommandIdSource {
  return {
    declared,
    async idOf(client, guild, path) {
      const ready = client as ReadyClient
      const applicationId = ready.application?.id
      if (typeof applicationId !== 'string' || !applicationId) {
        throw new Error(
          `${PREFIX} waits for the client to be ready: it reads the application's commands, which Discord names at login. ` +
            'Mention a command once the bot is online, as in a handler or an onReady hook.',
        )
      }
      // This process's own registration answers with the IDs, so a mention made meanwhile waits for it
      const running = registering.get(client)
      if (running?.size) await Promise.all(running)

      const [name] = path.words
      const scopes: RegistrationScope[] = guild ? [{ guild }, 'global'] : ['global']
      const find = (scope: RegistrationScope) =>
        scopeOf(client, scope).commands?.find(command => command.name === name && typeOf(command) === ApplicationCommandType.ChatInput)
      const resolves = (scope: RegistrationScope) => {
        const found = find(scope)
        return found && holdsPath(found, path.words) ? found.id : undefined
      }
      const recent = (at: number | undefined) => at !== undefined && Date.now() - at < COMMAND_REFETCH_INTERVAL_MS
      // A failed listing stays on its scope, which the next scope may still resolve, and is reported if none does
      const listOrShare = (scope: RegistrationScope) => list(ready, applicationId, scope).catch(() => undefined)
      // Each scope listed once, on its first lookup, the guild's first, or again once a failed listing's interval is over;
      // the first that holds the path gives the ID
      const listedNow = new Set<string>()
      for (const scope of scopes) {
        const ids = scopeOf(client, scope)
        if (!ids.commands && (ids.listing || !recent(ids.failure?.at))) {
          await listOrShare(scope)
          listedNow.add(scopeKey(scope))
        }
        const id = resolves(scope)
        if (id) return id
      }
      // No scope holds it: each is listed again, guild first, unless this lookup or one in the last interval just did; a
      // listing another lookup has under way is shared whatever the interval, since it may hold what this one looks for
      for (const scope of scopes) {
        const ids = scopeOf(client, scope)
        if (listedNow.has(scopeKey(scope))) continue
        if (!ids.listing) {
          if (recent(ids.refetchedAt) || recent(ids.failure?.at)) continue
          ids.refetchedAt = Date.now()
        }
        await listOrShare(scope)
        const id = resolves(scope)
        if (id) return id
      }

      const failed = scopes.find(scope => scopeOf(client, scope).failure)
      if (failed) {
        const { error } = scopeOf(client, failed).failure!
        throw new Error(
          `${PREFIX} could not list the commands registered ${describe(failed)} (${failureText(error)}), and no other scope ` +
            `holds "${path.text}". It lists that scope again after ${COMMAND_REFETCH_INTERVAL_MS / MS_PER_SECOND} seconds.`,
          { cause: error },
        )
      }
      const lacking = scopes.filter(scope => find(scope))

      const looked = scopes.map(describe).join(' or ')
      if (lacking.length > 0) {
        throw new Error(
          `${PREFIX}: the "${name}" command registered ${listed(lacking.map(describe))} has no "${path.text}", ` +
            `as when it was registered before that was added. ${REGISTER_FIX}`,
        )
      }
      const only = guildsOf(name)
      if (only?.length && !(guild && only.includes(guild))) {
        throw new Error(
          `${PREFIX}: "${path.text}" is registered only to ${only.length === 1 ? 'guild' : 'guilds'} ${listed(only)}, ` +
            `and ${guild ? `this mention is for guild ${guild}` : 'this mention is for no guild'}, where no reader can use it.`,
        )
      }
      throw new Error(`${PREFIX}: "${path.text}" is not registered ${looked}. ${REGISTER_FIX}`)
    },
  }
}
