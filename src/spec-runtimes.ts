// The runtimes the specs spawn, by path; no entry point imports this file, so it never ships
import { accessSync, constants, realpathSync } from 'node:fs'
import path from 'node:path'

/** Bun's binary: the one running the suite under Bun, else `bun` from PATH. */
export const bun = process.versions.bun ? process.execPath : 'bun'

/**
 * Node's binary: the one running the suite under Node. Under Bun, `bunx --bun` puts a `node` first on PATH that is a
 * link to Bun itself, so the first `node` on PATH that is not Bun is taken.
 */
export const node = process.versions.bun ? nodeOnPath() : process.execPath

/** The binary of a runtime a spec names, `'node'` or `'bun'`. */
export function runtimeBinary(name: 'node' | 'bun'): string {
  return name === 'bun' ? bun : node
}

function nodeOnPath(): string {
  const self = realpathSync(process.execPath)
  const file = process.platform === 'win32' ? 'node.exe' : 'node'
  for (const dir of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(dir, file)
    try {
      accessSync(candidate, constants.X_OK)
      if (realpathSync(candidate) !== self) return candidate
    } catch {
      // Not here, or not runnable
    }
  }
  throw new Error('The suite under Bun spawns Node, and no node on PATH is Node.')
}
