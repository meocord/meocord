/**
 * Checks, after `bun run build`, that the built public declarations break nothing code written against the latest
 * published release compiled with: each entry's `.d.ts` and `.d.cts`, export by export and member by member (see
 * lib/api-compat.ts). Additions pass. A deliberate break is named in api-compat-allowlist.json with its reason, and
 * the allowlist must be empty unless the release is a major one.
 *
 *   bun scripts/check-api-compat.ts [--against <version>]
 */
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import ts from 'typescript'
import { apiBreaks } from './lib/api-compat.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ENTRIES = ['core', 'decorator', 'common', 'interface', 'enum', 'testing']
const DECLARATIONS = [
  ...ENTRIES.flatMap(entry => [`dist/types/${entry}/index.d.ts`, `dist/types/${entry}/index.d.cts`]),
  'meocord.eslint.d.ts',
  'meocord.eslint.d.cts',
]

const at = process.argv.indexOf('--against')
const against = at >= 0 ? process.argv[at + 1] : execFileSync('npm', ['view', 'meocord', 'dist-tags.latest'], { encoding: 'utf8' }).trim()

// Unpacked inside the repository, so the published declarations resolve discord.js from its node_modules
const published = path.join(repoRoot, 'node_modules', '.cache', 'api-compat', against)
if (!existsSync(path.join(published, 'package', 'package.json'))) {
  rmSync(published, { recursive: true, force: true })
  mkdirSync(published, { recursive: true })
  execFileSync('npm', ['pack', `meocord@${against}`, '--pack-destination', published, '--silent'], { cwd: published })
  const tarball = readdirSync(published).find(file => file.endsWith('.tgz'))!
  execFileSync('tar', ['-xzf', tarball], { cwd: published })
}

const pairs = DECLARATIONS.map(file => ({ file, before: path.join(published, 'package', file), after: path.join(repoRoot, file) })).filter(
  ({ before }) => existsSync(before),
)
for (const { file, after } of pairs) {
  if (!existsSync(after)) throw new Error(`${file} is not built; run bun run build first.`)
}

const program = ts.createProgram(
  pairs.flatMap(({ before, after }) => [before, after]),
  {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    target: ts.ScriptTarget.ESNext,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    types: ['node'],
  },
)
const checker = program.getTypeChecker()

const allowlist: Record<string, string> = JSON.parse(readFileSync(path.join(repoRoot, 'scripts', 'api-compat-allowlist.json'), 'utf8'))
// Only a major release may break the API: one a pending `major` changeset makes, or, on the release pull request once
// changesets has consumed it, a version whose major is above the published one's
const majorOf = (version: string) => Number(version.split('.')[0])
const version: string = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version
const major =
  majorOf(version) > majorOf(against) ||
  readdirSync(path.join(repoRoot, '.changeset')).some(
    file => file.endsWith('.md') && /^['"]?meocord['"]?:\s*major\s*$/m.test(readFileSync(path.join(repoRoot, '.changeset', file), 'utf8')),
  )

const problems: string[] = []
const allowed = new Set<string>()
// The generic signatures that changed as text, once per entry: its .d.ts and .d.cts declare the same ones
const review = new Set<string>()
for (const { file, before, after } of pairs) {
  const entry = file.replace(/^dist\/types\//, '').replace(/\/index\.d\.c?ts$|\.d\.c?ts$/, '')
  const compared = apiBreaks(checker, program.getSourceFile(before)!, program.getSourceFile(after)!)
  for (const line of compared.review) review.add(`${entry} ${line}`)
  for (const { path: where, problem } of compared.breaks) {
    const id = `${entry} ${where}`
    if (allowlist[id]) allowed.add(id)
    else problems.push(`${file}: ${where} ${problem}`)
  }
}
const stale = Object.keys(allowlist).filter(id => !allowed.has(id))

// Listed for a reviewer to read, not failed: the checker cannot relate a generic's parameters and return across versions
if (review.size > 0) {
  console.log(
    `${review.size} generic signature(s) changed since meocord@${against}; check each still accepts and returns what it did:\n` +
      [...review].map(line => `  - ${line}`).join('\n'),
  )
}

if (problems.length > 0) {
  console.error(
    `The built declarations break ${problems.length} thing(s) code written against meocord@${against} relies on:\n` +
      problems.map(problem => `  - ${problem}`).join('\n') +
      '\nRestore them, or, for a deliberate break in a major release, name each in scripts/api-compat-allowlist.json with its reason.',
  )
  process.exit(1)
}
if (stale.length > 0) {
  console.error(`scripts/api-compat-allowlist.json names what no longer breaks; remove: ${stale.join(', ')}`)
  process.exit(1)
}
if (Object.keys(allowlist).length > 0 && !major) {
  console.error('scripts/api-compat-allowlist.json allows breaks, but this release is not a major one: no pending changeset or version makes it one.')
  process.exit(1)
}
console.log(
  `The built declarations keep every export and member of meocord@${against}'s ${pairs.length} declaration files` +
    (allowed.size ? `, but the ${allowed.size} allowed for this major release.` : '.'),
)
