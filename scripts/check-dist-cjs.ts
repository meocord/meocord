/**
 * Loads the CommonJS build as a consumer's Node does, after `bun run build`: every `meocord/<entry>` with a `require`
 * condition is require()d by name, through `exports`, and a `Logger` prints at each level. A dependency the build
 * reaches without the right interop, such as an ES-module-only one read through its default export, throws here.
 */
import { spawnSync } from 'child_process'
import { readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { exports } = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
  exports: Record<string, unknown>
}
const entries = Object.entries(exports)
  .filter(([, target]) => typeof target === 'object' && target !== null && 'require' in target)
  .map(([subpath]) => `meocord/${subpath.replace(/^\.\//, '')}`)

// Run by Node, not Bun, whose require() of an ES module differs from Node's
const consumer = `
for (const entry of ${JSON.stringify(entries)}) require(entry)
const { Logger } = require('meocord/common')
const logger = new Logger('CjsCheck')
for (const level of ['log', 'info', 'verbose', 'warn', 'error']) logger[level](level + ' line')
console.log('node ' + process.version)
`
const run = spawnSync('node', ['-e', consumer], {
  cwd: repoRoot,
  encoding: 'utf8',
  env: { ...process.env, NODE_ENV: 'production', NO_COLOR: '1', FORCE_COLOR: '0' },
})
const output = `${run.stdout}${run.stderr}`
const missing = ['LOG', 'INFO', 'VERBOSE', 'WARN', 'ERROR'].filter(tag => !output.includes(`[${tag}] [CjsCheck] ${tag.toLowerCase()} line`))

if (run.status !== 0 || missing.length > 0) {
  console.error(`The CommonJS build does not load and log as a consumer requires it:\n${output}`)
  if (missing.length > 0) console.error(`No ${missing.map(tag => `[${tag}]`).join(', ')} line was printed.`)
  process.exit(1)
}
const node = /^node (v\S+)$/m.exec(run.stdout)?.[1]
console.log(`Each of ${entries.join(', ')} loads with require(), and a Logger prints at every level, on Node ${node}.`)
