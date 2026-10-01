import { escapeMarkdown } from 'discord.js'

/** Characters a log line shows escaped: C0 and C1 controls, DEL, line and paragraph separators, and bidi controls. */
const UNSAFE_IN_LOG = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069"\\]/g
const SHORT_ESCAPES: Record<string, string> = { '\n': '\\n', '\r': '\\r', '\t': '\\t', '"': '\\"', '\\': '\\\\' }

/** Text for a log line, on one line: control characters, quotes and backslashes escaped, so it can't start a line of its own. */
export function escapeForLog(text: string): string {
  return text.replace(UNSAFE_IN_LOG, char => SHORT_ESCAPES[char] ?? `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)
}

/** How many characters of a user's text a log line quotes before cutting it short. */
const LOGGED_CHARACTERS = 200

/** A user's text as a log line quotes it: escaped as {@link escapeForLog} does, and cut short after 200 characters, with its length. */
export function quoteForLog(text: string): string {
  const characters = [...text]
  if (characters.length <= LOGGED_CHARACTERS) return `"${escapeForLog(text)}"`
  return `"${escapeForLog(characters.slice(0, LOGGED_CHARACTERS).join(''))}…" (${characters.length} characters)`
}

/** Words a user wrote, as a reply quotes them: on one line, with their markdown, masked links included, shown as typed. */
export function userWords(text: string): string {
  return escapeMarkdown(text.replace(/\s+/g, ' ').trim(), { maskedLink: true })
}
