/**
 * Checks the shipped declarations as a consumer's compiler reads them, after `bun run build`: each `meocord/<entry>`
 * resolves through `exports` to its `.d.ts` (import) and `.d.cts` (require), they and their chunks compile with no
 * error, and they export exactly the names, values and types the source entry declares.
 */
import { existsSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import ts from 'typescript'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ENTRIES = ['core', 'decorator', 'common', 'interface', 'enum', 'testing']
const CONDITIONS = [
  { name: 'import', from: '__consumer__.mts', mode: ts.ModuleKind.ESNext, built: (entry: string) => `dist/types/${entry}/index.d.ts` },
  { name: 'require', from: '__consumer__.cts', mode: ts.ModuleKind.CommonJS, built: (entry: string) => `dist/types/${entry}/index.d.cts` },
] as const
const ESLINT = { import: 'meocord.eslint.d.ts', require: 'meocord.eslint.d.cts' }

// As a consumer compiles against the package: NodeNext, its own libraries type-checked too
const consumerOptions: ts.CompilerOptions = {
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  target: ts.ScriptTarget.ESNext,
  strict: true,
  noEmit: true,
  skipLibCheck: false,
  types: ['node'],
}

type Kind = 'value' | 'type'

// Where the bundle is known to ship a name differently from its source, and why. Each entry is a defect to fix,
// not a rule: the check fails if the difference changes or goes away, so the entry is removed with the fix.
const KNOWN_DIFFERENCES: Record<string, Record<string, Kind>> = {
  // Re-exported type-only, but rollup-plugin-dts drops the `type`: the declarations offer a value the runtime lacks.
  // Internal, and un-exported in 5.0 once no decorator signature names it.
  interface: { PIPED_BRAND: 'value' },
}

/** Whether an import or export along an alias chain is written type-only, so only the type gets through. */
function typeOnlyAlias(checker: ts.TypeChecker, symbol: ts.Symbol): boolean {
  for (let at: ts.Symbol | undefined = symbol; at && at.flags & ts.SymbolFlags.Alias; at = checker.getImmediateAliasedSymbol(at)) {
    for (const declaration of at.declarations ?? []) {
      if (ts.isTypeOnlyImportOrExportDeclaration(declaration)) return true
    }
  }
  return false
}

/** Each name a module exports, as a value or a type only. */
function exportsOf(checker: ts.TypeChecker, file: ts.SourceFile): Map<string, Kind> {
  const module = checker.getSymbolAtLocation(file)
  if (!module) throw new Error(`${path.relative(repoRoot, file.fileName)} is not a module the compiler can read`)
  return new Map(
    checker.getExportsOfModule(module).map(symbol => {
      const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
      return [symbol.name, target.flags & ts.SymbolFlags.Value && !typeOnlyAlias(checker, symbol) ? 'value' : 'type']
    }),
  )
}

const problems: string[] = []
const relative = (file: string) => path.relative(repoRoot, file)

// Resolved by the package's own name, as an app importing or requiring it does: only the exports map decides it
const host = ts.createCompilerHost(consumerOptions)
const resolve = (specifier: string, from: string, mode: ts.ResolutionMode) =>
  ts.resolveModuleName(specifier, path.join(repoRoot, from), consumerOptions, host, undefined, undefined, mode).resolvedModule?.resolvedFileName
const shipped: { entry: string; condition: string; file: string }[] = []
for (const { name, from, mode, built } of CONDITIONS) {
  for (const entry of [...ENTRIES, 'eslint']) {
    const expected = path.join(repoRoot, entry === 'eslint' ? ESLINT[name] : built(entry))
    const resolved = resolve(`meocord/${entry}`, from, mode)
    if (!existsSync(expected)) problems.push(`${relative(expected)} does not exist: run bun run build first`)
    else if (!resolved) problems.push(`meocord/${entry} does not resolve for ${name}`)
    else if (path.resolve(resolved) !== expected) problems.push(`meocord/${entry} resolves for ${name} to ${relative(resolved)}, not ${relative(expected)}`)
    else shipped.push({ entry, condition: name, file: expected })
  }
}

const program = ts.createProgram(
  shipped.map(({ file }) => file),
  consumerOptions,
  host,
)
// The package's own files: the entries, the chunks they import and the eslint declarations
const own = program.getSourceFiles().filter(file => !relative(file.fileName).split(path.sep).includes('node_modules') && !program.isSourceFileDefaultLibrary(file))
for (const file of own) {
  for (const diagnostic of [...program.getSyntacticDiagnostics(file), ...program.getSemanticDiagnostics(file)]) {
    const { line } = diagnostic.start === undefined ? { line: 0 } : file.getLineAndCharacterOfPosition(diagnostic.start)
    problems.push(`${relative(file.fileName)}:${line + 1}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`)
  }
}

// What each source entry declares, read with the repository's own options
const { config } = ts.readConfigFile(path.join(repoRoot, 'tsconfig.json'), ts.sys.readFile)
const { options } = ts.parseJsonConfigFileContent(config, ts.sys, repoRoot)
const sources = ENTRIES.map(entry => path.join(repoRoot, 'src', entry, 'index.ts'))
const sourceProgram = ts.createProgram(sources, { ...options, noEmit: true })
const sourceChecker = sourceProgram.getTypeChecker()
const checker = program.getTypeChecker()
let names = 0
for (const [index, entry] of ENTRIES.entries()) {
  const declared = exportsOf(sourceChecker, sourceProgram.getSourceFile(sources[index])!)
  names += declared.size
  for (const { condition, file } of shipped.filter(item => item.entry === entry)) {
    const built = exportsOf(checker, program.getSourceFile(file)!)
    const where = `meocord/${entry} (${condition}, ${relative(file)})`
    for (const [name, kind] of declared) {
      const shippedKind = built.get(name)
      const known = KNOWN_DIFFERENCES[entry]?.[name]
      if (!shippedKind) problems.push(`${where} does not export ${name}, which src/${entry}/index.ts declares`)
      else if (known !== undefined) {
        if (shippedKind !== known || kind === known) problems.push(`${where} no longer ships ${name} as KNOWN_DIFFERENCES records: update the entry`)
      } else if (shippedKind !== kind) problems.push(`${where} exports ${name} as a ${shippedKind}, which src/${entry}/index.ts declares as a ${kind}`)
    }
    for (const name of built.keys()) {
      if (!declared.has(name)) problems.push(`${where} exports ${name}, which src/${entry}/index.ts does not declare`)
    }
  }
}

if (problems.length > 0) {
  console.error(`The built declarations differ from what the package declares:\n${problems.map(problem => `  - ${problem}`).join('\n')}`)
  process.exit(1)
}
console.log(
  `Each entry resolves for import and require to its own declarations, which compile and export the ${names} names ` +
    'the source entry points declare, values as values and types as types.',
)
