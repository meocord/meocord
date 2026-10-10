// Runs before the application's entry and every package it imports, so whatever environment meocord.config loads -- a
// dotenv import, say -- is in place when the entry's decorators and its packages read process.env. Silent when the
// config is missing or throws: MeoCordFactory.create reports that.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { installStackRemapper } from './stack-remap.js'
import { listenForDevRunnerStop } from '../util/dev-runner.util.js'
import { BUILD_MODE_KEY, BUNDLE_ENTRY_KEY, STARTUP_ERRORS_KEY } from '../util/bundle-entry.util.js'
import { loadMeoCordConfig } from '../util/meocord-config-loader.util.js'
import { platformMismatch } from '../util/platform.util.js'

// First, so a restart `meocord start --dev` asks for while the bundle still loads is heard
listenForDevRunnerStop()

// Bundled into the application's entry, so this is the built bundle's own path. A shard manager spawns
// it: process.argv[1] may be a process manager's wrapper instead.
const bundle = fileURLToPath(import.meta.url)
globalThis[BUNDLE_ENTRY_KEY] = bundle
// The bundler writes the build's mode in for process.env.NODE_ENV, so this is the mode the bundle was built in
globalThis[BUILD_MODE_KEY] = process.env.NODE_ENV

// Assets are beside the bundle too, wherever dist was copied to: an asset import is this directory and its file name,
// rather than the directory the build ran in, which the bundle would otherwise carry
__webpack_public_path__ = `${path.dirname(bundle).replace(/\\/g, '/')}/`

// Before any package loads: a native addon built for another platform would otherwise fail as it is imported, with its
// own error rather than this one, which names both platforms. In every process, a shard manager's and register's too
const mismatch = platformMismatch()
if (mismatch) {
  // The shape of MeoCord's own error line, without its colours and timestamp, which need packages yet to load
  process.stderr.write(`[ERROR] [MeoCord] ${mismatch}\n`)
  process.exit(1)
}

// Beside the bundle, wherever the bot was started from, by the loader the runtime uses: the same module when meocord is
// bundled, else a copy of it, and require's cache evaluates the config once either way; the factory reports a failure
const config = loadMeoCordConfig()

// Before the entry's decorators run, so with 'all' they keep their startup errors for create() to report together
if (config?.startupErrors === 'all') globalThis[STARTUP_ERRORS_KEY] = 'all'

if (config?.sourceMappedStacks !== false) installStackRemapper(bundle)
