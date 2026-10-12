import { duration, number } from '@src/core/scalar-types.js'

// Long enough that a pattern quadratic in a word's length takes far longer than the bound to refuse it
const LONG_DIGITS = 20_000
// Generous next to the microseconds a linear pattern takes, so a slow machine stays well inside it
const LINEAR_BOUND_MS = 50

const elapsedMs = (read: () => unknown): { value: unknown; ms: number } => {
  const started = performance.now()
  const value = read()
  return { value, ms: performance.now() - started }
}

describe('number and duration words', () => {
  // word, as number, as int, as duration
  const WORDS: [string, number | undefined, number | undefined, number | undefined][] = [
    ['', undefined, undefined, undefined],
    ['12', 12, 12, undefined],
    ['-12', -12, -12, undefined],
    ['-0', -0, -0, undefined],
    ['1.', 1, undefined, undefined],
    ['1.5', 1.5, undefined, undefined],
    ['.5', 0.5, undefined, undefined],
    ['-.5', -0.5, undefined, undefined],
    ['1e3', 1000, undefined, undefined],
    ['1E3', 1000, undefined, undefined],
    ['1.e3', 1000, undefined, undefined],
    ['+1.5e-3', 0.0015, undefined, undefined],
    ['9007199254740993', 9007199254740992, undefined, undefined],
    ['.', undefined, undefined, undefined],
    ['+', undefined, undefined, undefined],
    ['1e', undefined, undefined, undefined],
    ['1e3.5', undefined, undefined, undefined],
    ['1e33333', undefined, undefined, undefined],
    ['0x10', undefined, undefined, undefined],
    [' 12', undefined, undefined, undefined],
    ['Infinity', undefined, undefined, undefined],
    ['0s', undefined, undefined, 0],
    ['1ms', undefined, undefined, 1],
    ['90s', undefined, undefined, 90_000],
    ['1M', undefined, undefined, 60_000],
    ['1m5s', undefined, undefined, 65_000],
    ['1h30m', undefined, undefined, 5_400_000],
    ['1H30M', undefined, undefined, 5_400_000],
    ['1.5d', undefined, undefined, 129_600_000],
    ['2w', undefined, undefined, 1_209_600_000],
    ['.5h', undefined, undefined, undefined],
    ['1.s', undefined, undefined, undefined],
    ['1.5.5s', undefined, undefined, undefined],
    ['1msms', undefined, undefined, undefined],
    ['5m30', undefined, undefined, undefined],
    ['1h-30m', undefined, undefined, undefined],
    ['1İs', undefined, undefined, undefined],
    ['1.'.repeat(2_000) + 'x', undefined, undefined, undefined],
  ]

  it('reads each word as the same value', () => {
    for (const [word, asNumber, asInt, asDuration] of WORDS) {
      expect(number(word, false), word).toBe(asNumber)
      expect(number(word, true), word).toBe(asInt)
      expect(duration(word), word).toBe(asDuration)
    }
  })

  it.each([
    ['number', (word: string) => number(word, false)],
    ['duration', duration],
  ])('refuses a long run of digits as a %s in time linear in its length', (_type, read) => {
    const word = '1'.repeat(LONG_DIGITS) + 'x'
    const { value, ms } = elapsedMs(() => read(word))

    expect(value).toBeUndefined()
    expect(ms).toBeLessThan(LINEAR_BOUND_MS)
  })
})
