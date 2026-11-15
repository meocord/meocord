import fs from 'fs'
import { createRequire } from 'module'
import path from 'path'
import type * as TypeScript from 'typescript'
import { projectPaths } from '@src/util/tsconfig-paths.util.js'
import { cleanUpOnInterrupt, ESLintBudget, type LintProblem, lintFile } from '@src/util/generator-cli.util.js'

/** The compiler API, as the project's own `typescript` exports it from its main entry. */
type Ts = typeof TypeScript

/** The lists of `@MeoCord({ … })` a generated class must be in to take part. */
export type AppList = 'controllers' | 'observers'

/**
 * A generated class to list in `src/app.ts`: its name, the list, the specifier its import uses, and whether another
 * specifier names the class's own file, as a relative path does for one the alias names.
 */
export interface AppListing {
  className: string
  list: AppList
  specifier: string
  isClassFile?: (specifier: string) => boolean
}

/** What {@link listInAppSource} makes of a file: its new text, unchanged because the class is listed, or why it can't. */
export type AppEdit = { text: string } | { listed: true } | { problem: string }

/** The app file, relative to the project root. */
export const APP_FILE = path.join('src', 'app.ts')

/** The decorator whose options hold the lists. */
const APP_DECORATOR = 'MeoCord'

/** Text to insert at a position of the original file. */
interface Insertion {
  at: number
  text: string
}

/**
 * Adds a class to `src/app.ts`'s source: its import after the last import, and its entry in the `@MeoCord({ … })`
 * list, adding the list when the options have none. Text is inserted at node positions in the file's own style
 * (quotes, semicolons, line endings, the list's separator, indentation and trailing comma), so every other byte stays
 * as it is. A list that is not an array literal, or that holds a spread, is left alone, with the reason.
 */
export function listInAppSource(ts: Ts, source: string, listing: AppListing): AppEdit {
  const { className, list } = listing
  const file = ts.createSourceFile(APP_FILE, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const options = appOptionsOf(ts, file)
  if (!options) return { problem: `src/app.ts has no @${APP_DECORATOR}({ … }) with an object literal` }

  const property = options.properties.find(member => memberName(ts, member) === list)
  const array = property && ts.isPropertyAssignment(property) ? property.initializer : undefined
  if (property && (!array || !ts.isArrayLiteralExpression(array))) return { problem: `${list} is not a list written in place` }
  if (array && ts.isArrayLiteralExpression(array) && array.elements.some(ts.isSpreadElement)) {
    return { problem: `${list} holds a spread, whose list ${className} may belong in instead` }
  }
  // Appending the list could give the options a second one, under a key or a spread this can't read
  const unreadable = options.properties.some(member => memberName(ts, member) === undefined)
  if (!property && unreadable) return { problem: `@${APP_DECORATOR}'s options have a spread or a computed key that may already hold ${list}` }

  const binding = bindingOf(ts, file, listing)
  if (binding === 'other') return { problem: `src/app.ts already has a ${className} that is not the generated class` }
  const newline = source.includes('\r\n') ? '\r\n' : '\n'
  const listed = array && ts.isArrayLiteralExpression(array) && array.elements.some(element => ts.isIdentifier(element) && element.text === className)
  const imported = binding === 'imported'
  if (listed && imported) return { listed: true }

  const insertions: Insertion[] = []
  if (!imported) insertions.push(importInsertion(ts, file, source, listing, newline))
  if (!listed) {
    insertions.push(
      ...(array && ts.isArrayLiteralExpression(array)
        ? entryInsertions(ts, source, array, className, newline)
        : entryInsertions(ts, source, options, `${list}: [${className}]`, newline)),
    )
  }
  return { text: applyInsertions(source, insertions) }
}

/** The object literal of the first `@MeoCord({ … })` in the file. */
function appOptionsOf(ts: Ts, file: TypeScript.SourceFile): TypeScript.ObjectLiteralExpression | undefined {
  let found: TypeScript.ObjectLiteralExpression | undefined
  const visit = (node: TypeScript.Node): void => {
    if (found) return
    if (ts.isDecorator(node) && ts.isCallExpression(node.expression)) {
      const { expression: callee, arguments: args } = node.expression
      if (ts.isIdentifier(callee) && callee.text === APP_DECORATOR && args.length > 0 && ts.isObjectLiteralExpression(args[0])) {
        found = args[0]
        return
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return found
}

/** An object member's name as written, undefined for a spread or a key this can't read. */
function memberName(ts: Ts, member: TypeScript.ObjectLiteralElementLike): string | undefined {
  return ts.isSpreadAssignment(member) ? undefined : propertyName(ts, member.name)
}

/** A property's name as written: an identifier, a string, or a string in a computed key such as `['controllers']`. */
function propertyName(ts: Ts, name: TypeScript.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text
  if (ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression)) return name.expression.text
  return undefined
}

/**
 * What the class's name is bound to at the top of the file: nothing, the generated class through a value import of its
 * own export from its own file, or anything else, such as a type-only import, an import from another module, a
 * renamed or default import, or a declaration of the file's own.
 */
function bindingOf(ts: Ts, file: TypeScript.SourceFile, { className, specifier, isClassFile }: AppListing): 'none' | 'imported' | 'other' {
  const classFile = (candidate: string) => candidate === specifier || isClassFile?.(candidate) === true
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause
      if (!clause) continue
      if (clause.name?.text === className) return 'other'
      const bindings = clause.namedBindings
      if (bindings && ts.isNamespaceImport(bindings) && bindings.name.text === className) return 'other'
      const element = bindings && ts.isNamedImports(bindings) ? bindings.elements.find(each => each.name.text === className) : undefined
      if (!element) continue
      const ownExport = (element.propertyName?.text ?? className) === className
      const fromClassFile = ts.isStringLiteral(statement.moduleSpecifier) && classFile(statement.moduleSpecifier.text)
      return !clause.isTypeOnly && !element.isTypeOnly && ownExport && fromClassFile ? 'imported' : 'other'
    }
    if (declaredNames(ts, statement).includes(className)) return 'other'
  }
  return 'none'
}

/** The names a top-level statement other than an import declares. */
function declaredNames(ts: Ts, statement: TypeScript.Statement): string[] {
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.flatMap(declaration => (ts.isIdentifier(declaration.name) ? [declaration.name.text] : []))
  }
  if (
    ts.isClassDeclaration(statement) ||
    ts.isFunctionDeclaration(statement) ||
    ts.isEnumDeclaration(statement) ||
    ts.isImportEqualsDeclaration(statement) ||
    ts.isModuleDeclaration(statement)
  ) {
    return statement.name && ts.isIdentifier(statement.name) ? [statement.name.text] : []
  }
  return []
}

/** The import of the class, after the last import in the file's quotes and semicolons, else at the top. */
function importInsertion(ts: Ts, file: TypeScript.SourceFile, source: string, { className, specifier }: AppListing, newline: string): Insertion {
  const imports = file.statements.filter(ts.isImportDeclaration)
  const last = imports.at(-1)
  const quote = last ? source.charAt(last.moduleSpecifier.getStart(file)) : "'"
  const semicolon = last && source.charAt(last.end - 1) === ';' ? ';' : ''
  const statement = `import { ${className} } from ${quote}${specifier}${quote}${semicolon}`
  if (!last) return { at: 0, text: `${statement}${newline}` }
  // After a comment on the last import's line, which stays with that import
  return { at: lineEndAfter(ts, source, last.end), text: `${newline}${statement}` }
}

/**
 * The end of the comma that is the first token after `position`, found with the scanner, so a comma inside a comment
 * is never taken for it. Called only where the syntax tree says the comma is there.
 */
function commaEndAfter(ts: Ts, source: string, position: number): number {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, source)
  scanner.setText(source, position)
  if (scanner.scan() !== ts.SyntaxKind.CommaToken) throw new Error(`No comma follows position ${position} of src/app.ts`)
  return scanner.getTextPos()
}

/** The end of the comments that follow `position` on its line, or `position` when none do. */
function lineEndAfter(ts: Ts, source: string, position: number): number {
  return ts.getTrailingCommentRanges(source, position)?.at(-1)?.end ?? position
}

/** A line's indentation: the spaces and tabs it starts with. */
function indentOf(source: string, position: number): string {
  const lineStart = source.lastIndexOf('\n', position - 1) + 1
  return /^[ \t]*/.exec(source.slice(lineStart))![0]
}

/**
 * Inserts `entry` as the last element of an array literal or the last property of an object literal, copying its
 * neighbours: one per line at the last one's indentation, or on one line with their separator, keeping a trailing
 * comma and any comment after the last one where they are.
 */
function entryInsertions(
  ts: Ts,
  source: string,
  node: TypeScript.ArrayLiteralExpression | TypeScript.ObjectLiteralExpression,
  entry: string,
  newline: string,
): Insertion[] {
  const items: readonly TypeScript.Node[] = ts.isArrayLiteralExpression(node) ? node.elements : node.properties
  const open = node.getStart() + 1
  const close = node.end - 1
  const last = items.at(-1)
  if (!last) {
    const inside = source.slice(open, close)
    if (!inside.includes('\n')) {
      // An empty literal on one line: inside its brackets, as a list of one written in place
      const padding = ts.isObjectLiteralExpression(node) ? ' ' : ''
      return [{ at: open, text: `${padding}${entry}${padding}` }]
    }
    // An empty literal over lines, such as one holding only a comment: on a line of its own after what it holds, at
    // that content's indentation, else one step in from the closing bracket's
    const content = inside.trimEnd()
    const closeIndent = indentOf(source, close)
    const indent = content.trim() ? indentOf(source, open + content.length) : `${closeIndent}  `
    return [{ at: open + content.length, text: `${newline}${indent}${entry},` }]
  }
  const trailingComma = ts.isArrayLiteralExpression(node) ? node.elements.hasTrailingComma : node.properties.hasTrailingComma
  // The comma is the next token after the last one, past any comment that holds a comma of its own
  const commaEnd = trailingComma ? commaEndAfter(ts, source, last.end) : last.end
  const lastStart = last.getStart()
  const multiline = source.slice(open, lastStart).includes('\n')
  if (!multiline) {
    // The spacing after the comma between the last two, else one space
    const between = items.length > 1 ? source.slice(commaEndAfter(ts, source, items.at(-2)!.end), lastStart) : ' '
    const separator = `,${/^[ \t]*$/.test(between) ? between : ' '}`
    return [{ at: commaEnd, text: trailingComma ? ` ${entry},` : `${separator}${entry}` }]
  }
  // One per line at the last one's line's indentation, after any comment on that line, which stays with it
  const line = `${newline}${indentOf(source, lastStart)}${entry}${trailingComma ? ',' : ''}`
  const lineEnd = lineEndAfter(ts, source, commaEnd)
  if (trailingComma || lineEnd === last.end) return [{ at: lineEnd, text: trailingComma ? line : `,${line}` }]
  return [
    { at: last.end, text: ',' },
    { at: lineEnd, text: line },
  ]
}

/** The source with each insertion made, at positions of the original. */
function applyInsertions(source: string, insertions: readonly Insertion[]): string {
  let text = source
  for (const { at, text: inserted } of [...insertions].sort((a, b) => b.at - a.at)) text = text.slice(0, at) + inserted + text.slice(at)
  return text
}

/**
 * The project's own TypeScript compiler API, resolved from its root, or why it can't be used. TypeScript 7 exports
 * only its version from its main entry, with its API elsewhere.
 */
export function projectTypeScript(root: string): Ts | { problem: string } {
  let ts: Partial<Ts>
  try {
    ts = createRequire(path.join(root, 'package.json'))('typescript') as Partial<Ts>
  } catch {
    return { problem: "this project's typescript could not be loaded" }
  }
  if (typeof ts.createSourceFile !== 'function') {
    return { problem: `this project's typescript (${ts.version ?? 'an unknown version'}) has no compiler API on its main entry` }
  }
  return ts as Ts
}

/** The file a specifier in `src/app.ts` names, without its extension: relative to `src`, or through a tsconfig alias. */
function specifierFile(root: string, specifier: string): string | undefined {
  const bare = specifier.replace(/\.[cm]?[jt]sx?$/, '')
  if (bare.startsWith('.')) return path.resolve(root, 'src', bare)
  for (const [alias, targets] of Object.entries(projectPaths(root) ?? {})) {
    if (!alias.endsWith('/*') || !bare.startsWith(alias.slice(0, -1))) continue
    const target = targets.find(each => each.endsWith('*'))
    if (target) return path.join(target.slice(0, -1), bare.slice(alias.length - 1))
  }
  return undefined
}

/**
 * The specifier `src/app.ts` imports a file with: through the tsconfig alias whose target holds it, as the template's
 * `@src/*`, else relative; either way without its extension.
 */
export function importSpecifier(root: string, file: string): string {
  const withoutExtension = file.replace(/\.[cm]?tsx?$/, '')
  for (const [alias, targets] of Object.entries(projectPaths(root) ?? {})) {
    if (!alias.endsWith('/*')) continue
    for (const target of targets) {
      if (!target.endsWith('*')) continue
      const base = target.slice(0, -1)
      if (withoutExtension.startsWith(base)) return alias.slice(0, -1) + withoutExtension.slice(base.length).split(path.sep).join('/')
    }
  }
  const relative = path.relative(path.join(root, 'src'), withoutExtension).split(path.sep).join('/')
  return relative.startsWith('.') ? relative : `./${relative}`
}

/**
 * What {@link listInApp} did: listed the class, with why ESLint could not check the edit when it couldn't; found it
 * listed; or why it changed nothing.
 */
export type AppListingResult = { added: true; unchecked?: string } | { listed: true } | { problem: string }

/**
 * Lists a generated class in the project's `src/app.ts`, editing it in place with the project's own TypeScript, and
 * keeps the edit only if the project's ESLint, run with no fixing on the file as written, finds no error the file did
 * not have. A typed config lints the file on disk, so the edit is written, linted, and on any error the original is put
 * back and linted to tell the edit's errors from the file's own; one that brings an error is undone, with the file's
 * modification time put back too, to within a microsecond. Each text is written into the file itself, which keeps its
 * mode, owner and links, and every text written parses. On SIGINT or SIGTERM before the edit is known good, the
 * original is put back first; SIGKILL in that window leaves the edit. The ESLint runs share `budget` with the
 * formatting before them. When ESLint can't run, the edit stays and the result says why it went unchecked. Changes
 * nothing, and says why, when the file is missing or can't be read or written, the TypeScript can't be used, or the
 * list isn't one it can safely add to.
 */
export async function listInApp(
  root: string,
  file: string,
  className: string,
  list: AppList,
  budget = new ESLintBudget(),
): Promise<AppListingResult> {
  const appFile = path.join(root, APP_FILE)
  if (!fs.existsSync(appFile)) return { problem: 'src/app.ts is missing' }
  const ts = projectTypeScript(root)
  if ('problem' in ts) return ts
  let source: string
  let stat: fs.BigIntStats
  try {
    source = fs.readFileSync(appFile, 'utf8')
    stat = fs.statSync(appFile, { bigint: true })
  } catch (error) {
    return { problem: `src/app.ts could not be read (${messageOf(error)})` }
  }
  const classFile = file.replace(/\.[cm]?tsx?$/, '')
  const isClassFile = (specifier: string) => specifierFile(root, specifier) === classFile
  const edit = listInAppSource(ts, source, { className, list, specifier: importSpecifier(root, file), isClassFile })
  if (!('text' in edit)) return edit
  // What is written is always valid code, so a process killed before the lint below finishes leaves a file that parses
  if (syntaxErrors(ts, edit.text) > 0) return { problem: 'the edit would not parse, so it was not made' }

  // The file as it was, put back on a refusal or on SIGINT or SIGTERM while it holds an edit not yet checked
  const restore = () => {
    writeInPlace(appFile, source)
    fs.utimesSync(appFile, seconds(stat.atimeNs), seconds(stat.mtimeNs))
  }
  try {
    writeInPlace(appFile, edit.text)
  } catch (error) {
    return { problem: `src/app.ts could not be written (${messageOf(error)})` }
  }
  const release = cleanUpOnInterrupt(restore)
  try {
    const edited = await lintFile(appFile, root, budget)
    if ('unchecked' in edited) return { added: true, unchecked: edited.unchecked }
    if (edited.errors.length === 0) return { added: true }

    // Errors after the edit: the file as it was decides which are the edit's
    try {
      restore()
    } catch (error) {
      return { problem: `src/app.ts holds the edit, which ESLint reports errors in, and could not be put back (${messageOf(error)})` }
    }
    const original = await lintFile(appFile, root, budget)
    if ('unchecked' in original) return { problem: `ESLint could not lint src/app.ts as it was, to compare (${original.unchecked})` }
    const brought = addedProblems(original.errors, edited.errors)
    if (brought.length > 0) return { problem: `the edit would fail your project's ESLint (${brought[0].rule}: ${brought[0].message})` }
    try {
      writeInPlace(appFile, edit.text)
    } catch (error) {
      return { problem: `src/app.ts could not be written (${messageOf(error)})` }
    }
    return { added: true }
  } finally {
    release()
  }
}

/**
 * A file time in seconds, as `utimes` takes it: the nearest a double holds, within a quarter of a microsecond at
 * today's times, where a `Date` would drop all but the milliseconds. Nothing in Node sets nanoseconds.
 */
const seconds = (ns: bigint) => Number(ns) / 1e9

/** An error's message, for a problem line. */
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** The syntax errors TypeScript finds in a text. */
function syntaxErrors(ts: Ts, text: string): number {
  const { diagnostics = [] } = ts.transpileModule(text, { reportDiagnostics: true, fileName: APP_FILE })
  return diagnostics.filter(each => each.category === ts.DiagnosticCategory.Error).length
}

/**
 * Writes a file's new text into the file itself, as an editor saves it: through a symlink to its target, keeping its
 * inode, mode, owner and other hard links, and refused where the file can't be written. The text goes in one write
 * before the length is set, so only a kill between those two calls leaves a longer old text's tail.
 */
function writeInPlace(file: string, text: string): void {
  const bytes = Buffer.from(text)
  const fd = fs.openSync(file, 'r+')
  try {
    for (let written = 0; written < bytes.length; ) written += fs.writeSync(fd, bytes, written, bytes.length - written, written)
    fs.ftruncateSync(fd, bytes.length)
  } finally {
    fs.closeSync(fd)
  }
}

/** The errors in `after` beyond those in `before`, counting each rule and message as often as it appears. */
export function addedProblems(before: readonly LintProblem[], after: readonly LintProblem[]): LintProblem[] {
  const key = (problem: LintProblem) => `${problem.rule}\0${problem.message}`
  const remaining = new Map<string, number>()
  for (const problem of before) remaining.set(key(problem), (remaining.get(key(problem)) ?? 0) + 1)
  return after.filter(problem => {
    const left = remaining.get(key(problem)) ?? 0
    if (left > 0) remaining.set(key(problem), left - 1)
    return left === 0
  })
}

/** The warning for a class that could not be listed: why, and the two lines to add by hand. */
export function listingProblemMessage(root: string, file: string, className: string, list: AppList, problem: string): string {
  return (
    `Could not add ${className} to src/app.ts: ${problem}. Add:\n` +
    `  import { ${className} } from '${importSpecifier(root, file)}'\n` +
    `  ${className}, in @${APP_DECORATOR}({ ${list} })`
  )
}
