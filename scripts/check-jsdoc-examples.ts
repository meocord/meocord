/**
 * Checks that every public symbol has a `@group`, checks its JSDoc and compiles its `@example`, and the README's
 * blocks, against the built package, after `bun run build`. `--coverage` lists the symbols still missing parts; `--fix`
 * only moves every documentation link, in the JSDoc and the app templates, onto the package's own line, with no build:
 * `release:version` runs it after setting the version, so a new minor's release and the apps it creates carry its links.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import ts from 'typescript'
import { documentationProblems, exportedSymbols, importSources, publicSymbols } from './lib/public-symbols.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixturesFile = path.join(repoRoot, 'scripts/jsdoc-examples/fixtures.ts')
const examplesDir = path.join(repoRoot, '.jsdoc-examples')

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

/** The documentation line the package's links name: its major and minor version, such as `4.1` for 4.1.0-beta.6. */
function docsLine(): string {
  const { version } = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as { version: string }
  return version.split('.').slice(0, 2).join('.')
}

/** The files whose documentation links a reader follows: the package's JSDoc, and the templates a new app is made from. */
function sourceFiles(dir = path.join(repoRoot, 'src')): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(file)
    if (entry.name.endsWith('.template')) return [file]
    return /\.ts$/.test(entry.name) && !/\.(spec|test-d)\.ts$/.test(entry.name) ? [file] : []
  })
}

const DOCS_LINK = /https:\/\/meocord\.dev\/docs\/([^/\s|}]+)\//g

/**
 * The links to another line of the documentation than the package's, which would send a reader to pages for another
 * version; `fix` rewrites them to the package's line instead, and returns the files it rewrote.
 */
function staleDocsLinks(line: string, fix: boolean): string[] {
  const stale: string[] = []
  for (const file of sourceFiles()) {
    const text = readFileSync(file, 'utf8')
    if (fix) {
      const fixed = text.replace(DOCS_LINK, (link, linked: string) => (linked === line ? link : `https://meocord.dev/docs/${line}/`))
      if (fixed !== text) {
        writeFileSync(file, fixed)
        stale.push(path.relative(repoRoot, file))
      }
      continue
    }
    text.split('\n').forEach((content, index) => {
      for (const [, linked] of content.matchAll(DOCS_LINK)) {
        if (linked !== line) {
          stale.push(`${path.relative(repoRoot, file)}:${index + 1}: links docs/${linked}; link docs/${line}, the package's line, or run with --fix.`)
        }
      }
    })
  }
  return stale
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

/** The TypeScript code blocks of the README, each with the README line its code starts on. */
function readmeBlocks(): { code: string; firstLine: number }[] {
  const lines = readFileSync(path.join(repoRoot, 'README.md'), 'utf8').split('\n')
  const blocks: { code: string; firstLine: number }[] = []
  for (let i = 0; i < lines.length; i++) {
    if (!/^```(ts|typescript)\s*$/.test(lines[i])) continue
    const end = lines.findIndex((line, j) => j > i && line.startsWith('```'))
    blocks.push({ code: lines.slice(i + 1, end).join('\n'), firstLine: i + 2 })
    i = end
  }
  return blocks
}

function main(): void {
  const line = docsLine()
  const entries = entryPoints()
  // The declarations an example's `import … from 'discord.js'` resolves to, as an ES module, as the package's own
  // re-exports of it resolve: its CommonJS typings would declare every name a second time
  const discordTypes = ts.resolveModuleName('discord.js', path.join(examplesDir, 'x.ts'), compilerOptions, ts.sys, undefined, undefined, ts.ModuleKind.ESNext).resolvedModule
    ?.resolvedFileName
  if (!discordTypes) throw new Error('discord.js could not be resolved. Run bun install first.')
  const base = ts.createProgram([...entries.values(), discordTypes, fixturesFile], compilerOptions)
  const symbols = publicSymbols(base, entries, path.join(repoRoot, 'dist/types'))
  const checker = base.getTypeChecker()
  const problems: string[] = [...staleDocsLinks(line, false)]

  // Where each importable name comes from; a name with two sources is refused rather than guessed
  const sources = importSources(symbols, { 'discord.js': exportedSymbols(base, discordTypes) })
  for (const name of exportedSymbols(base, fixturesFile).keys()) {
    if (sources.has(name)) problems.push(`scripts/jsdoc-examples/fixtures.ts: ${name} shadows an export of ${[...sources.get(name)!].join(', ')}.`)
    sources.set(name, (sources.get(name) ?? new Set()).add('./fixtures'))
  }

  const files = new Map<string, { label: string; code: string; lineOf: (number | undefined)[] }>()
  /**
   * Adds one snippet as a file of its own, its own imports first, then the names it uses from the package,
   * discord.js and the fixtures. `firstLine` is where its first line stands, for reporting.
   */
  const addExample = (owner: string, label: string, snippet: string, firstLine = 1) => {
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
        problems.push(`${owner}: its example uses ${name}, which ${[...from].join(' and ')} both export; name it differently.`)
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
    lines.slice(0, start).forEach((line, i) => line.trim() !== '' && add(line, firstLine + i))
    for (const line of autoImports) add(line)
    exampleLines.slice(0, outsideCount).forEach((line, i) => add(line, firstLine + start + i))
    if (wrapped) {
      add('@Controller()')
      add('export class Example {')
      exampleLines.slice(outsideCount).forEach((line, i) => add(line, firstLine + start + outsideCount + i))
      add('}')
    }
    add('export {}')
    // Keyed by a counter: on a case-insensitive disk, UseTheme and useTheme would be one file
    files.set(path.join(examplesDir, `${files.size}.ts`), { label, code: `${code.join('\n')}\n`, lineOf })
  }

  for (const item of symbols.values()) {
    problems.push(...documentationProblems(checker, item))
    if (item.external || !item.group) continue
    item.examples.forEach((snippet, index) =>
      addExample(item.name, `${item.name}: its example${item.examples.length > 1 ? ` ${index + 1}` : ''}`, snippet),
    )
  }

  // The README's TypeScript blocks: the landing page's example must compile as a reader copies it
  readmeBlocks().forEach(({ code, firstLine }, index, blocks) =>
    addExample('README.md', `README.md: its example${blocks.length > 1 ? ` ${index + 1}` : ''}`, code, firstLine),
  )

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

  const own = [...symbols.values()].filter(item => !item.external)
  const following = own.filter(item => item.group)
  console.log(`${files.size} examples of ${following.length} of ${own.length} public symbols checked.`)

  if (process.argv.includes('--coverage')) {
    const missing = own
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

if (process.argv.includes('--fix')) {
  const line = docsLine()
  const moved = staleDocsLinks(line, true)
  console.log(moved.length > 0 ? `Moved the documentation links of ${moved.length} file(s) to docs/${line}.` : `Every documentation link names docs/${line}.`)
  process.exit(0)
}
if (!existsSync(path.join(repoRoot, 'dist/types'))) {
  console.error('dist/types is missing. Run bun run build first.')
  process.exit(1)
}
main()
