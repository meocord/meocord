import { escapeMarkdown } from 'discord.js'

/** Characters a log line shows escaped: C0 and C1 controls, DEL, line and paragraph separators, and bidi controls. */
const UNSAFE_IN_LOG = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g
/** The same, with the quote and the backslash, for text shown between quotes. */
const UNSAFE_IN_QUOTES = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069"\\]/g
const SHORT_ESCAPES: Record<string, string> = { '\n': '\\n', '\r': '\\r', '\t': '\\t', '"': '\\"', '\\': '\\\\' }

const escapeChar = (char: string) => SHORT_ESCAPES[char] ?? `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`

/** Text for a log line, on one line: its control characters escaped, so it can't start a line of its own. */
export function escapeForLog(text: string): string {
  return text.replace(UNSAFE_IN_LOG, escapeChar)
}

/** How many characters of a user's text a log line quotes before cutting it short. */
const LOGGED_CHARACTERS = 200

/**
 * A user's text as a log line quotes it: escaped as {@link escapeForLog} does, with its quotes and backslashes too,
 * and cut short after 200 characters, with its length.
 */
export function quoteForLog(text: string): string {
  const characters = [...text]
  const quoted = (shown: string) => `"${shown.replace(UNSAFE_IN_QUOTES, escapeChar)}"`
  if (characters.length <= LOGGED_CHARACTERS) return quoted(text)
  return `${quoted(`${characters.slice(0, LOGGED_CHARACTERS).join('')}…`)} (${characters.length} characters)`
}

/** Words a user wrote, as a reply quotes them: on one line, with their markdown, masked links included, shown as typed. */
export function userWords(text: string): string {
  return escapeMarkdown(text.replace(/\s+/g, ' ').trim(), { maskedLink: true })
}
