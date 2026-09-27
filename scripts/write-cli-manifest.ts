// A step of `bun run build`: writes dist/cli.json from the program the CLI runs, for the docs' CLI reference
import { writeFileSync } from 'fs'
import path from 'path'
import { cliManifest } from '../src/bin/cli-manifest.js'
import { MeoCordCLI } from '../src/bin/meocord.js'
import { repoRoot } from './lib/packed-app.js'
import packageJson from '../package.json' with { type: 'json' }

const manifest = cliManifest(new MeoCordCLI().program(), packageJson.version)
writeFileSync(path.join(repoRoot, 'dist', 'cli.json'), `${JSON.stringify(manifest, null, 2)}\n`)
