import { DiscordLimits } from '@src/common/discord-limits.js'

/** What a backslash escapes: anything but a letter, a digit or whitespace, which Discord then shows as it is. */
const ESCAPE = /\\[^0-9A-Za-z\s]/y
/** A character of a code block's language: a letter, a digit or one of `_ + - . #`. */
const LANGUAGE = /[a-z0-9_+\-.#]/i
/** The backticks that open and close a code block. */
const FENCE = '```'
/** What closes a code block a cut leaves open, on a line of its own. */
const CLOSING = `\n${FENCE}`
/** A grapheme that is one whitespace character, where a line longer than a chunk prefers to break. */
const WHITESPACE = /^\s$/u
/** How far into `max` a cut must reach to break at whitespace when truncating: the last fifth of it. */
const TRUNCATE_WHITESPACE_REACH = 4 / 5
/** How far past a chunk's end the text is read to see where its last character ends; read further for a longer one. */
const GRAPHEME_WINDOW = 32

// Built on first use
let segmenter: Intl.Segmenter | undefined
/** The characters a reader sees as one, such as an emoji, a flag or a letter with its accent. */
const graphemes = (text: string) => (segmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' })).segment(text)

/**
 * The characters a reader sees as one in `text` from `start` that start within `reach` of it, each whole, but for one
 * that ends past `limit` of `start`: no caller can use it, so it is left out unread rather than read to its end, and
 * a character longer than any chunk costs each chunk only its `limit`.
 */
function graphemesWithin(text: string, start: number, reach: number, limit: number): { index: number; segment: string }[] {
  for (let window = reach + GRAPHEME_WINDOW; ; window *= 2) {
    const end = Math.min(text.length, start + window)
    const found: { index: number; segment: string }[] = []
    let whole = true
    for (const { index, segment } of graphemes(text.slice(start, end))) {
      if (index > reach) break
      // One that reaches the window's end may go on past it
      if (start + index + segment.length === end && end < text.length) {
        if (index + segment.length > limit) return found
        whole = false
        break
      }
      found.push({ index, segment })
    }
    if (whole) return found
  }
}

/** A line end as Discord's client reads one: LF, or CR alone or before LF. */
const isLineEnd = (char: string | undefined) => char === '\n' || char === '\r'

/**
 * Code in a text, a block or inline: where its opening backticks start, its text starts, its closing backticks start
 * and end; where its text ends but for whitespace; a block's language, or inline code's run of backticks.
 */
interface Block {
  start: number
  contentStart: number
  contentEnd: number
  end: number
  textEnd: number
  lang?: string
  run?: string
}

/** The code of a text and where its escapes start, which no cut may part from the character they escape. */
interface Code {
  blocks: Block[]
  /** In order. */
  escapes: number[]
}

/** The index of the first of the ascending `values` at or past `at`. */
function firstFrom(values: readonly number[], at: number): number {
  let low = 0
  let high = values.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (values[middle] < at) low = middle + 1
    else high = middle
  }
  return low
}

/**
 * The code of `text`, in order, by a rule fitted to what Discord's client showed in a live check, not to its source: at
 * each place an escape, else a block, ```` /```(?:([a-z0-9_+\-.#]+?)\n)?\n*([^\n][^]*?)\n*```/i ```` with CR LF and a
 * lone CR read as LF, else inline code, a run of backticks to the next run exactly as long, a shorter opening run tried
 * where the whole finds none. Each closing is looked up in an index of the runs, so reading is linear in the text.
 */
function codeOf(text: string): Code {
  const triples: number[] = []
  const runs = new Map<number, number[]>()
  for (let at = 0; at < text.length; ) {
    if (text[at] !== '`') {
      at++
      continue
    }
    const start = at
    while (text[at] === '`') at++
    for (let triple = start; triple + FENCE.length <= at; triple++) triples.push(triple)
    const starts = runs.get(at - start)
    if (starts) starts.push(start)
    else runs.set(at - start, [start])
  }
  const lengths = [...runs.keys()].sort((a, b) => b - a)
  const textEnd = (contentStart: number, contentEnd: number) => {
    while (contentEnd > contentStart && /\s/.test(text[contentEnd - 1])) contentEnd--
    return contentEnd
  }
  /** A block whose fence starts at `at` and whose text starts past the line ends at `from`, to the next fence. */
  const blockFrom = (at: number, from: number, lang?: string): Block | undefined => {
    let contentStart = from
    while (isLineEnd(text[contentStart])) contentStart++
    const close = triples[firstFrom(triples, contentStart + 1)]
    if (contentStart >= text.length || close === undefined) return undefined
    return { start: at, contentStart, contentEnd: close, end: close + FENCE.length, textEnd: textEnd(contentStart, close), ...(lang !== undefined && { lang }) }
  }
  /** A block at `at`, read with the word ending its fence's line as its language first. */
  const blockAt = (at: number): Block | undefined => {
    let word = at + FENCE.length
    while (word < text.length && LANGUAGE.test(text[word])) word++
    const named = word > at + FENCE.length && isLineEnd(text[word]) ? blockFrom(at, word, text.slice(at + FENCE.length, word)) : undefined
    return named ?? blockFrom(at, at + FENCE.length)
  }
  /** Inline code at `at`, its run of backticks ending at `runEnd`: the longest opening run that finds a closing one. */
  const inlineAt = (at: number, runEnd: number): Block | undefined => {
    for (const length of lengths) {
      if (length > runEnd - at) continue
      const starts = runs.get(length)!
      const close = starts[firstFrom(starts, at + length + 1)]
      if (close === undefined) continue
      return { start: at, contentStart: at + length, contentEnd: close, end: close + length, textEnd: textEnd(at + length, close), run: '`'.repeat(length) }
    }
    return undefined
  }

  const blocks: Block[] = []
  const escapes: number[] = []
  for (let at = 0; at < text.length; ) {
    if (text[at] === '\\') {
      ESCAPE.lastIndex = at
      if (ESCAPE.test(text)) {
        escapes.push(at)
        at = ESCAPE.lastIndex
        continue
      }
    }
    if (text[at] !== '`') {
      at++
      continue
    }
    let runEnd = at
    while (text[runEnd] === '`') runEnd++
    const found = (runEnd - at >= FENCE.length ? blockAt(at) : undefined) ?? inlineAt(at, runEnd)
    if (found) blocks.push(found)
    // Where code opens at none, it opens at no later backtick of the run either: each needs a closing further on
    at = found?.end ?? runEnd
  }
  return { blocks, escapes }
}

/** The block of `blocks` a position falls inside, past its first character and before its last. */
function blockAround(blocks: readonly Block[], at: number): Block | undefined {
  let low = 0
  let high = blocks.length - 1
  while (low <= high) {
    const middle = (low + high) >> 1
    const block = blocks[middle]
    if (at <= block.start) high = middle - 1
    else if (at >= block.end) low = middle + 1
    else return block
  }
  return undefined
}

/** The index of the first of `blocks` that ends past `at`. */
function firstEndingPast(blocks: readonly Block[], at: number): number {
  let low = 0
  let high = blocks.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (blocks[middle].end <= at) low = middle + 1
    else high = middle
  }
  return low
}

/**
 * Whether `piece`, the text from `from` to `to` moved by `shift` with what reopens its code before it and `closing`
 * characters closing it after, reads as that part reads in the whole text: the same code at the same places and the same
 * escapes. A backtick finds its pair as far ahead as it must, so a cut can change how the text before it reads.
 */
function readsAs(code: Code, piece: string, from: number, to: number, shift: number, closing: number): boolean {
  const read = codeOf(piece)
  let index = 0
  for (let at = firstEndingPast(code.blocks, from); at < code.blocks.length && code.blocks[at].start < to; at++) {
    const block = code.blocks[at]
    const got = read.blocks[index++]
    if (got === undefined || (got.run === undefined) !== (block.run === undefined)) return false
    if (got.start !== (block.start >= from ? block.start + shift : 0)) return false
    if (got.end !== (block.end <= to ? block.end + shift : to + shift + closing)) return false
    // A block's language and text start where its fence leaves them, so its fence can't be read as its text
    if (block.run === undefined && got.lang !== undefined && got.lang !== block.lang) return false
    if (block.run === undefined && got.contentStart !== (block.start >= from ? block.contentStart : from) + shift) return false
  }
  if (index !== read.blocks.length) return false
  const first = firstFrom(code.escapes, from)
  const last = firstFrom(code.escapes, to)
  return last - first === read.escapes.length && read.escapes.every((at, i) => at === code.escapes[first + i] + shift)
}

/** Where a chunk ends in the text, where the next starts, and what closes the code it leaves open. */
interface Cut {
  end: number
  next: number
  closing: string
}

/**
 * What closes code a cut leaves open: a block's fence on a line of its own, or inline code's own run of backticks,
 * after a space where the code ends with a backtick, which Discord leaves out as it shows the code.
 */
const closingOf = (block: Block, kept: string) => (block.run === undefined ? CLOSING : kept.endsWith('`') ? ` ${block.run}` : block.run)

/** What reopens inline code at a cut: its run of backticks, before a space where the code goes on with a backtick. */
const inlineOpening = (run: string, next: string | undefined) => (next === '`' ? `${run} ` : run)

/** The chunks of `text` at most `max` long, or `undefined` when code's backticks leave no room in one. */
function chunked(text: string, max: number, code: Code): string[] | undefined {
  const { blocks } = code
  /**
   * A cut at `end` of a chunk starting at `start`, or `undefined` where it would cut a fence, or leave a
   * block in the chunk with no text, or part a run of backticks in inline code, which closes the code at a run as long as
   * its own. Where only blank lines of the block follow, its closing fence goes with the cut: the closing a cut adds is
   * the same backticks.
   */
  const cutAt = (start: number, end: number, next: number): Cut | undefined => {
    const block = blockAround(blocks, end)
    if (!block) return { end, next, closing: '' }
    if (end <= block.contentStart || end > block.end - (block.run ?? FENCE).length) return undefined
    const kept = text.slice(Math.max(start, block.contentStart), Math.min(end, block.contentEnd))
    // Code the text leaves blank stays so; a cut leaves none blank
    if (kept.trim() === '' && block.textEnd > block.contentStart) return undefined
    if (block.run !== undefined && text[end - 1] === '`' && text[end] === '`') return undefined
    const closing = closingOf(block, kept)
    return { end, next: end >= block.textEnd ? block.end : next, closing }
  }
  /**
   * What can reopen the block a chunk starts inside, preferred first: its fence and language, then its fence alone,
   * each where it leaves room for the chunk's first character; none when not even the fence alone fits.
   */
  const openings = (start: number): string[] => {
    const block = blockAround(blocks, start)
    if (!block) return ['']
    // The first character whole, else its first code point, as a character no chunk holds is cut between its code points;
    // one longer than any chunk is left unread, and counts as longer than any
    const units = [graphemesWithin(text, start, 0, max)[0]?.segment.length ?? Infinity, text.codePointAt(start)! > 0xffff ? 2 : 1]
    if (block.run !== undefined) {
      const opening = inlineOpening(block.run, text[start])
      return 2 * opening.length + units[1] <= max ? [opening] : []
    }
    const fitting = new Set<string>()
    for (const unit of units) {
      // Where the character is the last before the block's own fence, that fence closes it, with no line end before it
      const closing = start + unit >= block.contentEnd ? FENCE.length : CLOSING.length
      for (const opening of [`${FENCE}${block.lang ?? ''}\n`, `${FENCE}\n`]) if (opening.length + unit + closing <= max) fitting.add(opening)
    }
    return [...fitting]
  }
  /** The opening a chunk starting at `start` prefers, or `null` when none fits. */
  const reopening = (start: number): string | null => openings(start)[0] ?? null

  /** Where the run of blank lines at `at` ends: a cut drops them. */
  const pastBlankLines = (at: number) => {
    while (text[at] === '\n' || text[at] === '\r') at++
    return at
  }
  /** Where the run of whitespace inside a line at `at` ends: a cut there drops all of it. */
  const spaceAfter = (at: number) => {
    while (at < text.length && text[at] !== '\n' && WHITESPACE.test(text[at])) at++
    return at
  }
  /** The last of the cuts at `ends`, each going on at its `nexts`, that fits after `head` and reads as the text does. */
  const lastFitting = (start: number, head: string, ends: number[], nexts: number[]): Cut | undefined => {
    for (let index = ends.length - 1; index >= 0; index--) {
      const cut = cutAt(start, ends[index], nexts[index])
      if (cut === undefined || head.length + cut.end - start + cut.closing.length > max) continue
      const chunk = `${head}${text.slice(start, cut.end)}${cut.closing}`
      if (readsAs(code, chunk, start, cut.end, head.length - start, cut.closing.length)) return cut
    }
    return undefined
  }
  /** The cut of a chunk starting at `start` after `head`: the last line end that fits, else a break inside a line. */
  const cutFrom = (start: number, head: string): Cut | undefined => {
    const lineEnds: number[] = []
    const afterLineEnds: number[] = []
    for (let end = start; end <= text.length && head.length + end - start <= max; end++) {
      // A CRLF line end goes whole, and a lone CR ends a line as Discord reads it
      if (end < text.length && text[end] !== '\n' && !(text[end] === '\r' && text[end + 1] !== '\n')) continue
      lineEnds.push(text[end - 1] === '\r' && text[end] === '\n' && end > start ? end - 1 : end)
      afterLineEnds.push(end + 1)
    }
    const byLine = lastFitting(start, head, lineEnds, afterLineEnds)
    if (byLine) return byLine
    // A line longer than a chunk: its last whitespace that fits, else the last character a reader sees as one
    const spaces: number[] = []
    const afterSpaces: number[] = []
    const boundaries: number[] = []
    let seen = false
    for (const { index, segment } of graphemesWithin(text, start, max - head.length, max - head.length)) {
      const at = start + index
      // A run of whitespace is cut where it starts, all of it dropped
      if (seen && WHITESPACE.test(segment) && !WHITESPACE.test(text[at - 1])) {
        spaces.push(at)
        afterSpaces.push(spaceAfter(at))
      }
      boundaries.push(at + segment.length)
      seen ||= segment.trim() !== ''
    }
    return lastFitting(start, head, spaces, afterSpaces) ?? lastFitting(start, head, boundaries, boundaries)
  }
  /** The cut of one character longer than any chunk can hold: between its code points, never inside a surrogate pair. */
  const codePointCut = (start: number, head: string): Cut | undefined => {
    const ends: number[] = []
    for (let end = start; end < text.length && head.length + end - start < max; ) {
      end += text.codePointAt(end)! > 0xffff ? 2 : 1
      ends.push(end)
    }
    return lastFitting(start, head, ends, ends)
  }

  const chunks: string[] = []
  for (let start = 0; ; ) {
    start = pastBlankLines(start)
    if (start >= text.length) return chunks
    let head = reopening(start)
    if (head === null) return undefined
    let best = cutFrom(start, head)
    // A chunk starting at code's own backticks that leave no room writes them afresh, a language dropped if need be
    const opened = blockAround(blocks, start + 1)
    if (!best && opened?.start === start) {
      start = pastBlankLines(opened.contentStart)
      head = reopening(start)
      if (head === null) return undefined
      best = cutFrom(start, head)
    }
    // Indentation or blank lines that leave a character no room are dropped with the line end before them
    let indented = start
    while (indented < text.length && WHITESPACE.test(text[indented])) indented++
    const reopened = best || indented === start ? null : reopening(indented)
    const unindented = reopened === null ? undefined : cutFrom(indented, reopened)
    if (unindented) {
      start = indented
      head = reopened!
      best = unindented
    }
    best ??= codePointCut(start, head)
    // Where that opening and start leave no cut, another opening or the start past indentation may have one: a block's
    // language is kept before its indentation, as above, so the longer opening goes first (the sort is stable)
    if (!best) {
      const tries = (indented === start ? [start] : [start, indented])
        .flatMap(at => openings(at).map(opening => ({ at, opening })))
        .filter(({ at, opening }) => at !== start || opening !== head)
        .sort((a, b) => b.opening.length - a.opening.length)
      for (const { at, opening } of tries) {
        best = cutFrom(at, opening) ?? codePointCut(at, opening)
        if (best) {
          start = at
          head = opening
          break
        }
      }
    }
    if (!best) return undefined
    const chunk = `${head}${text.slice(start, best.end)}${best.closing}`
    if (chunk.trim() !== '') chunks.push(chunk)
    start = best.next
  }
}

/**
 * Splits text into messages Discord takes, each at most `max` characters, keeping code and characters whole.
 *
 * A chunk ends at the last line end that fits; a line longer than a chunk breaks at its last whitespace that fits,
 * else at the last character that fits, never inside an emoji, a flag or a letter and its accent. The line end or
 * whitespace at a cut is dropped, with a run of blank lines there. Code is read as Discord's client reads it: a block
 * is three backticks to the next three, wherever they fall, with a language when a word of letters, digits and
 * `_ + - . #` ends the opening line and text follows it, and inline code is a run of backticks to the next run as long;
 * CR LF and a lone CR end a line as LF does. Code cut across chunks is closed at the end of one and
 * reopened at the start of the next: a block with its language, or its backticks alone when the language leaves no
 * room, and inline code with its own backticks; they count toward `max`. Each chunk reads as its part of the text: no
 * cut parts an escape from what it escapes, pairs backticks the text leaves unpaired, or leaves a block with no text
 * where the text has some. A character is cut between its code points only when no chunk can hold it whole. No chunk
 * is empty or only whitespace, so an empty text gives `[]`. Lengths are `string.length`, as Discord's builders count
 * them.
 *
 * @param text - The text to send.
 * @param options - `max`, the longest chunk: {@link DiscordLimits}`.content` (2000) unless given.
 * @returns The chunks, in order.
 * @throws RangeError when `max` isn't a whole number of at least 1, or is too small for code's backticks and one
 *   character between them; the message names the smallest `max` the text needs.
 *
 * @example
 * ```ts
 * declare const channel: SendableChannels
 * declare const log: string
 *
 * for (const content of splitMessage(log)) await channel.send({ content })
 * ```
 *
 * @group Utilities
 * @see {@link https://meocord.dev/docs/4.2/formatting | Formatting}
 */
export function splitMessage(text: string, options: { max?: number } = {}): string[] {
  const max = options.max ?? DiscordLimits.content
  if (!Number.isInteger(max) || max < 1) throw new RangeError(`splitMessage's max is a whole number of at least 1, not ${max}.`)
  const code = codeOf(text)
  const chunks = chunked(text, max, code)
  if (chunks) return chunks
  // The smallest max that splits the text: double from one that can't until one can, then halve the gap. The whole
  // text's length needs no cut, and probes stay near what the text needs rather than near its length
  let low = max
  let high = Math.min(2 * max, text.length)
  while (high < text.length && !chunked(text, high, code)) {
    low = high
    high = Math.min(2 * high, text.length)
  }
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2)
    if (chunked(text, middle, code)) high = middle
    else low = middle
  }
  throw new RangeError(
    `splitMessage can't fit code's backticks and its text into chunks of ${max} characters; this text needs a max of at least ${high}.`,
  )
}

/**
 * Shortens text to at most `max` characters, ending it with an ellipsis when it was cut.
 *
 * Text that fits comes back unchanged. Otherwise it is cut at the last whitespace when one falls in the last fifth of
 * `max`, else after the last character that fits, never inside an emoji, a flag or a letter and its accent, so a first
 * character too long to fit gives the ellipsis alone; whitespace before the ellipsis is dropped. Code is read as
 * {@link splitMessage} reads it: a cut inside code closes it before the ellipsis, its backticks counted in `max`, and
 * the result reads as the start of the text does, so a cut moves back before a fence, an escape or a run of backticks
 * in inline code it would part, and before backticks it would pair.
 *
 * @param text - The text to fit.
 * @param max - The longest result, such as {@link DiscordLimits}`.embedDescription`.
 * @param ellipsis - What ends a cut text: `…` unless given.
 * @returns The text, or its start and the ellipsis.
 * @throws RangeError when `max` isn't a whole number, or is shorter than `ellipsis`.
 *
 * @example
 * ```ts
 * declare const summary: string
 *
 * const embed = new EmbedBuilder().setDescription(truncate(summary, DiscordLimits.embedDescription))
 * ```
 *
 * @group Utilities
 * @see {@link https://meocord.dev/docs/4.2/formatting | Formatting}
 */
export function truncate(text: string, max: number, ellipsis = '…'): string {
  if (!Number.isInteger(max) || max < ellipsis.length) {
    throw new RangeError(`truncate's max is a whole number no shorter than the ellipsis, ${ellipsis.length} characters, not ${max}.`)
  }
  if (text.length <= max) return text
  const code = codeOf(text)
  const { blocks, escapes } = code
  /**
   * What a cut at `at` keeps, and what closes the code it leaves open: a cut through a fence, an escape or a run of
   * backticks in inline code moves before it, and one before any text of a block falls before the block.
   */
  const keep = (at: number): { kept: string; closing: string } => {
    if (escapes[firstFrom(escapes, at - 1)] === at - 1) at--
    const block = blockAround(blocks, at)
    if (!block) return { kept: text.slice(0, at).trimEnd(), closing: '' }
    if (block.run !== undefined) while (text[at - 1] === '`' && text[at] === '`') at--
    const content = at > block.contentStart ? text.slice(block.contentStart, Math.min(at, block.contentEnd)).trimEnd() : ''
    if (content === '') return { kept: text.slice(0, block.start).trimEnd(), closing: '' }
    return { kept: text.slice(0, block.contentStart) + content, closing: block.run === undefined ? `${CLOSING}\n` : closingOf(block, content) }
  }
  /** The text cut at `at`, when it fits and reads as the text does up to the cut, the ellipsis taking nothing of it. */
  const cut = (at: number): string | undefined => {
    const { kept, closing } = keep(at)
    const result = `${kept}${closing}${ellipsis}`
    return result.length <= max && readsAs(code, result, 0, kept.length, 0, closing.trimEnd().length) ? result : undefined
  }
  const room = max - ellipsis.length
  const spaces: number[] = []
  const boundaries: number[] = []
  for (const { index, segment } of graphemesWithin(text, 0, room, room)) {
    if (WHITESPACE.test(segment) && index >= max * TRUNCATE_WHITESPACE_REACH) spaces.push(index)
    if (index + segment.length > room) break
    boundaries.push(index + segment.length)
  }
  // The last whitespace in reach, else the last character, that leaves room for what closes a block it cuts
  for (const at of [...spaces.reverse(), ...boundaries.reverse()]) {
    const result = cut(at)
    if (result !== undefined) return result
  }
  return ellipsis
}
