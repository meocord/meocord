// Runs before the application's entry, so whatever environment meocord.config loads -- a dotenv
// import, say -- is in place when the entry's decorators read process.env. Silent when the config
// is missing or throws: MeoCordFactory.create reports that.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { installStackRemapper } from './stack-remap.js'
import { listenForDevRunnerStop } from '../util/dev-runner.util.js'
import { BUNDLE_ENTRY_KEY } from '../util/bundle-entry.util.js'
import { loadMeoCordConfig } from '../util/meocord-config-loader.util.js'

// First, so a restart `meocord start --dev` asks for while the bundle still loads is heard
listenForDevRunnerStop()

// Bundled into the application's entry, so this is the built bundle's own path. A shard manager spawns
// it: process.argv[1] may be a process manager's wrapper instead.
const bundle = fileURLToPath(import.meta.url)
globalThis[BUNDLE_ENTRY_KEY] = bundle

// Assets are beside the bundle too, wherever dist was copied to: an asset import is this directory and its file name,
// rather than the directory the build ran in, which the bundle would otherwise carry
__webpack_public_path__ = `${path.dirname(bundle).replace(/\\/g, '/')}/`

// Beside the bundle, wherever the bot was started from, by the loader the runtime uses. The bundle carries its own copy
// of it, and the module cache evaluates the config once for both; the factory reports one that is missing or fails
const config = loadMeoCordConfig()

if (config?.sourceMappedStacks !== false) installStackRemapper(bundle)
