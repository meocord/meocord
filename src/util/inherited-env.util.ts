import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { parseEnv } from 'node:util'
import { buildMode } from '@src/util/bundle-entry.util.js'

/**
 * The .env files a bot starts with, in the order Bun reads them, a later one winning: `.env`, the mode's, the local
 * one (not under `test`), and the mode's local one. The mode is `NODE_ENV`, `development` when unset.
 */
export function envFiles(nodeEnv: string | undefined): string[] {
  const mode = nodeEnv || 'development'
  return ['.env', `.env.${mode}`, ...(mode === 'test' ? [] : ['.env.local']), `.env.${mode}.local`]
}

/**
 * The development .env files Bun loaded into a production build: with `NODE_ENV` unset, Bun reads the development
 * files before any code runs, and the config's dotenv keeps a value already set. Empty on Node, with `NODE_ENV` set,
 * and in any other build.
 */
export function bunDevelopmentEnvFiles(
  env: NodeJS.ProcessEnv = process.env,
  root = process.cwd(),
  bun = process.versions.bun !== undefined,
): string[] {
  if (!bun || env.NODE_ENV || buildMode() !== 'production') return []
  const production = envFiles('production')
  return envFiles(undefined).filter(file => !production.includes(file) && existsSync(path.join(root, file)))
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
