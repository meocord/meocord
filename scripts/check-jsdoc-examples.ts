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
      // Exported for the types' sake, but not public API: the reference leaves it out
      if (tags.some(tag => tag.name === 'internal')) continue
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

/**
 * How many sentences a summary holds. Code spans and links read as capitalised words, since either can start a
 * sentence, and abbreviations such as "e.g." as plain ones; a sentence may end inside a closing quote or bracket.
 */
function sentenceCount(text: string): number {
  const plain = text
    .replace(/`[^`]*`/g, 'Code')
    .replace(/\{@link [^}]*\}/g, 'Link')
    .replace(/\b(e\.g|i\.e|etc|vs)\./g, 'abbreviation')
  return plain.split(/(?<=[.!?]["'”’)]?)\s+(?=[A-Z`@'"“(])/).filter(sentence => sentence.trim() !== '').length
}

/** Whether a declaration has a comment of its own with text, not only tags. */
const commented = (declaration: ts.Node) =>
  ts.getJSDocCommentsAndTags(declaration).some(doc => ts.isJSDoc(doc) && (ts.getTextOfJSDocComment(doc.comment) ?? '').trim() !== '')

/**
 * The signatures of an overloaded function or method with no comment of their own, numbered from 1: the reference
 * shows each signature apart, with its own comment.
 */
function uncommentedOverloads(declarations: readonly ts.Declaration[] | undefined): number[] {
  const signatures = (declarations ?? []).filter(declaration => ts.isFunctionDeclaration(declaration) || ts.isMethodSignature(declaration) || ts.isMethodDeclaration(declaration))
  if (signatures.length < 2) return []
  return signatures.flatMap((signature, index) => (commented(signature) ? [] : [index + 1]))
}

/**
 * An interface's own properties and methods with no comment of their own, which the reference would show blank, and
 * each overload of a method that has none.
 */
function undocumentedMembers(checker: ts.TypeChecker, symbol: ts.Symbol): string[] {
  if (!(symbol.flags & ts.SymbolFlags.Interface)) return []
  const own = new Set<ts.Node>(symbol.declarations)
  return checker
    .getPropertiesOfType(checker.getDeclaredTypeOfSymbol(symbol))
    .filter(member => member.declarations?.some(declaration => own.has(declaration.parent)))
    .filter(member => !member.getJsDocTags(checker).some(tag => tag.name === 'internal'))
    .flatMap(member => {
      if (ts.displayPartsToString(member.getDocumentationComment(checker)).trim() === '') return [member.name]
      return uncommentedOverloads(member.declarations).map(number => `${member.name} (signature ${number})`)
    })
}

/** The names a module exports, from a file in the program. */
function exportedNames(program: ts.Program, file: string): Set<string> {
  const checker = program.getTypeChecker()
  const source = program.getSourceFile(file)
  const moduleSymbol = source && checker.getSymbolAtLocation(source)
  return new Set(moduleSymbol ? checker.getExportsOfModule(moduleSymbol).map(symbol => symbol.name) : [])
}

/**
 * A snippet as module code, or as class members after any module code before them, such as a decorator
 * defined and then used: `members` is `undefined` when the whole snippet is module code.
 */
function splitMembers(code: string): { outside: string; members?: string } {
  if (parsesAsModule(code)) return { outside: code }
  const lines = code.split('\n')
  for (let index = 0; index < lines.length; index++) {
    if (!/^(@|constructor\(|async |private |public |protected |readonly |static |[A-Za-z_$][\w$]*\()/.test(lines[index])) continue
    const outside = lines.slice(0, index).join('\n')
    const members = lines.slice(index).join('\n')
    if (parsesAsModule(outside) && parsesAsModule(`class Example {\n${members}\n}`)) return { outside, members }
  }
  return { outside: '', members: code }
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
  const checker = base.getTypeChecker()
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

  const files = new Map<string, { label: string; code: string; lineOf: (number | undefined)[] }>()
  for (const item of symbols.values()) {
    if (!item.group) continue
    if (!GROUPS.includes(item.group)) problems.push(`${item.name}: @group ${item.group} is not one of ${GROUPS.join(', ')}.`)
    // A symbol with a @group follows the whole standard: the reference renders it from these
    const sentences = sentenceCount(item.summary)
    if (sentences === 0) problems.push(`${item.name}: it has no summary; the comment's first paragraph is its summary.`)
    if (sentences > 1) {
      problems.push(`${item.name}: its summary is ${sentences} sentences; start a new paragraph after the first.`)
    }
    if (!item.isType && item.examples.length === 0) problems.push(`${item.name}: it has no @example; only a type may skip one.`)
    const overloads = uncommentedOverloads(item.symbol.declarations)
    if (overloads.length > 0) {
      problems.push(`${item.name}: its signature ${overloads.join(' and ')} ${overloads.length > 1 ? 'have' : 'has'} no comment of ${overloads.length > 1 ? 'their' : 'its'} own.`)
    }
    const blank = undocumentedMembers(checker, item.symbol)
    if (blank.length > 0) {
      const [verb, own] = blank.length > 1 ? ['have no comments', 'their'] : ['has no comment', 'its']
      problems.push(`${item.name}: ${blank.join(', ')} ${verb} of ${own} own.`)
    }
    for (const stage of item.stages) {
      if (!STAGES.includes(stage)) problems.push(`${item.name}: @pipeline ${stage} is not one of ${STAGES.join(', ')}.`)
    }
    item.examples.forEach((snippet, index) => {
      // A library the example shows, such as a schema library, is imported by the example itself, first
      const lines = snippet.split('\n')
      const start = Math.max(0, lines.findIndex(line => !/^import .+ from '[^']+'$/.test(line) && line.trim() !== ''))
      const ownImports = lines.slice(0, start).filter(line => line.trim() !== '')
      const exampleLines = lines.slice(start)
      const { outside, members } = splitMembers(exampleLines.join('\n'))
      const wrapped = members !== undefined
      const outsideCount = !wrapped ? exampleLines.length : outside === '' ? 0 : outside.split('\n').length
      const body = wrapped ? `${outside}\n@Controller()\nexport class Example {\n${members}\n}\n` : `${exampleLines.join('\n')}\n`
      // The names the snippet's own imports bind, which are not looked up again
      const imported = new Set(ownImports.flatMap(line => /^import (.+) from/.exec(line)![1].match(/[A-Za-z_$][\w$]*/g) ?? []))
      const autoImports: string[] = []
      for (const name of [...freeNames(body)].sort()) {
        if (imported.has(name)) continue
        const from = sources.get(name)
        if (!from) continue
        if (from.size > 1) {
          problems.push(`${item.name}: its example uses ${name}, which ${[...from].join(' and ')} both export; name it differently.`)
          continue
        }
        const [module] = from
        autoImports.push(`import { ${name} } from '${module === './fixtures' ? '../scripts/jsdoc-examples/fixtures.js' : module}'`)
      }
      // The compiled file, with the snippet's line number for each of its lines
      const code: string[] = []
      const lineOf: (number | undefined)[] = []
      const add = (text: string, snippetLine?: number) => {
        code.push(text)
        lineOf.push(snippetLine)
      }
      lines.slice(0, start).forEach((line, i) => line.trim() !== '' && add(line, i + 1))
      for (const line of autoImports) add(line)
      exampleLines.slice(0, outsideCount).forEach((line, i) => add(line, start + i + 1))
      if (wrapped) {
        add('@Controller()')
        add('export class Example {')
        exampleLines.slice(outsideCount).forEach((line, i) => add(line, start + outsideCount + i + 1))
        add('}')
      }
      add('export {}')
      // Keyed by a counter: on a case-insensitive disk, UseTheme and useTheme would be one file
      const label = `${item.name}: its example${item.examples.length > 1 ? ` ${index + 1}` : ''}`
      files.set(path.join(examplesDir, `${files.size}.ts`), { label, code: `${code.join('\n')}\n`, lineOf })
    })
  }

  // The examples, the fixtures and the built package, in one program. An example that augments a module or the global
  // scope, as a theme's own tokens do, gets a program of its own, so its augmentation cannot change the types another
  // example sees; each reuses what the shared program parsed.
  const host = ts.createCompilerHost(compilerOptions)
  const readFile = host.readFile.bind(host)
  const fileExists = host.fileExists.bind(host)
  host.readFile = file => files.get(path.resolve(file))?.code ?? readFile(file)
  host.fileExists = file => files.has(path.resolve(file)) || fileExists(file)
  const augmenting = [...files.keys()].filter(file => /\bdeclare\s+(module|global)\b/.test(files.get(file)!.code))
  const shared = ts.createProgram(
    [...files.keys()].filter(file => !augmenting.includes(file)).concat(fixturesFile),
    compilerOptions,
    host,
  )
  const diagnostics = [
    ...ts.getPreEmitDiagnostics(shared),
    ...augmenting.flatMap(file => {
      const program = ts.createProgram({ rootNames: [file], options: compilerOptions, host, oldProgram: shared })
      // Only its own: the package and discord.js are reported once, by the shared program
      return ts.getPreEmitDiagnostics(program).filter(diagnostic => diagnostic.file && path.resolve(diagnostic.file.fileName) === file)
    }),
  ]
  for (const diagnostic of diagnostics) {
    const file = diagnostic.file?.fileName && path.resolve(diagnostic.file.fileName)
    const example = file ? files.get(file) : undefined
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
    if (example && diagnostic.start !== undefined) {
      const line = example.lineOf[diagnostic.file!.getLineAndCharacterOfPosition(diagnostic.start).line]
      problems.push(`${example.label}${line === undefined ? '' : `, line ${line}`}: ${message}`)
    } else if (!file) {
      problems.push(`The examples' compiler options: ${message}`)
    } else if (file === fixturesFile || example) {
      problems.push(`${path.relative(repoRoot, file)}: ${message}`)
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
