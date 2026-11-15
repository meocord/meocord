import { vi } from 'vitest'
import { DiscordLimits } from '@src/common/discord-limits.js'
import { splitMessage, truncate } from '@src/common/split-message.js'

/** The property run checks thousands of texts against its oracle, longer than a test's default 5 seconds on slow runners. */
const PROPERTY_TIMEOUT = 60_000

/** A seeded generator (mulberry32), so a property's counterexample can be replayed. */
function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const UNITS = ['a', 'b', 'word', ' ', '  ', '\t', 'é', 'é', '😀', '👍🏽', '🇮🇩', '👩‍💻', 'ж', '中', '`', '``', '`code`', '\\`']

/** Pieces of short texts dense in code, line ends and characters longer than a small chunk. */
const DENSE = ['a', ' ', '\t', '\n', '\r\n', '`', '``', '```', '```c++\n', '```js\n ', '\n```', '\\`', '🏽', '👍🏽', '👨‍👩‍👧', 'é', '`` a`b ``']

/** A text of lines, blank lines, long lines and code blocks, some left open, some with CR LF or lone CR line ends or inline fences. */
function sample(random: () => number, max: number): string {
  const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)]
  const line = (longest: number) => {
    let text = ''
    const length = Math.floor(random() * longest)
    while (text.length < length) text += pick(UNITS)
    return text
  }
  const lines: string[] = []
  let open: string | undefined
  for (let count = 1 + Math.floor(random() * (max >= 2000 ? 80 : 30)); count > 0; count--) {
    const kind = random()
    if (kind < 0.1) {
      if (open) lines.push(open), (open = undefined)
      else lines.push((open = '`'.repeat(3 + Math.floor(random() * 3))) + pick(['', 'ts', 'js title="x"', 'diff', 'C-Sharp', 'c++', 'a_b', 'a.b', 'a#b', 'JS', 'js ', ' js']))
    } else if (kind < 0.13) lines.push(`${line(20)}\`\`\`${line(10)}\`\`\`${line(10)}`)
    else if (kind < 0.2) lines.push(...Array.from({ length: 1 + Math.floor(random() * 4) }, () => ''))
    else if (kind < 0.23) lines.push(pick(['   ', '\t', ' \t ']))
    else lines.push(line(random() < 0.1 ? max * 2 : Math.max(1, Math.floor(max / (random() < 0.5 ? 6 : 2)))))
  }
  if (open && random() < 0.5) lines.push(open)
  const lineEnd = random()
  return lines.join(lineEnd < 0.2 ? '\r\n' : lineEnd < 0.25 ? '\r' : '\n')
}

/** Code of a text, a block or inline, read by Discord's client's rules. */
interface Block {
  start: number
  contentStart: number
  contentEnd: number
  end: number
  inline: boolean
  lang?: string
}

/**
 * The code blocks of `text` by Discord's client's rules, as the live check of 2026-11-15 found them: line ends read as
 * LF first, then at each position in order an escape, a code block, inline code. Written apart from splitMessage's
 * own reading: it reads a copy with its line ends made LF, one position at a time, and maps each place back.
 */
function blocksOf(text: string): Block[] {
  let read = ''
  // Where each character of the read copy starts in the text: a CR LF is one LF, at its CR
  const from: number[] = []
  for (let at = 0; at < text.length; at++) {
    from.push(at)
    if (text[at] === '\r' && text[at + 1] === '\n') at++
    read += text[at] === '\r' ? '\n' : text[at]
  }
  from.push(text.length)
  const blocks: Block[] = []
  for (let at = 0; at < read.length; at++) {
    const rest = read.slice(at)
    if (/^\\[^0-9A-Za-z\s]/.test(rest)) {
      at++
      continue
    }
    const block = /^```(?:([a-z0-9_+\-.#]+?)\n)?\n*([^\n][^]*?)\n*```/di.exec(rest)
    const inline = block ? null : /^(`+)([^]*?[^`])\1(?!`)/d.exec(rest)
    const found = block ?? inline
    if (found) {
      const [start, end] = found.indices![2]!
      blocks.push({
        start: from[at],
        contentStart: from[at + start],
        contentEnd: from[at + end],
        end: from[at + found[0].length],
        inline: !block,
        ...(block?.[1] !== undefined && { lang: block[1] }),
      })
      at += found[0].length - 1
    }
  }
  return blocks
}

/**
 * What a reader sees of `text`, each character not whitespace in order, with the code it is the text of, or -1
 * outside any: code's backticks and a block's language are what the reader sees as code, not its text.
 */
function seen(text: string): { char: string; block: number; inline: boolean }[] {
  const blocks = blocksOf(text)
  const out: { char: string; block: number; inline: boolean }[] = []
  let index = 0
  for (let at = 0; at < text.length; at++) {
    while (index < blocks.length && blocks[index].end <= at) index++
    const block = blocks[index]
    const within = block !== undefined && at >= block.start
    if (within && (at < block.contentStart || at >= block.contentEnd)) continue
    if (!/\s/.test(text[at])) out.push({ char: text[at], block: within ? index : -1, inline: within && block.inline })
  }
  return out
}

/**
 * Why the chunks don't show what the text shows, or `undefined` when they do: the same characters, in order, each in a
 * code block exactly where the text has it in one, every block of a chunk with text, and a chunk's block written with
 * the text block's language unless that leaves no room for its first character.
 */
function unseen(text: string, chunks: string[], max: number, prefix = false): string | undefined {
  const want = seen(text)
  const textBlocks = blocksOf(text)
  // A block with no text the text has of its own stays; a cut makes none
  const blank = (of: string) => blocksOf(of).filter(block => !block.inline && of.slice(block.contentStart, block.contentEnd).trim() === '').length
  if (chunks.reduce((sum, chunk) => sum + blank(chunk), 0) > blank(text)) return 'a cut made a block with no text'
  let at = 0
  for (const [index, chunk] of chunks.entries()) {
    const blocks = blocksOf(chunk)
    const got = seen(chunk)
    for (const [offset, { char, block, inline }] of got.entries()) {
      const expected = want[at + offset]
      if (!expected || expected.char !== char) return `chunk ${index} shows ${JSON.stringify(char)} where the text shows ${JSON.stringify(expected?.char)}`
      const kind = (shown: { block: number; inline: boolean }) => (shown.block === -1 ? 'text' : shown.inline ? 'inline code' : 'a block')
      if (kind(expected) !== kind({ block, inline })) return `chunk ${index} shows ${JSON.stringify(char)} as ${kind({ block, inline })}, where the text has ${kind(expected)}`
      if (block !== -1 && !inline && (offset === 0 || got[offset - 1].block !== block)) {
        const original = textBlocks[expected.block]
        const written = blocks[block].lang
        if (written !== undefined && written !== original.lang) return `chunk ${index} writes the language ${written}`
        const full = 3 + (original.lang?.length ?? 0) + 1 + [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(chunk.slice(blocks[block].contentStart))][0].segment.length + 4
        if (written === undefined && original.lang !== undefined && full <= max) return `chunk ${index} drops the language ${original.lang} it has room for`
      }
    }
    at += got.length
  }
  return at === want.length || prefix ? undefined : `the chunks show ${at} of the text's ${want.length} characters`
}

/** Whether the chunks cut a character a reader sees as one where a chunk could hold it whole. */
function cutThrough(text: string, chunks: string[], max: number): string | undefined {
  const whole = new Set([...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map(({ segment }) => segment))
  for (const chunk of chunks) {
    for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(chunk)) {
      if (whole.has(segment) || segment.length === 1) continue
      // A piece of a longer character: the whole one must be too long for any chunk, fences included
      const of = [...whole].find(grapheme => grapheme.startsWith(segment) || grapheme.endsWith(segment))
      if (of && of.length + 8 <= max) return `a chunk holds ${JSON.stringify(segment)} of ${JSON.stringify(of)}`
    }
  }
  return undefined
}

describe('splitMessage', () => {
  it('splits at line breaks into chunks of 2000 characters at most, cutting a longer line', () => {
    const line = 'a'.repeat(1500)
    expect(splitMessage(`${line}\n${line}`)).toEqual([line, line])
    expect(splitMessage('b'.repeat(4100)).map(part => part.length)).toEqual([2000, 2000, 100])
    expect(splitMessage('one\ntwo')).toEqual(['one\ntwo'])
  })

  it.each([
    ['an emoji', '😀'],
    ['a flag', '🇯🇵'],
    ['a joined emoji', '👩‍💻'],
    ['a letter with a combining accent', 'é'],
  ])('cuts a long line before %s at the limit, never through it', (_label, character) => {
    expect(splitMessage(`${'a'.repeat(1999)}${character}b`)).toEqual(['a'.repeat(1999), `${character}b`])
  })

  it('cuts a single character longer than a chunk between code points', () => {
    expect(splitMessage(`e${'́'.repeat(2500)}`).map(part => part.length)).toEqual([2000, 501])
    // Variation selectors are astral, so the limit falls inside a surrogate pair: the cut moves before it
    const astral = splitMessage(`a${'\u{E0100}'.repeat(1500)}`)
    expect(astral.map(part => part.length)).toEqual([1999, 1002])
    expect(astral.join('')).toBe(`a${'\u{E0100}'.repeat(1500)}`)
  })

  it('leaves out a chunk of only whitespace, and gives nothing for a blank text', () => {
    expect(splitMessage(`${'x'.repeat(1990)}\n${'y'.repeat(9)}\n   \n`)).toEqual([`${'x'.repeat(1990)}\n${'y'.repeat(9)}`])
    expect(splitMessage('  \n\n ')).toEqual([])
    expect(splitMessage('')).toEqual([])
  })

  it('splits to the max it is given', () => {
    expect(splitMessage('one two three', { max: 7 })).toEqual(['one two', 'three'])
  })

  it('moves a code block whose opening line would end a chunk to the next one, rather than closing it with no text', () => {
    expect(splitMessage('ab\n```ts\ncdef\n```', { max: 12 })).toEqual(['ab', '```ts\ncd\n```', '```ts\nef\n```'])
  })

  it('closes a block with the first three backticks of a longer run, as Discord reads it, the rest its text', () => {
    expect(splitMessage('```\na\nb\n`````', { max: 11 })).toEqual(['```\na\nb\n```', '``'])
  })

  // The help reply split with a splitter of its own, which cut these two where the rest are byte-identical
  describe('where the help reply split differently', () => {
    it('breaks a line longer than a chunk at its last whitespace, not its last character', () => {
      const words = `${'a'.repeat(1990)} ${'b'.repeat(20)}`

      expect(splitMessage(words)).toEqual(['a'.repeat(1990), 'b'.repeat(20)])
    })

    it('closes a code block cut across chunks and reopens it with its opening line', () => {
      const code = ['```ts', 'a'.repeat(1500), 'b'.repeat(1500), '```'].join('\n')

      expect(splitMessage(code)).toEqual([['```ts', 'a'.repeat(1500), '```'].join('\n'), ['```ts', 'b'.repeat(1500), '```'].join('\n')])
    })
  })

  it('reopens a code block with its backticks alone when its opening line leaves no room, the fences counted in max', () => {
    // The emoji is two characters long, so "```ts" and it and the closing fence take 12
    expect(splitMessage('```ts\na\n😀\n```', { max: 11 })).toEqual(['```ts\na\n```', '```\n😀\n```'])
  })

  it('names the smallest max a code block cut across chunks needs', () => {
    // Four backticks open with their first three, so the block's text starts with the fourth
    const code = '````\nabcdef\n````'

    expect(() => splitMessage(code, { max: 8 })).toThrow(new RangeError(
      "splitMessage can't fit code's backticks and its text into chunks of 8 characters; this text needs a max of at least 9.",
    ))
    expect(splitMessage(code, { max: 9 })).toEqual(['````\n```', '```\na\n```', '```\nb\n```', '```\nc\n```', '```\nd\n```', '```\ne\n```', '```\nf\n```', '`'])
  })

  describe("reads code blocks as Discord's client does, not line by line", () => {
    it('takes a block a line opens and closes as text, with no fence added at a cut', () => {
      const text = `\`\`\`!help\`\`\`, or type:\n${'a'.repeat(30)}\n${'b'.repeat(30)}`

      expect(splitMessage(text, { max: 40 })).toEqual(['```!help```, or type:', 'a'.repeat(30), 'b'.repeat(30)])
    })

    it('closes and reopens a block that opens inside a line, with its language', () => {
      expect(splitMessage('see ```ts\nconst a = 1\nconst b = 2\n``` done', { max: 26 })).toEqual(['see ```ts\nconst a = 1\n```', '```ts\nconst b = 2\n``` done'])
    })

    it('adds no fence for three backticks nothing closes, nor for those inline code or a backslash hides', () => {
      expect(splitMessage('```ts\naaaa\nbbbb', { max: 10 })).toEqual(['```ts\naaaa', 'bbbb'])
      expect(splitMessage('`a```b`\n```x', { max: 7 })).toEqual(['`a```b`', '```x'])
      expect(splitMessage('\\```a\nb```', { max: 7 })).toEqual(['\\```a', 'b```'])
    })

    it('reads a language only as a word ending the opening line, so other text after the backticks stays the block\'s', () => {
      expect(splitMessage('```js title="x"\nconst a = 1\nconst b = 2\n```', { max: 31 })).toEqual(['```js title="x"\nconst a = 1\n```', '```\nconst b = 2\n```'])
    })

    it('reads a block with CRLF line ends, never cutting its fence', () => {
      const chunks = splitMessage('```ts\r\nconst a = 1\r\nconst b = 2\r\n```', { max: 22 })

      expect(chunks.every(chunk => chunk.length <= 22 && (chunk.match(/```/g) ?? []).length === 2)).toBe(true)
      expect(unseen('```ts\r\nconst a = 1\r\nconst b = 2\r\n```', chunks, 22)).toBeUndefined()
    })

    it('writes the fence afresh, dropping the language, when a chunk starting at it has no room for its first character', () => {
      expect(splitMessage('```ts\n👍🏽\n`\n🇮🇩\n\n\n\n\n```', { max: 12 })).toEqual(['```\n👍🏽\n```', '```ts\n`\n```', '```\n🇮🇩\n```'])
    })

    // Rows of the live check of 2026-11-15: texts posted to Discord and read from the web client's DOM
    describe('as the live check of 2026-11-15 found it', () => {
      it('reads CR LF and a lone CR as line ends, so the word before one is a language, kept on reopening', () => {
        expect(splitMessage('```ts\r\nconst a = 1\r\nconst b = 2\r\n```', { max: 22 })).toEqual(['```ts\r\nconst a = 1\n```', '```ts\nconst b = 2\r\n```'])
        expect(splitMessage('```js\rlet a = 1\rlet b = 2\r```', { max: 18 })).toEqual(['```js\rlet a =\n```', '```js\n1\n```', '```js\nlet b =\n```', '```js\n2\r```'])
      })

      it.each([
        ['```c++\nint a = 1;\nint b = 2;\n```', 22, ['```c++\nint a = 1;\n```', '```c++\nint b = 2;\n```']],
        ['```a_b\nx = 1\ny = 2\n```', 16, ['```a_b\nx = 1\n```', '```a_b\ny = 2\n```']],
        ['```a.b\nx = 1\ny = 2\n```', 16, ['```a.b\nx = 1\n```', '```a.b\ny = 2\n```']],
        ['```a#b\nx = 1\ny = 2\n```', 16, ['```a#b\nx = 1\n```', '```a#b\ny = 2\n```']],
      ])('reads %j as a block with a language, kept on reopening', (text, max, chunks) => {
        expect(splitMessage(text, { max })).toEqual(chunks)
      })

      it.each(['c++', 'c#', 'objective_c', 'node.js'])('never cuts right after the language line of a ```%s block', lang => {
        const chunks = splitMessage(`\`\`\`${lang}\n${'x'.repeat(3000)}\n\`\`\``)

        expect(chunks.map(chunk => [chunk.slice(0, lang.length + 4), chunk.length])).toEqual([
          [`\`\`\`${lang}\n`, 2000],
          [`\`\`\`${lang}\n`, 3000 + 2 * (lang.length + 8) - 2000],
        ])
      })

      it('reads three backticks, line ends and three backticks as inline code, not a block', () => {
        expect(splitMessage('```\n\n\n\n\n\n```', { max: 10 })).toEqual(['```\n\n\n\n```'])
      })
    })

    it('gives no chunk a block with no text, its blank lines dropped at the cut', () => {
      expect(splitMessage('```ts\n\n\n\n\n\n\n\nx\n```', { max: 12 })).toEqual(['```ts\nx\n```'])
      expect(splitMessage('````\n\n\n\n\n````', { max: 12 })).toEqual(['````\n\n\n\n\n```', '`'])
    })
  })

  it('never parts an escape from the character it escapes', () => {
    expect(splitMessage('ab\\`cd', { max: 3 })).toEqual(['ab', '\\`c', 'd'])
  })

  it('cuts nowhere that pairs backticks the text leaves alone, nor inside a run of backticks in inline code', () => {
    // Cut after `a`, the first chunk would read `a` as inline code
    expect(splitMessage('`a``b c d e f g', { max: 4 })).toEqual(['`a``', 'b c', 'd e', 'f g'])
    expect(splitMessage('`a``b', { max: 3 })).toEqual(['`a', '``b'])
    expect(splitMessage('`` x ```` y ``', { max: 10 })).toEqual(['`` x``', '`` ```` ``', '``y ``'])
    expect(() => splitMessage('`` x ```` y ``', { max: 8 })).toThrow('needs a max of at least 10')
  })

  it('closes and reopens inline code with its own backticks, a space between them and a backtick of its text', () => {
    expect(splitMessage('`` a `b` c ``', { max: 9 })).toEqual(['`` a``', '`` `b` ``', '``c ``'])
  })

  it('keeps a block the text leaves blank, and drops indentation only where it leaves a character no room', () => {
    expect(splitMessage('```\n  \n```', { max: 9 })).toEqual(['```\n \n```'])
    expect(splitMessage('```ts\n\tx\n```', { max: 10 })).toEqual(['```\n\tx\n```'])
    expect(splitMessage('```\n\t👍🏽\n```', { max: 12 })).toEqual(['```\n👍🏽\n```'])
    // A word and blank lines after the backticks are a block whose text is the word, read the same in a shorter chunk
    expect([splitMessage('```js\n\n\n\n\n\n\n```', { max: 10 }), splitMessage('```C-Sharp\n\n\n\n\n```', { max: 17 })]).toEqual([['```js\n\n```'], ['```C-Sharp\n\n\n\n```']])
  })

  it('reads a character of any length whole, so a block drops its language for one that fits only without it', () => {
    const long = `e${'\u0301'.repeat(40)}`

    expect(splitMessage(`\`\`\`javascript\n${long}\n\`\`\``, { max: 50 })).toEqual([`\`\`\`\n${long}\n\`\`\``])
  })

  it("keeps the language where the block's own fence, right after its last character, leaves room for it", () => {
    expect(splitMessage('```js\naa b```', { max: 10 })).toEqual(['```\naa\n```', '```js\nb```'])
  })

  it('writes inline code afresh past its blank lines when a chunk starting at its backticks has no room', () => {
    expect(splitMessage('``\n\n\n\n\n\n\n\nab``', { max: 8 })).toEqual(['``ab``'])
  })

  it('keeps the language where a character cut between its code points leaves room for it', () => {
    expect(splitMessage('```a\n👩‍💻\n```', { max: 12 })).toEqual(['```a\n👩‍\n```', '```a\n💻\n```'])
  })

  it('drops a CRLF line end and CRLF blank lines at a cut whole, and a run of whitespace inside a line', () => {
    expect([splitMessage('ab\r\ncd', { max: 3 }), splitMessage('a\r\n\r\n\r\nb', { max: 3 }), splitMessage('abc   def', { max: 4 })]).toEqual([
      ['ab', 'cd'],
      ['a', 'b'],
      ['abc', 'def'],
    ])
    expect(splitMessage('``a b\r\n\r\n\r\nc d``', { max: 9 })).toEqual(['``a b\r\n``', '``c d``'])
  })

  it.each([0, -1, 1.5, Number.NaN])('refuses a max of %s', max => {
    expect(() => splitMessage('text', { max })).toThrow(RangeError)
  })

  it('gives way on a language or a leading space where keeping them leaves no cut, so a larger max still splits', () => {
    const text = '🏽```c++\n 👨‍👩👧```'

    expect(() => splitMessage(text, { max: 9 })).toThrow('needs a max of at least 10')
    expect(splitMessage(text, { max: 12 })).toEqual(['🏽', '```\n 👨‍\n```', '```\n👩👧```'])
  })

  it("drops a block's indentation before its language where a character leaves room for one of them", () => {
    const grapheme = 'e' + '́'.repeat(5)

    expect(splitMessage('```py\n ' + grapheme + '```', { max: 11 })).toEqual(['```py\ne\n```', '```py\ń\n```', '```\ń́́́```'])
    expect(splitMessage('```py\n  ' + grapheme + '```', { max: 11 })).toEqual(['```py\ne\n```', '```py\ń\n```', '```\ń́́́```'])
    expect(splitMessage('```py\n  ' + grapheme + '```', { max: 12 })).toEqual(['```py\né\n```', '```\ń́́́```'])
    expect(splitMessage('```py\nx\n ' + grapheme + '```', { max: 11 })).toEqual(['```py\nx\n```', '```py\ne\n```', '```py\ń\n```', '```\ń́́́```'])
  })

  it('splits at every max from the smallest it names up to the text length, over seeded code-dense texts', () => {
    const random = seeded(4915)
    const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)]
    const failures: { text: string; max: number; problem: string }[] = []
    for (let run = 0; run < 1500; run++) {
      let text = ''
      for (let count = 1 + Math.floor(random() * 12); count > 0; count--) text += pick(DENSE)
      const named: (number | undefined)[] = [undefined]
      for (let max = 1; max <= text.length; max++) {
        try {
          splitMessage(text, { max })
          named.push(0)
        } catch (error) {
          named.push(Number(/at least (\d+)/.exec((error as Error).message)?.[1]))
        }
      }
      const smallest = named.indexOf(0)
      for (let max = 1; max <= text.length; max++) {
        if (named[max] === 0 && max < text.length && named[max + 1] !== 0) failures.push({ text, max, problem: 'refused at max + 1' })
        if (named[max] !== 0 && named[max] !== smallest) failures.push({ text, max, problem: `names ${named[max]}, splits at ${smallest}` })
      }
      if (smallest === -1) failures.push({ text, max: text.length, problem: 'refused at its own length' })
    }

    expect(failures.slice(0, 1)).toEqual([])
  }, PROPERTY_TIMEOUT)

  it('keeps every property over seeded texts and maxes', () => {
    const random = seeded(490)
    const failures: { text: string; max: number; problem: string }[] = []
    let checked = 0
    for (let run = 0; run < 3000; run++) {
      const max = [2000, 200, 60, 20, 12][Math.floor(random() * 5)] - Math.floor(random() * 4)
      const text = sample(random, max)
      let chunks: string[]
      try {
        chunks = splitMessage(text, { max })
      } catch (error) {
        const needed = Number(/at least (\d+)/.exec((error as Error).message)?.[1])
        const smallest = (() => {
          try {
            splitMessage(text, { max: needed })
          } catch {
            return false
          }
          try {
            splitMessage(text, { max: needed - 1 })
            return false
          } catch {
            return true
          }
        })()
        if (!(error instanceof RangeError) || !smallest) failures.push({ text, max, problem: `RangeError naming ${needed}` })
        continue
      }
      checked++
      const problem =
        (chunks.some(chunk => chunk.trim() === '') && 'a blank chunk') ||
        (chunks.some(chunk => chunk.length > max) && 'a chunk over max') ||
        (chunks.some(chunk => /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(chunk)) && 'a lone surrogate') ||
        unseen(text, chunks, max) ||
        cutThrough(text, chunks, max)
      if (problem) failures.push({ text, max, problem })
    }

    expect({ checked: checked > 2000, failures: failures.slice(0, 1) }).toEqual({ checked: true, failures: [] })
  }, PROPERTY_TIMEOUT)
})

describe('work', () => {
  // Counted, not timed: twice the text may read this many times as much, which work linear in it stays under
  const LINEAR = 2.2
  /** The characters the grapheme segmenter reads while `run` runs. */
  const segmented = (run: () => unknown) => {
    const segment = vi.spyOn(Intl.Segmenter.prototype, 'segment')
    try {
      try {
        run()
      } catch {
        // A refusal still reads the text
      }
      return segment.mock.calls.reduce((sum, [read]) => sum + read.length, 0)
    } finally {
      segment.mockRestore()
    }
  }

  it.each([
    ['in a code block', (length: number) => `\`\`\`\n${'e'}${'́'.repeat(length)}\n\`\`\``],
    ['as text', (length: number) => `e${'́'.repeat(length)}`],
  ])('reads a character longer than any chunk %s once, not once per chunk', (_where, text) => {
    // Lengths of many chunks each, so a last short chunk weighs little
    for (const [max, length] of [[2000, 20_000], [60, 5000], [1, 5000]] as const) {
      const reads = [length, 2 * length].map(each => segmented(() => splitMessage(text(each), { max })))

      expect({ max, ratio: reads[1] / reads[0] < LINEAR }).toEqual({ max, ratio: true })
    }
    const truncated = [5000, 10_000].map(length => segmented(() => truncate(text(length), 60)))
    expect(truncated[1] / truncated[0]).toBeLessThan(LINEAR)
  })
})

describe('truncate', () => {
  it('gives a text that fits unchanged', () => {
    expect(truncate('short', 5)).toBe('short')
  })

  it('cuts at the last whitespace in the last fifth of max, dropping whitespace before the ellipsis', () => {
    expect(truncate('one two three four', 15)).toBe('one two three…')
    // Whitespace before the last fifth: cut after the last character that fits
    expect(truncate('one two three four', 10)).toBe('one two t…')
  })

  it('cuts after the last character that fits, never through one', () => {
    expect(truncate(`ab${'🇯🇵'}cd`, 4)).toBe('ab…')
    expect(truncate('abcdef', 4, '...')).toBe('a...')
  })

  it('gives the ellipsis alone where the first character is too long to fit, cutting no character', () => {
    const grapheme = (length: number) => 'e' + '́'.repeat(length - 1)

    expect(truncate(`${grapheme(3000)} tail`, 2000)).toBe('…')
    expect(truncate(`${grapheme(80)} tail`, 60)).toBe('…')
  })

  it('closes a code block it cuts open before the ellipsis, the fence counted in max', () => {
    const result = truncate('```ts\nconst a = 1\nconst b = 2\n```', 24)

    expect(result).toBe('```ts\nconst a = 1\n```\n…')
    expect(result.length).toBeLessThanOrEqual(24)
  })

  it('backs off before a code block whose opening line it would cut', () => {
    expect(truncate('```ts\nconst a = 1\n```', 9)).toBe('…')
    expect(truncate('see ```ts\nconst a = 1\n```', 12)).toBe('see…')
  })

  it('never turns a language into a block\'s text, as a block whose language has no text after it reads (live check of 2026-11-15)', () => {
    expect(truncate('```a_b\nx = 1\ny = 2\n```', 13)).toBe('…')
    expect(truncate('```a_b\nx = 1\ny = 2\n```', 14)).toBe('```a_b\nx\n```\n…')
  })

  it('closes a CRLF code block it cuts', () => {
    expect(truncate('```ts\r\nconst a = 1\r\nconst b = 2\r\n```', 22)).toBe('```ts\r\nconst a =\n```\n…')
  })

  it('closes inline code it cuts with its own backticks, after a space where the code ends with a backtick', () => {
    expect(truncate('run `npm install meocord` now', 14)).toBe('run `npm ins`…')
    expect(truncate('a ``x `y` z`` b', 13)).toBe('a ``x `y` ``…')
    expect(truncate('a ``x `y` z`` b', 10)).toBe('a ``x``…')
  })

  it('never parts an escape, leaves a backslash to escape the ellipsis, or pairs backticks the text leaves alone', () => {
    expect(truncate('ab \\`cd', 5)).toBe('ab…')
    expect(truncate('abc\\def', 5)).toBe('abc…')
    expect(truncate('`a``b c d e f g', 4)).toBe('`a…')
    // Never inside a run of backticks in inline code, as splitMessage never cuts there
    expect(truncate('`` x ```` y ``', 12)).toBe('`` x``…')
  })

  it('refuses a max shorter than the ellipsis', () => {
    expect(() => truncate('text', 2, '...')).toThrow(RangeError)
  })

  it('keeps every property over seeded texts and maxes', () => {
    const random = seeded(491)
    const failures: { text: string; max: number; ellipsis: string; problem: string }[] = []
    for (let run = 0; run < 3000; run++) {
      const max = [2000, 200, 60, 20, 12][Math.floor(random() * 5)] - Math.floor(random() * 4)
      const ellipsis = ['…', '...', ''][Math.floor(random() * 3)]
      const text = sample(random, max)
      const result = truncate(text, max, ellipsis)
      const kept = result.slice(0, result.length - ellipsis.length)
      const problem =
        (text.length <= max && result !== text && 'a text that fits changed') ||
        (text.length > max &&
          ((result.length > max && 'a result over max') ||
            (!result.endsWith(ellipsis) && 'no ellipsis') ||
            (/[\ud800-\udbff]$/.test(kept) && 'a lone surrogate') ||
            unseen(text, [kept], max, true) ||
            // With no code or escape to back off from, the cut reaches the last fifth of max or the last character in room
            (!/[`\\]/.test(text) && seen(kept).length < seen(text.slice(0, Math.max(0, Math.floor(Math.min(max * 0.8, max - ellipsis.length)) - 8))).length && 'cut too early') ||
            cutThrough(text, [kept], Number.POSITIVE_INFINITY)))
      if (problem) failures.push({ text, max, ellipsis, problem })
    }

    expect(failures.slice(0, 1)).toEqual([])
  }, PROPERTY_TIMEOUT)
})

describe('DiscordLimits', () => {
  it("is frozen, with Discord's message and customId limits", () => {
    expect(Object.isFrozen(DiscordLimits)).toBe(true)
    expect({ content: DiscordLimits.content, customId: DiscordLimits.customId }).toEqual({ content: 2000, customId: 100 })
  })
})
