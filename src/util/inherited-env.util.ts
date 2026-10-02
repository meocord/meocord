import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parseEnv } from 'node:util'
import { buildMode } from '@src/util/bundle-entry.util.js'
import { listed } from '@src/util/user-text.util.js'

/**
 * The .env files a bot starts with, in the order Bun reads them, a later one winning: `.env`, the mode's, the local
 * one (not under `test`), and the mode's local one. The mode is `NODE_ENV`, `development` when unset.
 */
export function envFiles(nodeEnv: string | undefined): string[] {
  const mode = nodeEnv || 'development'
  return ['.env', `.env.${mode}`, ...(mode === 'test' ? [] : ['.env.local']), `.env.${mode}.local`]
}

/**
 * The variables holding a development .env file's value in a production build on Bun, and the files those came from:
 * with `NODE_ENV` unset, Bun reads the development files before any code runs, and the config's dotenv keeps a value
 * already set. One the production files give the same value is left out. Empty on Node, with `NODE_ENV` set, in any
 * other build, and when Bun read no .env files.
 */
export function bunDevelopmentValues(
  env: NodeJS.ProcessEnv = process.env,
  root = process.cwd(),
  bun = process.versions.bun !== undefined,
): { files: string[]; keys: string[] } {
  if (!bun || env.NODE_ENV || buildMode() !== 'production') return { files: [], keys: [] }
  const productionFiles = envFiles('production')
  // In Bun's order, a later file winning, as the config's dotenv also settles them
  const production: Record<string, string> = Object.assign({}, ...productionFiles.map(file => read(root, file)))
  const development = new Map<string, { value: string; file: string }>()
  for (const file of envFiles(undefined).filter(file => !productionFiles.includes(file))) {
    for (const [key, value] of Object.entries(read(root, file))) development.set(key, { value, file })
  }
  const loaded = [...development].filter(([key, { value }]) => env[key] === value && production[key] !== value)
  return { files: [...new Set(loaded.map(([, { file }]) => file))].sort(), keys: loaded.map(([key]) => key) }
}

/** The warning for the development values {@link bunDevelopmentValues} found, naming each file and variable. */
export function bunDevelopmentWarning({ files, keys }: { files: readonly string[]; keys: readonly string[] }): string {
  return (
    `Bun loaded ${listed(files)} because NODE_ENV is unset, and this is a production build, so ${listed(keys)} ` +
    `${keys.length === 1 ? 'has its development value' : 'have their development values'}; set NODE_ENV=production, or ` +
    'start with `bun --no-env-file`.'
  )
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
