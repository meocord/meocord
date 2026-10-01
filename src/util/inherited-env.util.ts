import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parseEnv } from 'node:util'

/** The .env files Bun reads before a process runs any code; dotenv, by default, reads the first. */
function envFiles(nodeEnv: string | undefined): string[] {
  const mode = nodeEnv || 'development'
  return ['.env', `.env.${mode}`, '.env.local', `.env.${mode}.local`]
}

/**
 * The environment a bot started in `root` inherits: `env` without the values its .env files gave it. The bot loads
 * those files itself as it starts, and neither dotenv nor Bun replaces a variable already set, so an inherited copy
 * would keep a value the files no longer hold. A variable the shell sets to another value is kept.
 */
export function inheritedEnvironment(env: NodeJS.ProcessEnv, root: string): NodeJS.ProcessEnv {
  const fromFiles = new Map<string, Set<string>>()
  for (const file of envFiles(env.NODE_ENV)) {
    for (const [key, value] of Object.entries(parseEnv(readIfPresent(path.join(root, file))))) {
      if (value !== undefined) fromFiles.set(key, (fromFiles.get(key) ?? new Set()).add(value))
    }
  }
  return Object.fromEntries(Object.entries(env).filter(([key, value]) => value === undefined || !fromFiles.get(key)?.has(value)))
}

/** A file's text, or nothing when it is not there to read. */
function readIfPresent(file: string): string {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}
