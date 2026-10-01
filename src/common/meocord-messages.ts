import { type CatalogShape } from '@src/common/translator.js'

/**
 * MeoCord's own texts for users, in English: the one place they are written. An app translates any of them by
 * adding a `meocord` group to its catalogs; what a locale leaves out is read from here.
 */
export const MEOCORD_MESSAGES = {
  meocord: {
    usage: {
      heading: 'Usage: {usage}',
      headingMany: 'Usage:\n{usages}',
      missing: '{param} is missing',
      notValid: '{label}: "{word}" is not a valid {type}',
      notOneOf: '{label}: "{word}" is not one of {choices}',
      notMember: '{label}: <@{id}> is not a member of this server',
      noUser: '{label}: no user has the ID {id}',
      notRole: '{label}: <@&{id}> is not a role in this server',
      notChannel: '{label}: "{word}" is not a channel',
      unknownFlag: '--{flag} is not an option of this command',
      notYesNo: '{label}: "{value}" is not yes or no',
      flagNeedsValue: '{label} needs a value, such as {label}=<{flag}>',
      tooManyWords: 'The command has more words than it takes',
      serverOnly: 'This command works in a server only.',
      dmOnly: 'This command works in direct messages only.',
    },
    types: {
      string: 'text',
      int: 'whole number',
      number: 'number',
      bool: 'yes or no answer',
      duration: 'length of time, such as 10m',
      member: 'member',
      user: 'user',
      role: 'role',
      channel: 'channel',
    },
    cooldown: {
      until: 'Slow down: try again {when}.',
      storeDown: "Cooldowns can't be checked right now: try again shortly.",
    },
    fallback: {
      notFound: 'Command not found!',
      error: 'An error occurred while executing the command.',
    },
    dm: {
      error: '{command} in {channel} on {server}: {reason}',
      cooldown: '{command} in {channel} on {server}: {wait}',
    },
    presenter: {
      loading: 'Working on it…',
      errorTitle: 'Oops!',
    },
    help: {
      commandsHeading: 'Commands:',
      commandsHint: "Type {invocation} <command> for one command's usage.",
      describedCommand: '{usage} — {description}',
      param: '{name}: {label}',
      optionalParam: '{name} (optional): {label}',
      params: '{params}',
      aliases: 'Also: {aliases}',
      serverOnly: 'Works in servers only.',
      dmOnly: 'Works in direct messages only.',
      unknown: 'No command is called "{query}". Type {invocation} to list them.',
      emptyHere: 'There are no commands you can use here.',
      emptyServerOnly: 'These commands work in servers only.',
      listOf: '{label}, one or more',
      flagOn: 'on when given',
      oneOf: 'one of {choices}',
    },
  },
} as const satisfies CatalogShape
