// The last step of `bun run build`: see scripts/lib/build-stamp.ts
import { writeBuildStamp } from './lib/build-stamp.js'
import { repoRoot } from './lib/packed-app.js'

writeBuildStamp(repoRoot)
