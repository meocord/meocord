import {
  Attachment,
  AutocompleteInteraction,
  ButtonInteraction,
  ChannelSelectMenuInteraction,
  ChatInputCommandInteraction,
  MentionableSelectMenuInteraction,
  MessageContextMenuCommandInteraction,
  ModalSubmitInteraction,
  PrimaryEntryPointCommandInteraction,
  Role,
  RoleSelectMenuInteraction,
  StringSelectMenuInteraction,
  User,
  UserContextMenuCommandInteraction,
  UserSelectMenuInteraction,
} from 'discord.js'
import { CommandType } from '@src/enum/index.js'
import { createChatInputOptions, createMockInteraction } from '@src/testing/index.js'
import {
  describeInteraction,
  focusedOptionName,
  hasCustomId,
  isCustomIdRouted,
  matchesCommandType,
  resolveCommandPaths,
  resolveOptionParams,
} from '@src/util/interaction.util.js'

const chatInput = (commandName: string, options?: Parameters<typeof createChatInputOptions>[0]) => {
  const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName })
  if (options) interaction.options = createChatInputOptions(options)
  return interaction
}

describe('matchesCommandType', () => {
  // The table is the single place the framework decides what a command type accepts.
  // Every member is listed so a new one cannot be added without a matching entry.
  const cases: [CommandType, { prototype: any; name: string }][] = [
    [CommandType.SLASH, ChatInputCommandInteraction],
    [CommandType.CONTEXT_MENU, UserContextMenuCommandInteraction],
    [CommandType.CONTEXT_MENU, MessageContextMenuCommandInteraction],
    [CommandType.PRIMARY_ENTRY_POINT, PrimaryEntryPointCommandInteraction],
    [CommandType.BUTTON, ButtonInteraction],
    [CommandType.SELECT_MENU, StringSelectMenuInteraction],
    [CommandType.USER_SELECT_MENU, UserSelectMenuInteraction],
    [CommandType.ROLE_SELECT_MENU, RoleSelectMenuInteraction],
    [CommandType.MENTIONABLE_SELECT_MENU, MentionableSelectMenuInteraction],
    [CommandType.CHANNEL_SELECT_MENU, ChannelSelectMenuInteraction],
    [CommandType.MODAL_SUBMIT, ModalSubmitInteraction],
  ]

  it.each(cases)('accepts %s for its own interaction class', (type, InteractionClass) => {
    expect(matchesCommandType(type, createMockInteraction(InteractionClass))).toBe(true)
  })

  it('covers every command type', () => {
    const covered = new Set(cases.map(([type]) => type))
    expect([...Object.values(CommandType)].filter(type => !covered.has(type))).toEqual([])
  })

  // Five select menus share a customId shape and a base class, so telling them apart
  // is the whole reason each has its own command type.
  it('does not accept one select menu for another', () => {
    const userSelect = createMockInteraction(UserSelectMenuInteraction)

    expect(matchesCommandType(CommandType.USER_SELECT_MENU, userSelect)).toBe(true)
    expect(matchesCommandType(CommandType.SELECT_MENU, userSelect)).toBe(false)
    expect(matchesCommandType(CommandType.ROLE_SELECT_MENU, userSelect)).toBe(false)
  })

  it('rejects a value that is not an interaction at all', () => {
    expect(matchesCommandType(CommandType.BUTTON, { customId: 'x' })).toBe(false)
    expect(matchesCommandType(CommandType.BUTTON, undefined)).toBe(false)
  })
})

describe('isCustomIdRouted', () => {
  it('routes components by pattern', () => {
    expect(isCustomIdRouted(CommandType.BUTTON)).toBe(true)
    expect(isCustomIdRouted(CommandType.CHANNEL_SELECT_MENU)).toBe(true)
    expect(isCustomIdRouted(CommandType.MODAL_SUBMIT)).toBe(true)
  })

  it('routes registered commands by name', () => {
    expect(isCustomIdRouted(CommandType.SLASH)).toBe(false)
    expect(isCustomIdRouted(CommandType.CONTEXT_MENU)).toBe(false)
    expect(isCustomIdRouted(CommandType.PRIMARY_ENTRY_POINT)).toBe(false)
  })
})

describe('hasCustomId', () => {
  it('is true for every component and for modal submits', () => {
    expect(hasCustomId(createMockInteraction(ButtonInteraction))).toBe(true)
    expect(hasCustomId(createMockInteraction(ChannelSelectMenuInteraction))).toBe(true)
    expect(hasCustomId(createMockInteraction(ModalSubmitInteraction))).toBe(true)
  })

  it('is false for commands, which are routed by name', () => {
    expect(hasCustomId(chatInput('ping'))).toBe(false)
    expect(hasCustomId(createMockInteraction(AutocompleteInteraction))).toBe(false)
  })
})

describe('resolveCommandPaths', () => {
  it('gives a flat command only its own name', () => {
    expect(resolveCommandPaths(chatInput('ping', {}))).toEqual(['ping'])
  })

  it('puts the subcommand path ahead of the bare command name', () => {
    expect(resolveCommandPaths(chatInput('settings', { subcommand: 'email' }))).toEqual(['settings email', 'settings'])
  })

  it('includes the subcommand group in the path', () => {
    const interaction = chatInput('settings', { subcommandGroup: 'notify', subcommand: 'email' })

    expect(resolveCommandPaths(interaction)).toEqual(['settings notify email', 'settings'])
  })

  // Dropping the group would let `settings notify email` fall back to a handler written
  // for a different group's `email`, which is a mis-route rather than a fallback.
  it('never falls back to a path with the group removed', () => {
    const paths = resolveCommandPaths(chatInput('settings', { subcommandGroup: 'notify', subcommand: 'email' }))

    expect(paths).not.toContain('settings email')
  })

  it('falls back to the command name when the resolver has no subcommand methods', () => {
    const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName: 'ping' })

    expect(resolveCommandPaths(interaction)).toEqual(['ping'])
  })
})

describe('resolveOptionParams', () => {
  it('keys each supplied option by name', () => {
    const interaction = chatInput('echo', { message: 'hi', count: 2, loud: true })

    expect(resolveOptionParams(interaction)).toEqual({ message: 'hi', count: 2, loud: true })
  })

  // The gateway already sent the user object alongside the snowflake; handing the
  // handler the bare id would make it fetch what it was already given.
  it('gives the resolved entity rather than its snowflake', () => {
    const user = createMockInteraction(User, { id: '900', username: 'ada' })
    const interaction = chatInput('kick', { target: user })

    expect(resolveOptionParams(interaction).target).toBe(user)
  })

  it('resolves a role option to the role', () => {
    const role = createMockInteraction(Role, { id: 'role-1', name: 'admin' })
    const interaction = chatInput('grant', { role })

    expect(resolveOptionParams(interaction).role).toBe(role)
  })

  it('resolves an attachment option to the attachment', () => {
    const attachment = createMockInteraction(Attachment, { id: 'file-1', url: 'https://cdn/x.png' })
    const interaction = chatInput('upload', { file: attachment })

    expect(resolveOptionParams(interaction).file).toBe(attachment)
  })

  // `/settings notify email true` puts nothing but `notify` at the top level, so a
  // handler bound to the subcommand would otherwise receive an empty record.
  it('flattens options that arrived nested under a subcommand', () => {
    const interaction = chatInput('settings', { subcommandGroup: 'notify', subcommand: 'email', enabled: true })

    expect(resolveOptionParams(interaction)).toEqual({ enabled: true })
  })

  it('is empty when the command was invoked with no options', () => {
    expect(resolveOptionParams(chatInput('ping', {}))).toEqual({})
  })

  it('is empty rather than throwing when the resolver carries no data', () => {
    expect(resolveOptionParams(createMockInteraction(ChatInputCommandInteraction))).toEqual({})
  })
})

// `getFocused` throws when nothing is focused rather than returning null, and it is
// missing entirely on a hand-built double. Neither may escape as an unhandled rejection
// out of the interactionCreate listener.
describe('focusedOptionName', () => {
  it('names the option being typed', () => {
    const interaction = createMockInteraction(AutocompleteInteraction, { commandName: 'search' })
    interaction.options = createChatInputOptions({ focused: 'query', query: 'ad' }) as never

    expect(focusedOptionName(interaction)).toBe('query')
  })

  it('is undefined when no option is focused', () => {
    const interaction = createMockInteraction(AutocompleteInteraction, { commandName: 'search' })
    interaction.options = createChatInputOptions({ query: 'ad' }) as never

    expect(() => interaction.options.getFocused(true)).toThrow()
    expect(focusedOptionName(interaction)).toBeUndefined()
  })

  it('is undefined when the resolver has no getFocused at all', () => {
    const interaction = createMockInteraction(AutocompleteInteraction, { commandName: 'search' })

    expect(focusedOptionName(interaction)).toBeUndefined()
  })
})

describe('describeInteraction', () => {
  it('names the focused option of an autocomplete interaction', () => {
    const interaction = createMockInteraction(AutocompleteInteraction, { commandName: 'search' })
    interaction.options = createChatInputOptions({ focused: 'query', query: 'ad' }) as never

    expect(describeInteraction(interaction)).toBe('autocomplete for "search" option "query"')
  })

  it('spells out the full subcommand path of a chat input command', () => {
    const interaction = chatInput('settings', { subcommandGroup: 'notify', subcommand: 'email' })

    expect(describeInteraction(interaction)).toBe('command "settings notify email"')
  })

  it('names a context menu command by name', () => {
    const interaction = createMockInteraction(UserContextMenuCommandInteraction, { commandName: 'Report' })

    expect(describeInteraction(interaction)).toBe('command "Report"')
  })

  it('drops the option clause when nothing is focused', () => {
    const interaction = createMockInteraction(AutocompleteInteraction, { commandName: 'search' })
    interaction.options = createChatInputOptions({ query: 'ad' }) as never

    expect(describeInteraction(interaction)).toBe('autocomplete for "search"')
  })

  it('names a component by its customId', () => {
    const interaction = createMockInteraction(ChannelSelectMenuInteraction, { customId: 'pick/channel' })

    expect(describeInteraction(interaction)).toBe('customId "pick/channel"')
  })
})
