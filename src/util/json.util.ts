import { readFileSync } from 'node:fs'

/** The byte order mark an editor may write at the start of a UTF-8 file, which `JSON.parse` refuses. */
const BYTE_ORDER_MARK = '\uFEFF'

/** The text without a leading byte order mark, as Node and tsc read a JSON file. */
const withoutByteOrderMark = (text: string): string => (text.startsWith(BYTE_ORDER_MARK) ? text.slice(BYTE_ORDER_MARK.length) : text)

/**
 * Removes the comments and trailing commas `tsconfig.json` allows, leaving strings untouched, so an
 * `https://` URL or a `/*` glob inside one survives.
 */
export function stripJsonc(text: string): string {
  let withoutComments = ''
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === '"') {
      // Copy the whole string, escapes included
      let end = i + 1
      while (end < text.length && text[end] !== '"') end += text[end] === '\\' ? 2 : 1
      withoutComments += text.slice(i, end + 1)
      i = end
    } else if (char === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      withoutComments += '\n'
    } else if (char === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      i = end === -1 ? text.length : end + 1
    } else {
      withoutComments += char
    }
  }

  let result = ''
  for (let i = 0; i < withoutComments.length; i++) {
    const char = withoutComments[i]
    if (char === '"') {
      let end = i + 1
      while (end < withoutComments.length && withoutComments[end] !== '"') end += withoutComments[end] === '\\' ? 2 : 1
      result += withoutComments.slice(i, end + 1)
      i = end
    } else if (char === ',' && /^\s*[}\]]/.test(withoutComments.slice(i + 1))) {
      continue
    } else {
      result += char
    }
  }
  return result
}

/** Parses JSON with the comments and trailing commas `tsconfig.json` allows, and a leading byte order mark. */
export function parseJsonc<T = any>(text: string): T {
  return JSON.parse(stripJsonc(withoutByteOrderMark(text))) as T
}

/** Reads a JSON file, such as a `package.json`, as Node reads one: UTF-8, with a leading byte order mark ignored. */
export function readJsonFile<T = any>(file: string): T {
  return JSON.parse(withoutByteOrderMark(readFileSync(file, 'utf8'))) as T
}
