/**
 * Writes THIRD_PARTY_NOTICES.md from the installed dependencies, with the license texts of those the CommonJS build
 * bundles, formatted by prettier.
 * `--check` fails when the file differs from what would be written, so CI catches a missing notice.
 * Versions are left out: they change on every update, while license and source do not.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { format, resolveConfig } from 'prettier'
import { bundledPackages } from './es-module-only.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputPath = path.join(repoRoot, 'THIRD_PARTY_NOTICES.md')

interface Manifest {
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  license?: string | { type?: string }
  repository?: string | { url?: string }
  homepage?: string
}

function readManifest(dir: string): Manifest {
  return JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as Manifest
}

function licenseOf(manifest: Manifest): string {
  if (typeof manifest.license === 'string') return manifest.license
  return manifest.license?.type ?? 'UNKNOWN'
}

/** A browsable URL for a package's source, from the forms `repository` takes in practice. */
function sourceOf(name: string, manifest: Manifest): string {
  const raw = typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url
  if (!raw) return manifest.homepage ?? `https://www.npmjs.com/package/${name}`

  const url = raw
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/^ssh:\/\/git@/, 'https://')
    .replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/\.git$/, '')
  // `owner/repo` and `github:owner/repo` are shorthands for GitHub.
  if (/^(github:)?[\w.-]+\/[\w.-]+$/.test(url)) return `https://github.com/${url.replace(/^github:/, '')}`
  return url
}

function table(names: string[]): string {
  const rows = names.map(name => {
    const dir = path.join(repoRoot, 'node_modules', name)
    if (!existsSync(path.join(dir, 'package.json'))) {
      throw new Error(`${name} is not installed; run \`bun install\` before generating notices.`)
    }
    const manifest = readManifest(dir)
    return `| [${name}](https://www.npmjs.com/package/${name}) | ${licenseOf(manifest)} | ${sourceOf(name, manifest)} |`
  })
  return ['| Package | License | Source |', '| --- | --- | --- |', ...rows].join('\n')
}

/** Specifications whose interfaces MeoCord declares itself; no package supplies them, so they are listed here. */
const INTERFACES = [
  {
    name: 'Standard Schema',
    url: 'https://standardschema.dev',
    license: 'MIT',
    source: 'https://github.com/standard-schema/standard-schema',
    usedIn: '`StandardSchemaV1` in `meocord/interface`',
  },
]

function interfaceTable(): string {
  const rows = INTERFACES.map(({ name, url, license, source, usedIn }) => `| [${name}](${url}) | ${license} | ${source} | ${usedIn} |`)
  return ['| Specification | License | Source | Declared as |', '| --- | --- | --- | --- |', ...rows].join('\n')
}

/** A package's license file as it ships, which a bundled copy carries with it. */
function licenseTextOf(name: string): string {
  const dir = path.join(repoRoot, 'node_modules', name)
  const file = readdirSync(dir).find(each => /^licen[cs]e(\.md|\.txt)?$/i.test(each))
  if (!file) throw new Error(`${name} has no license file to carry with its bundled copy.`)
  return readFileSync(path.join(dir, file), 'utf8').trim()
}

/** The license texts of the bundled packages, one section per distinct text, naming each package it covers. */
function bundledLicenses(names: string[]): string {
  const byText = new Map<string, string[]>()
  for (const name of names) {
    const text = licenseTextOf(name)
    byText.set(text, [...(byText.get(text) ?? []), name])
  }
  return [...byText].map(([text, covered]) => `### ${covered.join(', ')}\n\n\`\`\`text\n${text}\n\`\`\``).join('\n\n')
}

function generate(): string {
  const own = readManifest(repoRoot)
  const dependencies = Object.keys(own.dependencies ?? {}).sort()
  const peers = Object.keys(own.peerDependencies ?? {}).sort()
  const bundled = bundledPackages(repoRoot)

  return `# Third-Party Notices

MeoCord is licensed under the [MIT License](./LICENSE). It depends on the open-source packages
below, each under its own license.

npm installs each dependency alongside MeoCord, with its own license file. MeoCord's CommonJS build
also carries a copy of its ES-module-only dependencies, so that \`require()\` loads it; those copies
are listed with their license texts. This list is a record of what MeoCord relies on, and of the
terms those packages are offered under. One published interface is declared in MeoCord's own types
instead of installed; it is listed last.

## Dependencies

Installed with MeoCord.

${table(dependencies)}

## Peer dependencies

Installed by the application using MeoCord.

${table(peers)}

## Bundled into the CommonJS build

Copied into \`dist/cjs\`, because they ship only as ES modules. The ES module build imports the
installed packages instead.

${table(bundled)}

${bundledLicenses(bundled)}

## Interfaces

Declared in MeoCord's type definitions, following a published specification, rather than installed.

${interfaceTable()}

---

Generated by \`scripts/third-party-notices.ts\` from the installed packages. Run
\`bun run notices\` after adding or removing a dependency.
`
}

// Formatted the same way `bun run format` formats every other Markdown file, so the file is never
// exempt from prettier and the check below compares against what prettier would leave.
const generated = await format(generate(), { ...(await resolveConfig(outputPath)), filepath: outputPath })

if (process.argv.includes('--check')) {
  const current = existsSync(outputPath) ? readFileSync(outputPath, 'utf8') : ''
  if (current !== generated) {
    console.error('THIRD_PARTY_NOTICES.md is out of date. Run `bun run notices` and commit the result.')
    process.exit(1)
  }
  console.log('THIRD_PARTY_NOTICES.md is up to date.')
} else {
  writeFileSync(outputPath, generated)
  console.log(`Wrote ${path.relative(repoRoot, outputPath)}`)
}
