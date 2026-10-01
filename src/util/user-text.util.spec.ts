import { escapeForLog, quoteForLog, userWords } from '@src/util/user-text.util.js'

describe('escapeForLog', () => {
  it('escapes line breaks, controls, separators, bidi controls, quotes and backslashes', () => {
    expect(escapeForLog('a\nb\r\tc\u0000\u001b[0m\u007f\u0085\u2028\u2029\u202e\u2066"\\')).toBe(
      'a\\nb\\r\\tc\\u0000\\u001b[0m\\u007f\\u0085\\u2028\\u2029\\u202e\\u2066\\"\\\\',
    )
  })

  it('leaves other text as it is', () => {
    expect(escapeForLog('héllo 👋 [x](y) **z**')).toBe('héllo 👋 [x](y) **z**')
  })
})

describe('quoteForLog', () => {
  it('quotes short text whole', () => {
    expect(quoteForLog('!roll 20')).toBe('"!roll 20"')
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
    expect(userWords('  a\n\n# b\t c  ')).toBe('a # b c')
  })
})
