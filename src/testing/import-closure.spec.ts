import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

/** The repository's `src`, which the `@src/` alias names. */
const SRC = path.resolve(import.meta.dirname, '..')

/** A source's path under `root`, with `/` between its parts on every platform. */
const nameOf = (file: string, root = SRC, paths: typeof path = path): string => paths.relative(root, file).split(paths.sep).join('/')

/** A source file an import names, or `undefined` for a package. */
function sourceOf(specifier: string, from: string): string | undefined {
  const unaliased = specifier.startsWith('@src/') ? path.join(SRC, specifier.slice('@src/'.length)) : specifier
  if (!unaliased.startsWith('.') && !path.isAbsolute(unaliased)) return undefined
  const file = path.resolve(path.dirname(from), unaliased).replace(/\.js$/, '')
  return [`${file}.ts`, path.join(file, 'index.ts')].find(existsSync)
}

/**
 * The sources a module loads, and each package it loads with the chain of sources that leads to it, directly or through
 * the sources it imports. Type-only imports are left out: they load nothing at runtime.
 */
function closureOf(entry: string): { sources: Set<string>; packages: Map<string, string[]> } {
  const packages = new Map<string, string[]>()
  const seen = new Set<string>()
  const visit = (file: string, chain: string[]) => {
    if (seen.has(file)) return
    seen.add(file)
    const text = readFileSync(file, 'utf8')
    const { importedFiles } = ts.preProcessFile(text, true, true)
    for (const { fileName } of importedFiles) {
      if (typeOnly(text, fileName)) continue
      const source = sourceOf(fileName, file)
      const next = [...chain, nameOf(file)]
      if (source) visit(source, next)
      else if (!packages.has(fileName)) packages.set(fileName, next)
    }
  }
  visit(entry, [])
  return { sources: new Set([...seen].map(file => nameOf(file))), packages }
}

/** Whether every import of a specifier in a file is `import type` or `export type`. */
function typeOnly(text: string, specifier: string): boolean {
  const quoted = `['"]${specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`
  const all = text.match(new RegExp(`^(?:import|export)[^;]*?from\\s+${quoted}`, 'gms')) ?? []
  return all.length > 0 && all.every(statement => /^(?:import|export)\s+type\b/.test(statement))
}

it('loads no cli-table3 through meocord/testing, which never registers commands', () => {
  const { sources, packages } = closureOf(path.join(SRC, 'testing', 'index.ts'))

  // A control: the walk follows the alias into the modules that check commands, so a walk that stops early can't pass
  expect([sources.has('core/command-conflicts.ts'), sources.has('core/command-identity.ts')]).toEqual([true, true])
  expect(packages.get('cli-table3')).toBeUndefined()
})

// The walk's names are compared with `/`, which a Windows path writes as `\`
it('names a source with / between its parts on Windows too', () => {
  expect(nameOf('D:\\a\\meocord\\src\\core\\command-conflicts.ts', 'D:\\a\\meocord\\src', path.win32)).toBe('core/command-conflicts.ts')
})
