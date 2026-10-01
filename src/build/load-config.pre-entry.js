// Runs before the application's entry, so whatever environment meocord.config loads -- a dotenv
// import, say -- is in place when the entry's decorators read process.env. Silent when the config
// is missing or throws: MeoCordFactory.create loads it again and reports that.
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { installStackRemapper } from './stack-remap.js'
import { listenForDevRunnerStop } from '../util/dev-runner.util.js'

// First, so a restart `meocord start --dev` asks for while the bundle still loads is heard
listenForDevRunnerStop()

// Bundled into the application's entry, so this is the built bundle's own path. A shard manager spawns
// it: process.argv[1] may be a process manager's wrapper instead.
const bundle = fileURLToPath(import.meta.url)
globalThis[Symbol.for('meocord.bundleEntry')] = bundle

// Assets are beside the bundle too, wherever dist was copied to: an asset import is this directory and its file name,
// rather than the directory the build ran in, which the bundle would otherwise carry
__webpack_public_path__ = `${path.dirname(bundle).replace(/\\/g, '/')}/`

// Beside the bundle, wherever the bot was started from, as the runtime loader reads it
const compiledPath = path.join(path.dirname(bundle), 'meocord.config.mjs')
let config

if (existsSync(compiledPath)) {
  // Through a variable, as the runtime loader does, so the bundler leaves the path to runtime.
  const load = createRequire(import.meta.url)
  try {
    config = load(compiledPath)
  } catch {
    // Reported by MeoCordFactory.create.
  }
}

if ((config?.default ?? config)?.sourceMappedStacks !== false) installStackRemapper(bundle)
