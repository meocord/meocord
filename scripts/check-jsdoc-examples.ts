/**
 * Compiles the `@example` of every public symbol that follows the JSDoc standard (it has a `@group`), against the
 * built package: the names it uses from meocord's entry points, discord.js or the fixtures are imported for it, and a
 * snippet of class members is compiled inside a controller. Run after `bun run build`.
 *
 * `--coverage` also lists the public symbols still missing a `@group`, a summary or, unless a type, an example.
 */

import { existsSync, readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import ts from 'typescript'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixturesFile = path.join(repoRoot, 'scripts/jsdoc-examples/fixtures.ts')
const examplesDir = path.join(repoRoot, '.jsdoc-examples')

/** The groups the docs site files symbols under; see CONTRIBUTING.md. */
const GROUPS = ['Controllers', 'Decorators', 'Responses', 'Utilities', 'Testing', 'Configuration', 'CLI', 'Types']
/** The pipeline stages `@pipeline` names, in the order a call runs. */
const STAGES = ['observers', 'filters', 'defer', 'parse', 'guards', 'cooldown-check', 'fetch', 'interceptors', 'validation', 'pipes', 'cooldowns', 'lock', 'handler']

const compilerOptions: ts.CompilerOptions = {
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  target: ts.ScriptTarget.ES2022,
  strict: true,
  experimentalDecorators: true,
  emitDecoratorMetadata: true,
  skipLibCheck: true,
  noEmit: true,
  // As an app has them: Node's globals, such as `console` and `performance`
  types: ['node'],
}

interface PublicSymbol {
  name: string
  entries: string[]
  symbol: ts.Symbol
  isType: boolean
  summary: string
  group?: string
  stages: string[]
  examples: string[]
}

/** The package's entry points that ship types, as `meocord/<entry>` to the `.d.ts` file. */
function entryPoints(): Map<string, string> {
  const manifest = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
    exports: Record<string, { import?: { types?: string } }>
  }
  const entries = new Map<string, string>()
  for (const [key, value] of Object.entries(manifest.exports)) {
    const types = value.import?.types
    if (key.startsWith('./') && types) entries.set(`meocord/${key.slice(2)}`, path.join(repoRoot, types))
  }
  return entries
}

interface ParsedDoc {
  summary: string
  tags: { name: string; text: string }[]
}

/**
 * A symbol's JSDoc, read from its declaration's comment as TypeDoc reads it: a line starting with `@` inside a code
 * fence is code, where TypeScript's own parser takes an example's decorators for tags.
 */
function parsedDoc(symbol: ts.Symbol): ParsedDoc {
  for (const declaration of symbol.declarations ?? []) {
    const comment = ts.getJSDocCommentsAndTags(declaration).find(ts.isJSDoc)
    if (!comment) continue
    const lines = comment
      .getSourceFile()
      .text.slice(comment.pos, comment.end)
      .replace(/^\/\*\*|\*\/$/g, '')
      .split('\n')
      .map(line => line.replace(/^\s*\* ?/, ''))
    const description: string[] = []
    const tags: { name: string; text: string[] }[] = []
    let fenced = false
    for (const line of lines) {
      const tag = !fenced && /^@(\w+)\s?(.*)$/.exec(line)
      if (tag) tags.push({ name: tag[1], text: [tag[2]] })
      else (tags.at(-1)?.text ?? description).push(line)
      if (/^\s*(```|~~~)/.test(line)) fenced = !fenced
    }
    return {
      summary: description.join('\n').trim().split(/\n\s*\n/)[0] ?? '',
      tags: tags.map(({ name, text }) => ({ name, text: text.join('\n').trim() })),
    }
  }
  return { summary: '', tags: [] }
}

/** Every public symbol, once however many entry points export it, with the parts of its JSDoc the standard asks for. */
function publicSymbols(program: ts.Program, entries: Map<string, string>): Map<ts.Symbol, PublicSymbol> {
  const checker = program.getTypeChecker()
  const symbols = new Map<ts.Symbol, PublicSymbol>()
  for (const [entry, file] of entries) {
    const source = program.getSourceFile(file)
    const moduleSymbol = source && checker.getSymbolAtLocation(source)
    if (!moduleSymbol) throw new Error(`${entry}: ${path.relative(repoRoot, file)} was not built. Run bun run build first.`)
    for (const exported of checker.getExportsOfModule(moduleSymbol)) {
      const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported
      const known = symbols.get(symbol)
      if (known) {
        known.entries.push(entry)
        continue
      }
      const { summary, tags } = parsedDoc(symbol)
      symbols.set(symbol, {
        name: exported.name,
        entries: [entry],
        symbol,
        isType: !(symbol.flags & ts.SymbolFlags.Value),
        summary,
        group: tags.find(tag => tag.name === 'group')?.text,
        stages: tags.filter(tag => tag.name === 'pipeline').map(tag => tag.text.split(/\s/)[0]),
        examples: tags.filter(tag => tag.name === 'example').map(tag => fencedCode(tag.text)),
      })
    }
  }
  return symbols
}

/** An example's code, without its fence. */
function fencedCode(text: string): string {
  const match = /```[a-z]*\n([\s\S]*?)\n?```/.exec(text)
  return (match ? match[1] : text).trimEnd()
}

/** The names a module exports, from a file in the program. */
function exportedNames(program: ts.Program, file: string): Set<string> {
  const checker = program.getTypeChecker()
  const source = program.getSourceFile(file)
  const moduleSymbol = source && checker.getSymbolAtLocation(source)
  return new Set(moduleSymbol ? checker.getExportsOfModule(moduleSymbol).map(symbol => symbol.name) : [])
}

/** Whether a snippet parses as a module, rather than as class members. */
function parsesAsModule(code: string): boolean {
  return (ts.transpileModule(code, { reportDiagnostics: true, compilerOptions }).diagnostics ?? []).length === 0
}

/** Whether a node declares its name in the snippet's scope. */
function declares(node: ts.Node): boolean {
  return (
    ts.isVariableDeclaration(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isParameter(node) ||
    ts.isBindingElement(node) ||
    ts.isTypeParameterDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isImportSpecifier(node) ||
    ts.isImportClause(node) ||
    ts.isNamespaceImport(node)
  )
}

/** The identifiers a snippet reads and does not declare itself: the names to import for it. */
function freeNames(code: string): Set<string> {
  const source = ts.createSourceFile('snippet.ts', code, ts.ScriptTarget.ES2022, true)
  const declared = new Set<string>()
  const used = new Set<string>()
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node)) {
      const parent = node.parent
      const isName = (parent as { name?: ts.Node }).name === node
      if ((ts.isPropertyAccessExpression(parent) || ts.isQualifiedName(parent)) && isName) return
      if (ts.isPropertyAssignment(parent) && isName) return
      // A member's name is neither declared in scope nor read
      if (isName && (ts.isPropertyDeclaration(parent) || ts.isMethodDeclaration(parent) || ts.isPropertySignature(parent) || ts.isMethodSignature(parent))) return
      if (isName && declares(parent)) {
        declared.add(node.text)
        return
      }
      used.add(node.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  for (const name of declared) used.delete(name)
  return used
}

function main(): void {
  const entries = entryPoints()
  // The declarations an example's `import … from 'discord.js'` resolves to
  const discordTypes = ts.resolveModuleName('discord.js', path.join(examplesDir, 'x.ts'), compilerOptions, ts.sys).resolvedModule
    ?.resolvedFileName
  if (!discordTypes) throw new Error('discord.js could not be resolved. Run bun install first.')
  const base = ts.createProgram([...entries.values(), discordTypes, fixturesFile], compilerOptions)
  const symbols = publicSymbols(base, entries)
  const problems: string[] = []

  // Where each importable name comes from; a name with two sources is refused rather than guessed
  const sources = new Map<string, Set<string>>()
  const add = (name: string, from: string) => sources.set(name, (sources.get(name) ?? new Set()).add(from))
  for (const { name, entries: from } of symbols.values()) add(name, from[0])
  for (const name of exportedNames(base, discordTypes)) add(name, 'discord.js')
  const fixtures = exportedNames(base, fixturesFile)
  for (const name of fixtures) {
    if (sources.has(name)) problems.push(`scripts/jsdoc-examples/fixtures.ts: ${name} shadows an export of ${[...sources.get(name)!].join(', ')}.`)
    add(name, './fixtures')
  }

  const files = new Map<string, { owner: string; code: string; offset: number }>()
  for (const item of symbols.values()) {
    if (!item.group) continue
    if (!GROUPS.includes(item.group)) problems.push(`${item.name}: @group ${item.group} is not one of ${GROUPS.join(', ')}.`)
    for (const stage of item.stages) {
      if (!STAGES.includes(stage)) problems.push(`${item.name}: @pipeline ${stage} is not one of ${STAGES.join(', ')}.`)
    }
    item.examples.forEach((snippet, index) => {
      // A library the example shows, such as a schema library, is imported by the example itself, first
      const lines = snippet.split('\n')
      const start = Math.max(0, lines.findIndex(line => !/^import .+ from '[^']+'$/.test(line) && line.trim() !== ''))
      const ownImports = lines.slice(0, start).filter(line => line.trim() !== '')
      const example = lines.slice(start).join('\n')
      const wrapped = !parsesAsModule(example)
      const body = wrapped ? `@Controller()\nexport class Example {\n${example}\n}\n` : `${example}\n`
      const imports: string[] = [...ownImports]
      // The names those imports bind, which are not looked up again
      const imported = new Set(ownImports.flatMap(line => /^import (.+) from/.exec(line)![1].match(/[A-Za-z_$][\w$]*/g) ?? []))
      for (const name of [...freeNames(body)].sort()) {
        if (imported.has(name)) continue
        const from = sources.get(name)
        if (!from) continue
        if (from.size > 1) {
          problems.push(`${item.name}: its example uses ${name}, which ${[...from].join(' and ')} both export; name it differently.`)
          continue
        }
        const [module] = from
        imports.push(`import { ${name} } from '${module === './fixtures' ? '../scripts/jsdoc-examples/fixtures.js' : module}'`)
      }
      const code = `${imports.join('\n')}\n${body}export {}\n`
      files.set(path.join(examplesDir, `${item.name}.${index}.ts`), {
        owner: item.name,
        code,
        // Lines before the snippet's code, less the snippet's own import lines: the imports, and the wrapper's two
        offset: imports.length + (wrapped ? 2 : 0) - start,
      })
    })
  }

  // The examples, the fixtures and the built package, in one program
  const host = ts.createCompilerHost(compilerOptions)
  const readFile = host.readFile.bind(host)
  const fileExists = host.fileExists.bind(host)
  host.readFile = file => files.get(path.resolve(file))?.code ?? readFile(file)
  host.fileExists = file => files.has(path.resolve(file)) || fileExists(file)
  const program = ts.createProgram([...files.keys(), fixturesFile], compilerOptions, host)
  for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
    const file = diagnostic.file?.fileName && path.resolve(diagnostic.file.fileName)
    const example = file ? files.get(file) : undefined
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
    if (example && diagnostic.start !== undefined) {
      const line = diagnostic.file!.getLineAndCharacterOfPosition(diagnostic.start).line + 1 - example.offset
      problems.push(`${example.owner}: its example, line ${line}: ${message}`)
    } else if (file === fixturesFile || example) {
      problems.push(`${path.relative(repoRoot, file!)}: ${message}`)
    }
  }

  const following = [...symbols.values()].filter(item => item.group)
  console.log(`${files.size} examples of ${following.length} of ${symbols.size} public symbols checked.`)

  if (process.argv.includes('--coverage')) {
    const missing = [...symbols.values()]
      .map(item => {
        const lacks = [!item.group && '@group', !item.summary && 'summary', !item.isType && item.examples.length === 0 && '@example'].filter(Boolean)
        return { item, lacks }
      })
      .filter(({ lacks }) => lacks.length > 0)
    const byEntry = new Map<string, string[]>()
    for (const { item, lacks } of missing) {
      const entry = item.entries[0]
      byEntry.set(entry, [...(byEntry.get(entry) ?? []), `${item.name} (${lacks.join(', ')})`])
    }
    console.log(`\n${missing.length} public symbols do not follow the JSDoc standard yet:`)
    for (const [entry, names] of [...byEntry].sort(([a], [b]) => a.localeCompare(b))) {
      console.log(`\n${entry} (${names.length})\n  ${names.sort().join('\n  ')}`)
    }
  }

  if (problems.length > 0) {
    console.error(`\n${problems.join('\n')}`)
    process.exit(1)
  }
}

if (!existsSync(path.join(repoRoot, 'dist/types'))) {
  console.error('dist/types is missing. Run bun run build first.')
  process.exit(1)
}
main()
