import { ChatInputCommandInteraction } from 'discord.js'
import {
  CommandNotFoundError,
  CooldownError,
  CooldownStoreError,
  createTranslator,
  GuardDeniedError,
  MessageUsageError,
  translateError,
  UserError,
} from '@src/common/index.js'
import { usageIssue } from '@src/common/meocord-text.js'
import { createMockGuild, createMockInteraction, createMockMessage } from '@src/testing/index.js'

const t = createTranslator({
  default: 'en-US',
  locales: {
    'en-US': { ping: 'Pong!' },
    id: {
      meocord: {
        usage: { heading: 'Cara pakai: {usage}', headingMany: 'Cara pakai:\n{usages}', notOneOf: '{label}: "{word}" bukan {choices}', serverOnly: 'Hanya di server.' },
        cooldown: { minutes: 'Tunggu {minutes} menit {seconds} detik.', wholeMinutes: 'Tunggu {minutes} menit.', storeDown: 'Cooldown sedang tidak bisa dicek.' },
        fallback: { notFound: 'Perintah tidak ditemukan!', error: 'Terjadi kesalahan.' },
      },
    },
    ja: { meocord: { usage: { notOneOf: '{label}：「{word}」は{choices}のどれでもありません' } } },
  },
})

const sortUsage = () =>
  new MessageUsageError('!sort <order>', [
    usageIssue({ key: 'meocord.usage.notOneOf', params: { label: 'order', word: 'up', choices: { list: ['asc', 'desc', 'random'], style: 'or' } } }, 'order'),
    { param: 'order', message: 'Pick one the bot knows.' },
  ])

describe('translateError', () => {
  it("translates a usage error's heading and MeoCord's issues, keeping an issue the app wrote as it is", () => {
    const error = sortUsage()

    expect(translateError(error, t, 'id')).toBe('Cara pakai: !sort <order>\norder: "up" bukan asc, desc, atau random\nPick one the bot knows.')
    expect(error.message).toBe('Usage: !sort <order>\norder: "up" is not one of asc, desc, random\nPick one the bot knows.')
    expect(error.issues[0].message).toBe('order: "up" is not one of asc, desc, random')
  })

  it("joins a list in the words of the locale whose catalog has the text, and each line falls back on its own", () => {
    expect(translateError(sortUsage(), t, 'ja')).toBe('Usage: !sort <order>\norder：「up」はasc、desc、またはrandomのどれでもありません\nPick one the bot knows.')
    expect(translateError(sortUsage(), t, 'fr')).toBe('Usage: !sort <order>\norder: "up" is not one of asc, desc, random\nPick one the bot knows.')
  })

  it("translates several usages under their heading, and a scope refusal without one", () => {
    expect(translateError(new MessageUsageError('!role add <who>\n!role remove <who>', []), t, 'id')).toBe('Cara pakai:\n!role add <who>\n!role remove <who>')
    const scoped = new MessageUsageError('!ban <who>', [usageIssue({ key: 'meocord.usage.serverOnly' })], { serverOnly: true })

    expect(translateError(scoped, t, 'id')).toBe('Hanya di server.')
  })

  it("translates a cooldown's wait, the store's refusal, a command not found and a fault", () => {
    expect(translateError(new CooldownError(125_000, 'user'), t, 'id')).toBe('Tunggu 2 menit 5 detik.')
    expect(translateError(new CooldownError(120_000, 'user'), t, 'id')).toBe('Tunggu 2 menit.')
    // The catalog has no text for seconds alone, which stays in English
    expect(translateError(new CooldownError(12_000, 'user'), t, 'id')).toBe('Slow down: try again in 12s.')
    expect(translateError(new CooldownStoreError(undefined, true), t, 'id')).toBe('Cooldown sedang tidak bisa dicek.')
    expect(translateError(new CommandNotFoundError(), t, 'id')).toBe('Perintah tidak ditemukan!')
    expect(translateError(new Error('socket hang up'), t, 'id')).toBe('Terjadi kesalahan.')
  })

  it("returns a guard's or a UserError's message as the app wrote it", () => {
    expect(translateError(new GuardDeniedError('Owners only.'), t, 'id')).toBe('Owners only.')
    expect(translateError(new UserError('Link your account first.'), t, 'id')).toBe('Link your account first.')
  })

  it("reads an interaction's user locale, a message's server locale, and the default in a DM", () => {
    const error = new CommandNotFoundError()
    const interaction = createMockInteraction(ChatInputCommandInteraction, { locale: 'id' as never })
    const inServer = createMockMessage({ guild: Object.assign(createMockGuild(), { preferredLocale: 'id' }) as never })
    const inDM = createMockMessage({ guild: null })

    expect([translateError(error, t, interaction), translateError(error, t, inServer), translateError(error, t, inDM)]).toEqual([
      'Perintah tidak ditemukan!',
      'Perintah tidak ditemukan!',
      'Command not found!',
    ])
  })
})
