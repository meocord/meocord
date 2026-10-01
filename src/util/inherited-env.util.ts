import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parseEnv } from 'node:util'

/**
 * The .env files a bot starts with, in the order Bun reads them, a later one winning: `.env`, the mode's, the local
 * one (not under `test`), and the mode's local one. The mode is `NODE_ENV`, `development` when unset.
 */
export function envFiles(nodeEnv: string | undefined): string[] {
  const mode = nodeEnv || 'development'
  return ['.env', `.env.${mode}`, ...(mode === 'test' ? [] : ['.env.local']), `.env.${mode}.local`]
}

/**
 * The environment a bot started in `root` inherits: `env` without the values its .env files gave it. Neither dotenv nor
 * Bun replaces a variable already set, so an inherited copy would keep a value a file no longer holds; the bot reads the
 * files itself as it starts. A variable the shell sets to another value is kept.
 */
export function inheritedEnvironment(env: NodeJS.ProcessEnv, root: string): NodeJS.ProcessEnv {
  const fromFiles = new Map<string, Set<string>>()
  for (const file of envFiles(env.NODE_ENV)) {
    for (const [key, value] of Object.entries(read(root, file))) fromFiles.set(key, (fromFiles.get(key) ?? new Set()).add(value))
  }
  return Object.fromEntries(Object.entries(env).filter(([key, value]) => value === undefined || !fromFiles.get(key)?.has(value)))
}

/** A .env file's values, or none when it is not there to read. */
function read(root: string, file: string): Record<string, string> {
  let text: string
  try {
    text = readFileSync(path.join(root, file), 'utf8')
  } catch {
    return {}
  }
  return Object.fromEntries(Object.entries(parseEnv(text)).filter((entry): entry is [string, string] => entry[1] !== undefined))
}
