import { vi } from 'vitest'
import { restFrom, splitFlagWords, splitWords } from '@src/core/message-words.js'

const values = (text: string) => splitFlagWords(text).words.map(word => word.value)

describe('splitFlagWords', () => {
  it('takes out --name and --name=value, keeping the words and where each starts', () => {
    const text = 'purge 50 --bots --from=<@1> now'
    expect(splitFlagWords(text)).toEqual({
      words: [
        { value: 'purge', start: 0 },
        { value: '50', start: 6 },
        { value: 'now', start: 28 },
      ],
      flags: [
        { name: 'bots', value: undefined, at: 2 },
        { name: 'from', value: '<@1>', at: 2 },
      ],
      cuts: [9, 15, 16, 27],
    })
  })

  it('reads a value in straight or curly quotes as one, and an empty value as empty', () => {
    expect(splitFlagWords('remind --note="buy milk" 10m --tag=“two words” --x=').flags).toEqual([
      { name: 'note', value: 'buy milk', at: 1 },
      { name: 'tag', value: 'two words', at: 2 },
      { name: 'x', value: '', at: 2 },
    ])
    expect(splitFlagWords('--note="never closed').flags).toEqual([{ name: 'note', value: '"never', at: 0 }])
  })

  it('reads as words what is not a flag: quoted words, a bare --, a name not starting with a letter, and punctuation after a name', () => {
    for (const text of ['"--bots" here', '-- dash', '---x', '--9lives', '--bots!', '-x', 'a--b']) {
      expect(splitFlagWords(text)).toEqual({ words: splitWords(text), flags: [], cuts: [] })
    }
    expect(values('"--bots" here')).toEqual(['--bots', 'here'])
  })
})

describe('scanning cost', () => {
  it('reads unclosed quotes in steps that grow with the text, as it does for plain words', () => {
    // A step is a character code read; counting them measures the work, whatever else the machine is doing
    const stepsOf = (read: (text: string) => unknown, text: string) => {
      const reads = vi.spyOn(String.prototype, 'charCodeAt')
      try {
        read(text)
        return reads.mock.calls.length
      } finally {
        reads.mockRestore()
      }
    }
    for (const read of [splitWords, splitFlagWords]) {
      const steps = stepsOf(read, '"a '.repeat(2_000))
      // Were each quote to look for its closer to the end, doubling the text would four-fold the steps
      expect(stepsOf(read, '"a '.repeat(4_000)) / steps).toBeLessThan(2.5)
      expect(steps).toBeLessThan(4 * '"a '.repeat(2_000).length)
    }
  })
})

describe('restFrom', () => {
  it('cuts the rest from a word, leaving out each flag with the space before it and keeping the rest as typed', () => {
    const text = 'note buy  milk --pin now --x=1'
    const { words, cuts } = splitFlagWords(text)
    expect(restFrom(text, words[1].start, cuts)).toBe('buy  milk now')
    const lines = 'say one\n--loud\ntwo\n\nthree --x'
    const split = splitFlagWords(lines)
    expect(restFrom(lines, split.words[1].start, split.cuts)).toBe('one\ntwo\n\nthree')
    expect(restFrom(text, words[3].start, cuts)).toBe('now')
    expect(restFrom('say   "spaced  out"  words  ', 6, [])).toBe('"spaced  out"  words')
  })
})

/*
 * A reference scan that rebuilds the text without its flags before splitting it into words: the plain
 * definition the single pass must agree with, for the flags and the words. A word's rest is the text from
 * it with each later flag and the space before it removed.
 */
function rebuiltScan(text: string) {
  const isSpace = (at: number) => /\s/.test(text[at] ?? '')
  const quoteEnd = (at: number) => {
    const closers = ({ '"': ['"', '”'], '“': ['”', '"'] } as Record<string, string[]>)[text[at]]
    if (!closers) return -1
    let end = at + 1
    while (end < text.length && !(closers.includes(text[end]) && (end + 1 === text.length || isSpace(end + 1)))) end++
    return end < text.length ? end : -1
  }
  const flags: { name: string; value: string | undefined; at: number }[] = []
  const spans: [number, number][] = []
  const starts: number[] = []
  const kept: string[] = []
  let from = 0
  let i = 0
  while (i < text.length) {
    if (isSpace(i)) {
      i++
      continue
    }
    const start = i
    const quoted = quoteEnd(i)
    if (quoted !== -1) {
      starts.push(start)
      i = quoted + 1
      continue
    }
    const flag = /^--([A-Za-z]\w*)(?=$|\s|=)/.exec(text.slice(i))
    if (flag) {
      let j = i + flag[0].length
      let value: string | undefined
      if (text[j] === '=') {
        const end = quoteEnd(j + 1)
        if (end !== -1) {
          value = text.slice(j + 2, end)
          j = end + 1
        } else {
          const valueStart = ++j
          while (j < text.length && !isSpace(j)) j++
          value = text.slice(valueStart, j)
        }
      }
      flags.push({ name: flag[1], value, at: starts.length })
      spans.push([start, j])
      kept.push(text.slice(from, start))
      from = i = j
      continue
    }
    starts.push(start)
    while (i < text.length && !isSpace(i)) i++
  }
  kept.push(text.slice(from))
  const stripped = flags.length === 0 ? text : kept.map(part => part.trim()).filter(Boolean).join(' ')
  const words = splitWords(stripped)
  const restOf = (from: number) =>
    spans
      .filter(([s]) => s >= from)
      .reduceRight((rest, [s, e]) => rest.slice(0, s - from).replace(/\s+$/, '') + rest.slice(e - from), text.slice(from))
      .trimEnd()
  return { flags, words: words.map(word => word.value), rests: starts.map(restOf) }
}

/** A small seeded generator (mulberry32), so a failure reproduces from its seed. */
function random(seed: number) {
  let state = seed >>> 0
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return { next, pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] }
}

const PIECES = [
  'roll',
  '20',
  'milk',
  '<@1>',
  '"two words"',
  '“curly words”',
  '"open',
  'close"',
  '--bots',
  '--from=<@2>',
  '--note="buy milk"',
  '--tag=“a b”',
  '--x=',
  '--9',
  '--',
  '---y',
  'a--b',
  '"--quoted"',
  '--Bots!',
]

describe('splitFlagWords against the text-rebuilding scan', () => {
  it('gives the same flags, words and rest from each word, on random messages', () => {
    let compared = 0
    for (let seed = 1; seed <= 3000; seed++) {
      const r = random(seed)
      const length = Math.floor(r.next() * 8)
      const pieces = Array.from({ length }, () => r.pick(PIECES))
      const text = pieces.join(r.pick([' ', ' ', '  ', '\t', ' \n ']))
      const expected = rebuiltScan(text)
      const actual = splitFlagWords(text)
      const rests = actual.words.map(word => restFrom(text, word.start, actual.cuts))
      expect([seed, text, actual.flags, actual.words.map(word => word.value), rests]).toEqual([
        seed,
        text,
        expected.flags,
        expected.words,
        expected.rests,
      ])
      compared++
    }
    expect(compared).toBe(3000)
  })
})
