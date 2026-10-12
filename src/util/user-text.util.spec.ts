import { escapeForLog, quoteForLog, userWords } from '@src/util/user-text.util.js'

// U+061C, U+200E and U+200F, then U+202A–U+202E and U+2066–U+2069
const BIDI_CONTROLS = [0x61c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069]
const hex = (code: number) => code.toString(16).padStart(4, '0')
const named = BIDI_CONTROLS.map(code => [`U+${hex(code).toUpperCase()}`, code] as const)

it('lists every bidi control Unicode defines', () => {
  const all = Array.from({ length: 0x10000 }, (_, code) => code).filter(code => /\p{Bidi_Control}/u.test(String.fromCodePoint(code)))
  expect(all).toEqual(BIDI_CONTROLS)
})

describe('escapeForLog', () => {
  it('escapes line breaks, controls, separators and bidi controls', () => {
    expect(escapeForLog('a\nb\r\tc\u0000\u001b[0m\u007f\u0085\u2028\u2029\u202e\u2066')).toBe(
      'a\\nb\\r\\tc\\u0000\\u001b[0m\\u007f\\u0085\\u2028\\u2029\\u202e\\u2066',
    )
  })

  // Unicode's whole Bidi_Control set, the marks included: any of them can reorder the rest of the line
  it.each(named)('escapes the bidi control %s', (_, code) => {
    expect(escapeForLog(`a${String.fromCodePoint(code)}b`)).toBe(`a\\u${hex(code)}b`)
  })

  // Not quoted, so a quote or a backslash can't end the text early, and markdown escaped for a reply reads as it is
  it('leaves other text as it is, quotes and backslashes included', () => {
    expect(escapeForLog('héllo 👋 [x](y) **z** "q" \\*')).toBe('héllo 👋 [x](y) **z** "q" \\*')
  })
})

describe('quoteForLog', () => {
  it('quotes short text whole, escaping its quotes and backslashes', () => {
    expect(quoteForLog('!say "hi" \\n\n')).toBe('"!say \\"hi\\" \\\\n\\n"')
  })

  it.each(named)('escapes the bidi control %s inside quotes', (_, code) => {
    expect(quoteForLog(`a${String.fromCodePoint(code)}b`)).toBe(`"a\\u${hex(code)}b"`)
  })

  // Counted by code point, so an emoji is never split into half a surrogate pair
  it('cuts text past 200 characters, by code point, and gives its length', () => {
    expect(quoteForLog('👋'.repeat(201))).toBe(`"${'👋'.repeat(200)}…" (201 characters)`)
  })
})

describe('userWords', () => {
  it('shows markdown and masked links as typed', () => {
    expect(userWords('[a](https://example.com) **b** `c` ||d||')).toBe('\\[a](https://example.com) \\*\\*b\\*\\* \\`c\\` \\|\\|d\\|\\|')
  })

  it('puts the words on one line', () => {
    expect(userWords('  a\n\n# b\t c  ')).toBe(' a # b c ')
  })
})
