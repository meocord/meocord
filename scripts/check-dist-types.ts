/**
 * Checks the shipped declarations as a consumer's compiler reads them, after `bun run build`: each `meocord/<entry>`
 * resolves through `exports` to its `.d.ts` (import) and `.d.cts` (require), they and their chunks compile with no
 * error, and they export exactly the names, values and types the source entry declares. The opted-in typed mock values
 * fixture compiles against them too, as ESM and as CommonJS.
 */
import { existsSync, readFileSync } from 'fs'
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
// A project with typed mock values, written against src; a consumer names the module `meocord/testing`
const TYPED_VALUES = { fixture: 'src/testing/typed-values/typed-values.augmented.ts', source: "'@src/testing/index.js'", consumer: "'meocord/testing'" }

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

// Classes only MeoCord makes, which a test gets from `compile()`, `create()` or `fromApp()`: their public constructors
// take only `unknown`, so the declarations show none of what they are made from
const UNKNOWN_CONSTRUCTORS: Record<string, readonly string[]> = { testing: ['TestingModule', 'TestingModuleBuilder'] }

// Public constructors known to name a type no entry exports, and why. Each is a defect to fix, not a rule: the check
// fails once the constructor names none, so the entry is removed with the fix
const KNOWN_CONSTRUCTOR_LEAKS: Record<string, Record<string, string>> = {
  // Not given the `unknown` form: ShardContext's constructor is documented and would lose its argument checks, so both
  // get a typed form of their own in 5.0 (#1072)
  core: {
    HandlerRegistry: 'names HandlerClass',
    ShardContext: 'names ShardCallHandler',
  },
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
const isOwn = (program: ts.Program, file: ts.SourceFile) =>
  !relative(file.fileName).split(path.sep).includes('node_modules') && !program.isSourceFileDefaultLibrary(file)
const report = (program: ts.Program, file: ts.SourceFile) => {
  for (const diagnostic of [...program.getSyntacticDiagnostics(file), ...program.getSemanticDiagnostics(file)]) {
    const { line } = diagnostic.start === undefined ? { line: 0 } : file.getLineAndCharacterOfPosition(diagnostic.start)
    problems.push(`${relative(file.fileName)}:${line + 1}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`)
  }
}

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
for (const file of program.getSourceFiles().filter(file => isOwn(program, file))) report(program, file)

// The fixture in each module format, as a file beside the consumer: its augmentation reaches the declarations that
// format resolves to, and its `@ts-expect-error` lines fail if it doesn't
const typedValues = readFileSync(path.join(repoRoot, TYPED_VALUES.fixture), 'utf8').replaceAll(TYPED_VALUES.source, TYPED_VALUES.consumer)
for (const { from } of CONDITIONS) {
  const fixture = path.join(repoRoot, from.replace('__consumer__', '__typed_values__'))
  const fixtureHost: ts.CompilerHost = {
    ...host,
    fileExists: file => file === fixture || host.fileExists(file),
    readFile: file => (file === fixture ? typedValues : host.readFile(file)),
    getSourceFile: (file, version, ...rest) =>
      file === fixture ? ts.createSourceFile(file, typedValues, version) : host.getSourceFile(file, version, ...rest),
  }
  const fixtureProgram = ts.createProgram([fixture], consumerOptions, fixtureHost)
  for (const file of fixtureProgram.getSourceFiles().filter(file => isOwn(fixtureProgram, file))) report(fixtureProgram, file)
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

// Every exported class's public constructor names only types some entry exports
const resolveAlias = (symbol: ts.Symbol) => (symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol)
const exported = new Set(shipped.flatMap(({ file }) => checker.getExportsOfModule(checker.getSymbolAtLocation(program.getSourceFile(file)!)!).map(resolveAlias)))
const isPrivate = (node: ts.Node) => ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Private
for (const { entry, condition, file } of shipped.filter(item => item.entry !== 'eslint')) {
  const where = `meocord/${entry} (${condition}, ${relative(file)})`
  for (const symbol of checker.getExportsOfModule(checker.getSymbolAtLocation(program.getSourceFile(file)!)!)) {
    const declaration = resolveAlias(symbol).declarations?.find(ts.isClassDeclaration)
    if (!declaration) continue
    const named = new Set<string>()
    const visit = (node: ts.Node): void => {
      const name = ts.isTypeReferenceNode(node) ? node.typeName : ts.isTypeQueryNode(node) ? node.exprName : undefined
      if (name) {
        const target = checker.getSymbolAtLocation(ts.isQualifiedName(name) ? name.left : name)
        const resolved = target && resolveAlias(target)
        const at = resolved?.declarations?.[0]?.getSourceFile()
        if (resolved && at && isOwn(program, at) && !exported.has(resolved) && !(resolved.flags & ts.SymbolFlags.TypeParameter)) named.add(resolved.name)
      }
      ts.forEachChild(node, visit)
    }
    // The class's construct signatures, so a constructor it inherits from a base no entry exports counts too
    const signatures = checker.getSignaturesOfType(checker.getTypeOfSymbol(resolveAlias(symbol)), ts.SignatureKind.Construct)
    const publicSignatures = signatures.flatMap(({ declaration }) =>
      declaration && !ts.isJSDocSignature(declaration) && !isPrivate(declaration) ? [declaration] : [],
    )
    for (const signature of publicSignatures) signature.parameters.forEach(visit)
    if (UNKNOWN_CONSTRUCTORS[entry]?.includes(symbol.name)) {
      const typed = publicSignatures.flatMap(signature => signature.parameters).filter(parameter => parameter.type?.kind !== ts.SyntaxKind.UnknownKeyword)
      if (publicSignatures.length === 0 || typed.length > 0) {
        problems.push(`${where}: ${symbol.name} is made only by MeoCord, so its public constructor takes only \`unknown\`${typed.length > 0 ? `, not ${typed.map(parameter => parameter.getText()).join(', ')}` : ''}`)
      }
    }
    const known = KNOWN_CONSTRUCTOR_LEAKS[entry]?.[symbol.name]
    const found = [...named].sort().join(', ')
    if (known !== undefined) {
      if (`names ${found}` !== known) problems.push(`${where}: ${symbol.name}'s constructor ${found ? `names ${found}` : 'names no internal type'}, not what KNOWN_CONSTRUCTOR_LEAKS records: update the entry`)
    } else if (found) {
      problems.push(`${where}: ${symbol.name}'s public constructor names ${found}, which no entry exports`)
    }
  }
}

if (problems.length > 0) {
  console.error(`The built declarations differ from what the package declares:\n${problems.map(problem => `  - ${problem}`).join('\n')}`)
  process.exit(1)
}
console.log(
  `Each entry resolves for import and require to its own declarations, which compile and export the ${names} names ` +
    'the source entry points declare, values as values and types as types. Typed mock values hold for import and require.',
)
