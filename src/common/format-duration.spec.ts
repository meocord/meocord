import { ChatInputCommandInteraction } from 'discord.js'
import { cooldownMessage, CooldownError, createTranslator, formatDuration, translateError } from '@src/common/index.js'
import { registerClientTranslator } from '@src/common/meocord-text.js'
import { duration } from '@src/core/scalar-types.js'
import { createMockGuild, createMockInteraction, createMockMessage } from '@src/testing/index.js'

/** A seeded generator (mulberry32), so a property's counterexample can be replayed. */
function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** The cooldown wait text 4.2 wrote, kept as the reference cooldownMessage matches byte for byte. */
function waitText(retryAfterMs: number): string {
  const both = (big: number, bigUnit: string, small: number, smallUnit: string) =>
    small === 0 ? `${big}${bigUnit}` : `${big}${bigUnit} ${small}${smallUnit}`
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000))
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3_600) return both(Math.floor(seconds / 60), 'm', seconds % 60, 's')
  const minutes = Math.ceil(seconds / 60)
  if (minutes < 1_440) return both(Math.floor(minutes / 60), 'h', minutes % 60, 'm')
  const hours = Math.ceil(minutes / 60)
  return both(Math.floor(hours / 24), 'd', hours % 24, 'h')
}

const t = createTranslator({
  default: 'en-US',
  locales: {
    'en-US': { ping: 'Pong!' },
    ja: {
      meocord: {
        duration: {
          hour: '{count}時間',
          minute: '{count}分',
          hourLong: { other: '{count}時間' },
          minuteLong: { other: '{count}分' },
          joiner: '、',
        },
      },
    },
    ru: {
      meocord: {
        duration: {
          hourLong: { one: '{count} час', few: '{count} часа', many: '{count} часов', other: '{count} часа' },
          minuteLong: { one: '{count} минута', few: '{count} минуты', many: '{count} минут', other: '{count} минуты' },
        },
      },
    },
  },
})

describe('formatDuration', () => {
  it('writes the largest two units, narrow, in English', () => {
    expect([formatDuration(3_900_000), formatDuration(3_900_000, undefined, { style: 'long' }), formatDuration(5_400_000, undefined, { style: 'param' })]).toEqual([
      '1h 5m',
      '1 hour, 5 minutes',
      '1h30m',
    ])
    expect(formatDuration(1_000, undefined, { style: 'long' })).toBe('1 second')
  })

  it('leaves a unit whose count is 0 out, and writes a value that rounds to 0 in the smallest unit', () => {
    expect([formatDuration(3_600_000), formatDuration(3_605_000, undefined, { units: 3 }), formatDuration(0), formatDuration(0, undefined, { round: 'up' })]).toEqual([
      '1h',
      '1h 5s',
      '0s',
      '0s',
    ])
    expect(formatDuration(0, undefined, { style: 'long', smallest: 'ms' })).toBe('0 milliseconds')
  })

  it('rounds the whole value at the smallest unit shown, choosing the units again when rounding lifts it', () => {
    expect([formatDuration(3_599_500), formatDuration(3_599_500, undefined, { round: 'up' }), formatDuration(3_599_500, undefined, { round: 'nearest' })]).toEqual([
      '59m 59s',
      '1h',
      '1h',
    ])
    expect([400, 600].map(ms => ['down', 'up', 'nearest'].map(round => formatDuration(ms, undefined, { round: round as 'up' })))).toEqual([
      ['0s', '1s', '0s'],
      ['0s', '1s', '1s'],
    ])
    expect(formatDuration(5_399_999, undefined, { units: 1, round: 'nearest' })).toBe('1h')
  })

  it('shows the units between largest and smallest', () => {
    const tenDays = 10 * 86_400_000

    expect([formatDuration(tenDays), formatDuration(tenDays, undefined, { largest: 'w' }), formatDuration(1_500), formatDuration(1_500, undefined, { smallest: 'ms' })]).toEqual([
      '10d',
      '1w 3d',
      '1s',
      '1s 500ms',
    ])
    expect(formatDuration(90_061_001, undefined, { units: Infinity, smallest: 'ms' })).toBe('1d 1h 1m 1s 1ms')
    expect(formatDuration(90_061_001, undefined, { largest: 'h', units: 1 })).toBe('25h')
  })

  it.each([
    ['a negative', -1, {}],
    ['NaN', Number.NaN, {}],
    ['an infinite value', Infinity, {}],
    ['0 units', 1, { units: 0 }],
    ['a fraction of a unit', 1, { units: 1.5 }],
    ['a smallest unit larger than the largest', 1, { largest: 'm', smallest: 'h' }],
    ['an unknown unit', 1, { smallest: 'y' }],
    ['an unknown rounding', 1, { round: 'half' }],
    ['an unknown style', 1, { style: 'short' }],
  ])('refuses %s', (_label, ms, options) => {
    expect(() => formatDuration(ms, undefined, options as never)).toThrow(RangeError)
  })

  describe("style 'param'", () => {
    it('is what a {x:duration} param reads back, for any safe integer of milliseconds', () => {
      const random = seeded(491)
      const failures: number[] = []
      for (let run = 0; run < 5000; run++) {
        // Spread over every magnitude up to the largest safe integer
        const ms = Math.floor(random() * 2 ** Math.floor(random() * 54))
        for (const largest of ['d', 'w'] as const) {
          const written = formatDuration(ms, undefined, { style: 'param', units: Infinity, smallest: 'ms', largest })
          if (duration(written) !== ms) failures.push(ms)
        }
      }

      expect(failures.slice(0, 3)).toEqual([])
      expect(formatDuration(Number.MAX_SAFE_INTEGER, undefined, { style: 'param', units: Infinity, smallest: 'ms', largest: 'w' })).toBe(
        '14892855w6d8h59m991ms',
      )
      expect([duration('1h30m5s20ms'), duration('1w2d3h4m5s6ms')]).toEqual([5_405_020, 788_645_006])
      expect(formatDuration(788_645_006, undefined, { style: 'param', units: Infinity, smallest: 'ms', largest: 'w' })).toBe('1w2d3h4m5s6ms')
    })

    it('refuses a value past Number.MAX_SAFE_INTEGER, which it could not write to be read back exactly', () => {
      const all = { units: Infinity, smallest: 'ms', largest: 'w' } as const
      expect(() => formatDuration(Number.MAX_SAFE_INTEGER + 2, undefined, { ...all, style: 'param' })).toThrow(RangeError)
      expect(() => formatDuration(1e22, undefined, { style: 'param' })).toThrow(RangeError)
      // The other styles write it for people, rounded
      expect(formatDuration(1e22, undefined, { largest: 'w', units: 1 })).toBe('16534391534391w')
    })

    it('is never translated', () => {
      expect(formatDuration(3_900_000, 'ja', { style: 'param', t })).toBe('1h5m')
    })
  })

  describe('in a language', () => {
    it("reads the unit words and the long style's joiner from the locale's catalog", () => {
      expect([formatDuration(3_900_000, 'ja', { t }), formatDuration(3_900_000, 'ja', { t, style: 'long' })]).toEqual(['1時間 5分', '1時間、5分'])
    })

    it("takes a plural form the locale's rules choose, and English for a joiner the catalog lacks", () => {
      expect([2, 5, 21].map(hours => formatDuration(hours * 3_600_000 + 60_000, 'ru', { t, style: 'long' }))).toEqual([
        '2 часа, 1 минута',
        '5 часов, 1 минута',
        '21 час, 1 минута',
      ])
    })

    it("reads an interaction's user locale and a message's server locale through its app's translator", () => {
      const interaction = createMockInteraction(ChatInputCommandInteraction, { locale: 'ja' as never })
      const message = createMockMessage({ guild: Object.assign(createMockGuild(), { preferredLocale: 'ja' }) as never })
      registerClientTranslator(interaction.client, t)
      registerClientTranslator(message.client, t)
      try {
        expect([formatDuration(3_900_000, interaction, { style: 'long' }), formatDuration(3_900_000, message, { style: 'long' })]).toEqual(['1時間、5分', '1時間、5分'])
      } finally {
        registerClientTranslator(interaction.client, undefined)
        registerClientTranslator(message.client, undefined)
      }
    })

    it('is English without a translator: a locale alone, or a client of no app', () => {
      const interaction = createMockInteraction(ChatInputCommandInteraction, { locale: 'ja' as never })

      expect([formatDuration(3_900_000, 'ja', { style: 'long' }), formatDuration(3_900_000, interaction, { style: 'long' })]).toEqual([
        '1 hour, 5 minutes',
        '1 hour, 5 minutes',
      ])
    })
  })
})

describe('cooldownMessage', () => {
  it("writes the wait as 4.2 did, for the JSDoc's cases, the edges and a seeded range", () => {
    const cases = [12_000, 90_000, 86_340_000, 0, -5, 1, 999, 59_500, 3_599_500, 86_399_500, 86_400_000, 604_800_000]
    const random = seeded(4912)
    for (let run = 0; run < 20_000; run++) cases.push(Math.floor(random() * 10 ** (1 + random() * 9)))
    const differ = cases.filter(ms => cooldownMessage(ms) !== `Slow down: try again in ${waitText(ms)}.`)

    expect(differ.slice(0, 3)).toEqual([])
    expect([12_000, 90_000, 86_340_000, 0, 59_500, 3_599_500, 86_399_500].map(ms => cooldownMessage(ms))).toEqual([
      'Slow down: try again in 12s.',
      'Slow down: try again in 1m 30s.',
      'Slow down: try again in 23h 59m.',
      'Slow down: try again in 1s.',
      'Slow down: try again in 1m.',
      'Slow down: try again in 1h.',
      'Slow down: try again in 1d.',
    ])
  })

  it('says to try again later for a wait that is not a finite number, as does the text a caller is shown', () => {
    expect([cooldownMessage(Number.NaN), cooldownMessage(Infinity), cooldownMessage(-Infinity)]).toEqual([
      'Slow down: try again later.',
      'Slow down: try again later.',
      'Slow down: try again later.',
    ])
    const refusal = new CooldownError(Infinity, 'user')
    expect([refusal.message, translateError(refusal, t, 'en-US'), translateError(new CooldownError(Number.NaN, 'user'), t, 'en-US')]).toEqual([
      'Slow down: try again later.',
      'Slow down: try again later.',
      'Slow down: try again later.',
    ])
  })
})
