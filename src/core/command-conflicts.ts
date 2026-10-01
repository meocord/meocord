import { ApplicationCommandType } from 'discord.js'
import { getCommandMap } from '@src/decorator/controller.decorator.js'
import { registrationKey, serialise } from '@src/core/command-registration.js'
import { CommandType } from '@src/enum/index.js'
import { type CommandMeta } from '@src/interface/command-decorator.interface.js'
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

/** A command as an error names it: `slash command "settings notify"`, `user context menu command "Report"`. */
function describe(type: CommandType, name: string, kind?: unknown): string {
  if (type !== CommandType.CONTEXT_MENU) return `slash command "${name}"`
  const label = kind === ApplicationCommandType.User ? 'user ' : kind === ApplicationCommandType.Message ? 'message ' : ''
  return `${label}context menu command "${name}"`
}

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
