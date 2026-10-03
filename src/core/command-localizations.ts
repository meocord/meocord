import { ApplicationCommandType, Locale } from 'discord.js'

/** Discord's rule for a chat input command or option name, localised or not. */
const CHAT_INPUT_NAME = /^[-_'\p{L}\p{N}\p{sc=Deva}\p{sc=Thai}]{1,32}$/u

/** Discord's longest name for every command and option, context menus included, and for a choice. */
const COMMAND_NAME_LENGTH = 32
const CHOICE_NAME_LENGTH = 100

const DISCORD_LOCALES: ReadonlySet<string> = new Set(Object.values(Locale))

interface LocalizedNode {
  name?: unknown
  type?: unknown
  name_localizations?: unknown
  description_localizations?: unknown
  options?: unknown
  choices?: unknown
}

/** The entries of a localization map, or none when it is absent or null. */
const entriesOf = (map: unknown): [string, unknown][] =>
  typeof map === 'object' && map !== null ? Object.entries(map as Record<string, unknown>) : []

/**
 * What Discord would reject in a command's localised names and descriptions, so the error names the field instead of
 * an opaque 50035; the command's own names and descriptions are left to discord.js and Discord.
 *
 * @returns One line per problem, such as `"ban" description_localizations.ja: 104 characters (1 to 100)`.
 */
export function localizationProblems(commandName: string, body: LocalizedNode): string[] {
  const problems: string[] = []
  const chatInput = body.type === undefined || body.type === ApplicationCommandType.ChatInput

  // Each entry of a map with a Discord locale; an unknown one is the problem, and its value is not read, as lowercasing
  // for a malformed tag could throw
  const known = (map: unknown, at: string): [string, unknown, string][] =>
    entriesOf(map).flatMap(([locale, value]): [string, unknown, string][] => {
      const field = `${at}.${locale}`
      if (DISCORD_LOCALES.has(locale)) return [[locale, value, field]]
      problems.push(`"${commandName}" ${field}: "${locale}" is not a Discord locale`)
      return []
    })

  const check = (path: string, node: LocalizedNode, rules: { nameLength: number; chatInputName: boolean; descriptions: boolean }) => {
    for (const [locale, value, field] of known(node.name_localizations, `${path}name_localizations`)) {
      if (value === null) continue
      if (typeof value !== 'string' || value.length < 1 || value.length > rules.nameLength) {
        problems.push(`"${commandName}" ${field}: ${describeLength(value)} (1 to ${rules.nameLength})`)
      } else if (rules.chatInputName && (!CHAT_INPUT_NAME.test(value) || value !== value.toLocaleLowerCase(locale))) {
        problems.push(`"${commandName}" ${field}: "${value}" must be lowercase letters, numbers, - _ or ' with no spaces`)
      }
    }

    if (!rules.descriptions) return
    for (const [, value, field] of known(node.description_localizations, `${path}description_localizations`)) {
      if (value === null) continue
      if (typeof value !== 'string' || value.length < 1 || value.length > 100) {
        problems.push(`"${commandName}" ${field}: ${describeLength(value)} (1 to 100)`)
      }
    }
  }

  // Context menu names allow spaces and capitals, and none of them has a description.
  const contextMenu = body.type === ApplicationCommandType.User || body.type === ApplicationCommandType.Message
  check('', body, { nameLength: COMMAND_NAME_LENGTH, chatInputName: chatInput, descriptions: !contextMenu })

  const walk = (path: string, options: unknown) => {
    if (!Array.isArray(options)) return
    for (const option of options as LocalizedNode[]) {
      const at = `${path}${String(option.name)}.`
      check(`options.${at}`, option, { nameLength: COMMAND_NAME_LENGTH, chatInputName: true, descriptions: true })
      if (Array.isArray(option.choices)) {
        for (const choice of option.choices as LocalizedNode[]) {
          check(`options.${at}choices.${String(choice.name)}.`, choice, { nameLength: CHOICE_NAME_LENGTH, chatInputName: false, descriptions: false })
        }
      }
      walk(at, option.options)
    }
  }
  walk('', body.options)

  return problems
}

function describeLength(value: unknown): string {
  return typeof value === 'string' ? `${value.length} characters` : `not a string`
}
