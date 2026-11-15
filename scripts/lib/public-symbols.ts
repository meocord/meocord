/**
 * The package's public symbols as `check:jsdoc-examples` reads them from the built declarations, what their JSDoc
 * lacks, and where an example's names are imported from.
 */

import path from 'path'
import ts from 'typescript'

/** The groups the docs site files symbols under; see CONTRIBUTING.md. */
export const GROUPS = ['Controllers', 'Decorators', 'Responses', 'Utilities', 'Testing', 'Configuration', 'CLI', 'Types']
/**
 * The pipeline stages `@pipeline` names, in the order a call runs: the stages of the docs' pipeline figure, whose sync
 * refuses a tag naming any other. No symbol is the fallback, so none names it.
 */
export const STAGES = [
  'observers-start',
  'filters',
  'defer',
  'parse',
  'guards',
  'cooldown-check',
  'fetch',
  'interceptors',
  'validation',
  'pipes',
  'cooldowns',
  'defer-lock',
  'handler',
  'fallback',
  'observers-settled',
]

/** Where a member's example sits, which decides how it compiles. */
export interface MemberSite {
  /** The member's own name */
  name: string
  kind: 'property' | 'method' | 'other'
  /**
   * The type of an object holding the member, as an example file names it, such as `NonNullable<Settings>["limits"]`;
   * none where no chain of names reaches it, as for a parameter of an overloaded method
   */
  holder?: string
  /** The member's key as a type, such as `"level"` or `0`; none for an index signature, which has no one key */
  key?: string
}

/** A JSDoc `@example` to compile, under the label a problem in it is reported with. */
export interface Example {
  /** What it documents, such as `TestingModule.dispatch (signature 1)` */
  owner: string
  label: string
  code: string
  /** For a member's example, where the member sits */
  member?: MemberSite
}

export interface PublicSymbol {
  name: string
  entries: string[]
  symbol: ts.Symbol
  isType: boolean
  /**
   * Declared outside the package, as a discord.js formatter the package re-exports is: its documentation is its own
   * package's, so the standard below doesn't apply to it.
   */
  external: boolean
  summary: string
  group?: string
  category?: string
  stages: string[]
  examples: Example[]
}

interface ParsedDoc {
  summary: string
  tags: { name: string; text: string }[]
}

/**
 * A declaration's JSDoc, read from its comment as TypeDoc reads it: a line starting with `@` inside a code fence is
 * code, where TypeScript's own parser takes an example's decorators for tags.
 */
export function docOf(declaration: ts.Node): ParsedDoc | undefined {
  const comment = ts.getJSDocCommentsAndTags(declaration).find(ts.isJSDoc)
  if (!comment) return undefined
  const lines = comment
    .getSourceFile()
    .text.slice(comment.pos, comment.end)
    // A one-line comment, `/** @internal */`, has its text beside the delimiters
    .replace(/^\/\*\*\s*|\s*\*\/$/g, '')
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

/** A symbol's JSDoc, from the first of its declarations that has a comment. */
function parsedDoc(symbol: ts.Symbol): ParsedDoc {
  for (const declaration of symbol.declarations ?? []) {
    const doc = docOf(declaration)
    if (doc) return doc
  }
  return { summary: '', tags: [] }
}

/** Whether a declaration is one signature of a function or a method, which overloads declare several of. */
export const isSignature = (declaration: ts.Node): boolean =>
  ts.isFunctionDeclaration(declaration) || ts.isMethodSignature(declaration) || ts.isMethodDeclaration(declaration)

/** How a problem names one signature of an overloaded function or method, such as ` (signature 2)`; empty for one. */
export function signatureName(declaration: ts.Node, declarations: readonly ts.Declaration[] | undefined): string {
  const signatures = (declarations ?? []).filter(isSignature)
  const index = signatures.indexOf(declaration as ts.Declaration)
  return signatures.length > 1 && index >= 0 ? ` (signature ${index + 1})` : ''
}

/** The `@example`s of one comment, numbered when it has more than one. */
export function examplesIn(doc: ParsedDoc | undefined, owner: string, member?: MemberSite): Example[] {
  const codes = (doc?.tags ?? []).filter(tag => tag.name === 'example').map(tag => fencedCode(tag.text))
  return codes.map((code, index) => ({ owner, label: `${owner}: its example${codes.length > 1 ? ` ${index + 1}` : ''}`, code, member }))
}

/** An example's code, without its fence. */
function fencedCode(text: string): string {
  const match = /```[a-z]*\n([\s\S]*?)\n?```/.exec(text)
  return (match ? match[1] : text).trimEnd()
}

/** Whether `file` lies inside `dir`. */
const isWithin = (dir: string, file: string) => {
  const relative = path.relative(dir, file)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

/**
 * Every public symbol, once however many entry points export it, with the parts of its JSDoc the standard asks for.
 * `ownDir` holds the package's own declarations: a symbol declared only outside it is external.
 */
export function publicSymbols(program: ts.Program, entries: Map<string, string>, ownDir: string): Map<ts.Symbol, PublicSymbol> {
  const checker = program.getTypeChecker()
  const symbols = new Map<ts.Symbol, PublicSymbol>()
  for (const [entry, file] of entries) {
    const source = program.getSourceFile(file)
    const moduleSymbol = source && checker.getSymbolAtLocation(source)
    if (!moduleSymbol) throw new Error(`${entry}: ${path.relative(process.cwd(), file)} was not built. Run bun run build first.`)
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
        external: !(symbol.declarations ?? []).some(declaration => isWithin(ownDir, declaration.getSourceFile().fileName)),
        summary,
        group: tags.find(tag => tag.name === 'group')?.text,
        category: tags.find(tag => tag.name === 'category')?.text,
        stages: tags.filter(tag => tag.name === 'pipeline').map(tag => tag.text.split(/\s/)[0]),
        // Each overload signature's comment is its own, and the reference shows its examples with it
        examples: (symbol.declarations ?? []).flatMap(declaration =>
          examplesIn(docOf(declaration), `${exported.name}${signatureName(declaration, symbol.declarations)}`),
        ),
      })
    }
  }
  return symbols
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
  const signatures = (declarations ?? []).filter(isSignature)
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

/** What a public symbol's JSDoc lacks against the standard; nothing for an external one, whose documentation it isn't. */
export function documentationProblems(checker: ts.TypeChecker, item: PublicSymbol): string[] {
  if (item.external) return []
  // The API reference files every public symbol under its @group, from the JSDoc of its own declaration; a re-export
  // has its target's
  if (!item.group) return [`${item.entries.join(', ')}'s ${item.name} has no @group tag; give its declaration a JSDoc comment of its own with one.`]
  const problems: string[] = []
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
  // The reference says where each stage runs, from these tags
  if (item.category === 'Pipeline stages' && item.stages.length === 0) {
    problems.push(`${item.name}: it is a pipeline stage with no @pipeline; say where it runs.`)
  }
  return problems
}

/** The symbols a module in the program exports, each followed to what it names. */
export function exportedSymbols(program: ts.Program, file: string): Map<string, ts.Symbol> {
  const checker = program.getTypeChecker()
  const source = program.getSourceFile(file)
  const moduleSymbol = source && checker.getSymbolAtLocation(source)
  return new Map(
    (moduleSymbol ? checker.getExportsOfModule(moduleSymbol) : []).map(exported => [
      exported.name,
      exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported,
    ]),
  )
}

/**
 * Where each name an example may use without importing it comes from: the package's entry that exports it, or a module
 * such as discord.js. A module's export that is the very symbol a public export of the same name is has that entry as
 * its one source, so an example that uses it imports it as the docs teach. A name with two sources is refused.
 */
export function importSources(symbols: Map<ts.Symbol, PublicSymbol>, modules: Record<string, Map<string, ts.Symbol>>): Map<string, Set<string>> {
  const sources = new Map<string, Set<string>>()
  const add = (name: string, from: string) => sources.set(name, (sources.get(name) ?? new Set()).add(from))
  for (const { name, entries: from } of symbols.values()) add(name, from[0])
  for (const [module, exported] of Object.entries(modules)) {
    for (const [name, symbol] of exported) {
      if (symbols.get(symbol)?.name === name) continue
      add(name, module)
    }
  }
  return sources
}
