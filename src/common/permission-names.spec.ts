import { ChatInputCommandInteraction, PermissionFlagsBits, PermissionsBitField } from 'discord.js'
import { createTranslator, permissionNames } from '@src/common/index.js'
import { MEOCORD_MESSAGES } from '@src/common/meocord-messages.js'
import { registerClientTranslator } from '@src/common/meocord-text.js'
import { createMockInteraction } from '@src/testing/index.js'

const LABELS: Record<string, string> = MEOCORD_MESSAGES.meocord.permissions

const t = createTranslator({
  default: 'en-US',
  locales: {
    'en-US': { ping: 'Pong!' },
    ja: { meocord: { permissions: { KickMembers: 'メンバーをキック', ManageMessages: 'メッセージの管理' } } },
  },
})

describe('permissionNames', () => {
  it('labels every bit discord.js names, by one of its flag names, and nothing else', () => {
    const bits = new Map<bigint, string[]>()
    for (const [name, bit] of Object.entries(PermissionFlagsBits)) bits.set(bit, [...(bits.get(bit) ?? []), name])
    const unlabelled = [...bits.values()].filter(names => !names.some(name => Object.hasOwn(LABELS, name)))
    const strays = Object.keys(LABELS).filter(name => name !== 'unknown' && !Object.hasOwn(PermissionFlagsBits, name))

    expect({ unlabelled, strays }).toEqual({ unlabelled: [], strays: [] })
    // Each bit gives one label of its own
    const all = permissionNames(PermissionsBitField.All)
    expect(all).toHaveLength(bits.size)
    expect(new Set(all).size).toBe(bits.size)
  })

  it("gives the labels as Discord's role settings word them (live check of 2026-11-15)", () => {
    expect(permissionNames(['KickMembers', 'SendMessages', 'ManageThreads', 'SendMessagesInThreads'])).toEqual([
      'Kick, Approve, and Reject Members',
      'Send Messages and Create Posts',
      'Manage Threads and Posts',
      'Send Messages in Threads and Posts',
    ])
  })

  it('gives the labels in bit order, whatever order they come in', () => {
    expect(permissionNames(['ManageMessages', 'BanMembers'])).toEqual(['Ban Members', 'Manage Messages'])
    expect(permissionNames(PermissionFlagsBits.ModerateMembers | PermissionFlagsBits.UseVAD)).toEqual(['Use Voice Activity', 'Timeout Members'])
    expect(permissionNames(0n)).toEqual([])
  })

  it('gives a bit with two flag names one label, by its current name', () => {
    expect([permissionNames('ManageEmojisAndStickers'), permissionNames('ManageGuildExpressions')]).toEqual([['Manage Expressions'], ['Manage Expressions']])
  })

  it('gives a bit with no label its flag name, and a bit discord.js has no name for its place', () => {
    const label = LABELS.BypassSlowmode
    delete LABELS.BypassSlowmode
    try {
      expect(permissionNames(PermissionFlagsBits.BypassSlowmode)).toEqual(['BypassSlowmode'])
    } finally {
      LABELS.BypassSlowmode = label
    }
    expect(permissionNames((1n << 60n) | (1n << 47n) | PermissionFlagsBits.BanMembers)).toEqual([
      'Ban Members',
      'Unknown permission (1 << 47)',
      'Unknown permission (1 << 60)',
    ])
  })

  it('joins the labels with and or or as a list in English too', () => {
    expect([
      permissionNames(['ManageMessages', 'BanMembers'], undefined, { join: 'and' }),
      permissionNames(['ManageMessages', 'BanMembers', 'ManageRoles'], undefined, { join: 'and' }),
      permissionNames(['ManageMessages', 'BanMembers'], undefined, { join: 'or' }),
      permissionNames([], undefined, { join: 'and' }),
    ]).toEqual(['Ban Members and Manage Messages', 'Ban Members, Manage Messages, and Manage Roles', 'Ban Members or Manage Messages', ''])
  })

  it('lists a label holding commas as it is', () => {
    expect([
      permissionNames(['KickMembers', 'BanMembers'], undefined, { join: 'and' }),
      permissionNames(['KickMembers', 'BanMembers', 'ManageMessages'], undefined, { join: 'and' }),
    ]).toEqual(['Kick, Approve, and Reject Members and Ban Members', 'Kick, Approve, and Reject Members, Ban Members, and Manage Messages'])
  })

  it("reads the labels in the target's language, and joins them in the language they are in", () => {
    const interaction = createMockInteraction(ChatInputCommandInteraction, { locale: 'ja' as never })
    registerClientTranslator(interaction.client, t)
    try {
      expect([
        permissionNames(['KickMembers', 'ManageMessages'], interaction, { join: 'and' }),
        permissionNames(['KickMembers', 'ManageMessages'], 'ja', { t }),
        // English labels in a ja reply read as an English list
        permissionNames(['BanMembers', 'Administrator'], 'ja', { t, join: 'and' }),
      ]).toEqual([
        new Intl.ListFormat('ja', { type: 'conjunction' }).format(['メンバーをキック', 'メッセージの管理']),
        ['メンバーをキック', 'メッセージの管理'],
        'Ban Members and Administrator',
      ])
    } finally {
      registerClientTranslator(interaction.client, undefined)
    }
    expect(permissionNames(['BanMembers'], 'ja')).toEqual(['Ban Members'])
  })

  it("refuses a flag name discord.js doesn't know, and a join it can't write", () => {
    expect(() => permissionNames('KickMember' as never)).toThrow(RangeError)
    expect(() => permissionNames('KickMembers', undefined, { join: 'nor' as never })).toThrow(RangeError)
  })
})
