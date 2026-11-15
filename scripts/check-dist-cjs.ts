/**
 * Loads the CommonJS build as a consumer's Node does, after `bun run build`: every `meocord/<entry>` with a `require`
 * condition is require()d by name, through `exports`, and a `Logger` prints at each level. A dependency the build
 * reaches without the right interop, such as an ES-module-only one read through its default export, throws here.
 *
 * It also fails when `dist/cjs` requires a package that resolves, for `require`, to an ES module: Node loads one with
 * its own `require(esm)`, but jest does so only with Node's VM modules. Such a package belongs in
 * `scripts/es-module-only.js`, which the build bundles.
 */
import { spawnSync } from 'child_process'
import { readdirSync, readFileSync } from 'fs'
import { builtinModules } from 'module'
import path from 'path'
import { fileURLToPath } from 'url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { exports } = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
  exports: Record<string, unknown>
}
const entries = Object.entries(exports)
  .filter(([, target]) => typeof target === 'object' && target !== null && 'require' in target)
  .map(([subpath]) => `meocord/${subpath.replace(/^\.\//, '')}`)

const cjsRoot = path.join(repoRoot, 'dist', 'cjs')
const cjsFiles = readdirSync(cjsRoot, { recursive: true, encoding: 'utf8' }).filter(file => file.endsWith('.cjs'))
const REQUIRE_CALL = /\brequire\(\s*(['"])([^'"]+)\1\s*\)/g
const required = new Set<string>()
for (const file of cjsFiles) {
  for (const [, , specifier] of readFileSync(path.join(cjsRoot, file), 'utf8').matchAll(REQUIRE_CALL)) {
    const builtin = specifier.startsWith('node:') || builtinModules.includes(specifier.split('/')[0])
    if (!builtin && !specifier.startsWith('.')) required.add(specifier)
  }
}

// Run by Node, not Bun, whose require() of an ES module differs from Node's, and whose resolver adds a `bun` condition
const consumer = `
const fs = require('fs')
const path = require('path')
for (const entry of ${JSON.stringify(entries)}) require(entry)
const { Logger } = require('meocord/common')
const logger = new Logger('CjsCheck')
for (const level of ['log', 'info', 'verbose', 'warn', 'error']) logger[level](level + ' line')
console.log('node ' + process.version)

// Whether Node reads a file as an ES module: by its extension, else by the nearest package.json's type
const isModule = file => {
  if (file.endsWith('.mjs')) return true
  if (file.endsWith('.cjs')) return false
  for (let dir = path.dirname(file); dir !== path.dirname(dir); dir = path.dirname(dir)) {
    const manifest = path.join(dir, 'package.json')
    if (fs.existsSync(manifest)) return JSON.parse(fs.readFileSync(manifest, 'utf8')).type === 'module'
  }
  return false
}
// Resolved from dist/cjs, with Node's require conditions
const fromDist = require('module').createRequire(${JSON.stringify(path.join(cjsRoot, 'core', 'index.cjs'))})
for (const specifier of ${JSON.stringify([...required].sort())}) {
  let file
  try {
    file = fromDist.resolve(specifier)
  } catch (error) {
    console.log('unresolved ' + specifier + ': ' + error.code)
    continue
  }
  console.log((isModule(file) ? 'esm ' : 'cjs ') + specifier)
}
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
const unfit = run.stdout.split('\n').filter(line => /^(esm|unresolved) /.test(line))
if (unfit.length > 0) {
  console.error(
    'dist/cjs requires packages that load only as ES modules, which jest reads only with VM modules. Add each to ' +
      `scripts/es-module-only.js, which the CommonJS build bundles:\n${unfit.map(line => `  ${line}`).join('\n')}`,
  )
  process.exit(1)
}
const node = /^node (v\S+)$/m.exec(run.stdout)?.[1]
console.log(`Each of ${entries.join(', ')} loads with require(), and a Logger prints at every level, on Node ${node}.`)
console.log(`dist/cjs requires ${required.size} packages, each a CommonJS module: ${[...required].sort().join(', ')}.`)
