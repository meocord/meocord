import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parseEnv } from 'node:util'
import { buildMode } from '@src/util/bundle-entry.util.js'
import { listed } from '@src/util/user-text.util.js'

/** The mode whose .env files Bun reads for a `NODE_ENV`: `production` or `test` as given, else `development`. */
export const envMode = (nodeEnv: string | undefined): 'production' | 'test' | 'development' =>
  nodeEnv === 'production' || nodeEnv === 'test' ? nodeEnv : 'development'

/**
 * The .env files Bun reads for a `NODE_ENV`, in its order, a later one winning: `.env`, the mode's, the local one
 * (not under `test`), and the mode's local one, the mode as {@link envMode} gives it.
 */
export function envFiles(nodeEnv: string | undefined): string[] {
  const mode = envMode(nodeEnv)
  return ['.env', `.env.${mode}`, ...(mode === 'test' ? [] : ['.env.local']), `.env.${mode}.local`]
}

/** What {@link bunDevelopmentValues} found: the variables, the files they came from, and the NODE_ENV Bun read for. */
export interface BunEnvValues {
  files: string[]
  keys: string[]
  nodeEnv?: string
}

/**
 * The variables holding another mode's .env value in a production build on Bun, and the files those came from: for a
 * `NODE_ENV` other than `production`, Bun reads that mode's files before any code runs, and the config's dotenv keeps
 * a value already set. One the production files give the same value is left out. Empty on Node, in any other build,
 * and when Bun read no other mode's files.
 */
export function bunDevelopmentValues(
  env: NodeJS.ProcessEnv = process.env,
  root = process.cwd(),
  bun = process.versions.bun !== undefined,
): BunEnvValues {
  const none = { files: [], keys: [], nodeEnv: env.NODE_ENV }
  if (!bun || buildMode() !== 'production') return none
  const productionFiles = envFiles('production')
  // In Bun's order, a later file winning, as the config's dotenv also settles them
  const production: Record<string, string> = Object.assign({}, ...productionFiles.map(file => read(root, file)))
  const development = new Map<string, { value: string; file: string }>()
  for (const file of envFiles(env.NODE_ENV).filter(file => !productionFiles.includes(file))) {
    for (const [key, value] of Object.entries(read(root, file))) development.set(key, { value, file })
  }
  const loaded = [...development].filter(([key, { value }]) => env[key] === value && production[key] !== value)
  if (loaded.length === 0) return none
  return { files: [...new Set(loaded.map(([, { file }]) => file))].sort(), keys: loaded.map(([key]) => key), nodeEnv: env.NODE_ENV }
}

/** The warning for the development values {@link bunDevelopmentValues} found, naming each file and variable. */
export function bunDevelopmentWarning({ files, keys, nodeEnv }: BunEnvValues): string {
  const mode = envMode(nodeEnv)
  return (
    `Bun loaded ${listed(files)} because NODE_ENV is ${nodeEnv || 'unset'}, and this is a production build, so ` +
    `${listed(keys)} ${keys.length === 1 ? `has its ${mode} value` : `have their ${mode} values`}; set ` +
    'NODE_ENV=production, or start with `bun --no-env-file`.'
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
