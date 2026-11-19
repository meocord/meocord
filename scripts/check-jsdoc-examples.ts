/**
 * Checks that every public symbol has a `@group`, checks its JSDoc and compiles its `@example`s, those of its overload
 * signatures and members at any depth, and the README's blocks, against the built package, after `bun run build`. An
 * example a public symbol's declarations hold that the check does not reach is reported, never skipped. A member's
 * example may be module code, or the member as in an object (`level: 'quiet',`, `level: 'quiet';`), a class property
 * set with `=`, or a method implemented, each checked against the type holding the member; see {@link wrapping}.
 * `--coverage` lists the symbols still missing parts; `--fix` only moves every documentation link, in the JSDoc and the
 * app templates, onto the package's own line, with no build: `release:version` runs it after setting the version, so a
 * new minor's release and the apps it creates carry its links.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import ts from 'typescript'
import {
  docOf,
  documentationProblems,
  type Example,
  examplesIn,
  exportedSymbols,
  importSources,
  isSignature,
  type MemberSite,
  type PublicSymbol,
  publicSymbols,
  signatureName,
} from './lib/public-symbols.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const compilerOptions: ts.CompilerOptions = {
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  target: ts.ScriptTarget.ES2022,
  strict: true,
  experimentalDecorators: true,
  emitDecoratorMetadata: true,
  skipLibCheck: true,
  noEmit: true,
  // As an app has them: Node's globals, such as `console` and `performance`, from the repository's own install
  types: ['node'],
  typeRoots: [path.join(repoRoot, 'node_modules/@types')],
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

/** A member's name as a problem names it: `constructor` and `new` for those, none for a call or index signature. */
function memberName(member: ts.Node): string | undefined {
  if (ts.isConstructorDeclaration(member)) return 'constructor'
  if (ts.isConstructSignatureDeclaration(member)) return 'new'
  const name = (member as { name?: ts.Node }).name
  if (!name) return undefined
  return ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) ? name.text : name.getText()
}

/** Whether a node is a member of a class, an interface, an object type or an enum, which has a comment of its own. */
const isMember = (node: ts.Node): node is ts.ClassElement | ts.TypeElement | ts.EnumMember =>
  ts.isClassElement(node) || ts.isTypeElement(node) || ts.isEnumMember(node)

/** The type a type expression names, with `null` and `undefined` taken out, as an object holding members is. */
const objectOf = (type: string) => `NonNullable<${type}>`

/** The type of the member `name` of the objects `holder` names. */
const memberOf = (holder: string, name: string) => `${objectOf(holder)}[${JSON.stringify(name)}]`

/** Whether a type is `Array<T>` or `ReadonlyArray<T>`, whose elements `[number]` reaches as a `T[]`'s. */
const isArrayReference = (node: ts.Node): node is ts.TypeReferenceNode & { typeArguments: ts.NodeArray<ts.TypeNode> } =>
  ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName) && ['Array', 'ReadonlyArray'].includes(node.typeName.text) && node.typeArguments?.length === 1

/** How an example file names a declaration's type: by its name, with `any` for each type parameter. */
function typeName(name: string, declaration: ts.Node): string {
  const count = (declaration as { typeParameters?: ts.NodeArray<ts.TypeParameterDeclaration> }).typeParameters?.length ?? 0
  return count === 0 ? name : `${name}<${Array.from({ length: count }, () => 'any').join(', ')}>`
}

/**
 * Walks what public symbols declare for the `@example`s of their members, at any depth: a class's or an interface's
 * properties and methods, static ones included; the fields of an object type a property, a parameter, a type alias,
 * a constant or a union holds; and a namespace's declarations. Each member is given the type holding it, as an example
 * file names it, where a chain of names reaches it. One marked `@internal` or private is left out with what it holds,
 * as the reference leaves it out. Only the package's own declarations count, not those of discord.js an interface
 * extends.
 */
class MemberWalk {
  /** The examples found, each member's once, under the first public symbol that reaches it */
  readonly examples: Example[] = []
  /** The declarations whose comments were read */
  readonly read = new Set<ts.Node>()
  /** The declarations left out, with what they hold */
  readonly leftOut = new Set<ts.Node>()

  constructor(
    private readonly checker: ts.TypeChecker,
    readonly isOwn: (node: ts.Node) => boolean,
  ) {}

  /** A public symbol's declaration, under the name it is exported by. */
  declaration(name: string, declaration: ts.Node): void {
    this.read.add(declaration)
    if (ts.isVariableDeclaration(declaration)) this.read.add(declaration.parent.parent)
    if (ts.isInterfaceDeclaration(declaration) || ts.isClassDeclaration(declaration)) {
      this.members(declaration.members, name, typeName(name, declaration), ts.isClassDeclaration(declaration) ? `typeof ${name}` : undefined)
    } else if (ts.isEnumDeclaration(declaration)) {
      this.members(declaration.members, name, undefined, undefined)
    } else if (ts.isTypeAliasDeclaration(declaration)) {
      this.type(declaration.type, name, typeName(name, declaration))
    } else if (ts.isVariableDeclaration(declaration)) {
      if (declaration.type) this.type(declaration.type, name, `typeof ${name}`)
    } else if (ts.isFunctionDeclaration(declaration)) {
      const single = !this.overloaded(declaration)
      this.parameters(declaration, name, single ? `Parameters<typeof ${name}>` : undefined, single ? `ReturnType<typeof ${name}>` : undefined)
    } else if (ts.isModuleDeclaration(declaration)) {
      this.namespace(declaration, name)
    }
  }

  /** Whether a function or a method is one of several signatures, whose parameters `Parameters` can't tell apart. */
  private overloaded(declaration: ts.SignatureDeclaration): boolean {
    const declarations = ts.isConstructorDeclaration(declaration)
      ? declaration.parent.members.filter(ts.isConstructorDeclaration)
      : declaration.name && this.checker.getSymbolAtLocation(declaration.name)?.declarations?.filter(isSignature)
    return (declarations?.length ?? 0) > 1
  }

  /** A namespace's declarations, each named through it, such as `Tools.run`. */
  private namespace(declaration: ts.ModuleDeclaration, name: string): void {
    const { body } = declaration
    if (body && ts.isModuleDeclaration(body)) return this.namespace(body, `${name}.${body.name.text}`)
    if (!body || !ts.isModuleBlock(body)) return
    for (const statement of body.statements) {
      for (const inner of ts.isVariableStatement(statement) ? statement.declarationList.declarations : [statement]) {
        const innerName = (inner as { name?: ts.Node }).name
        if (!innerName || !ts.isIdentifier(innerName) || this.read.has(inner)) continue
        const doc = docOf(inner)
        if (doc?.tags.some(tag => tag.name === 'internal')) {
          this.leftOut.add(ts.isVariableDeclaration(inner) ? statement : inner)
          continue
        }
        const path = `${name}.${innerName.text}`
        const declarations = this.checker.getSymbolAtLocation(innerName)?.declarations
        this.examples.push(...examplesIn(doc, `${path}${signatureName(inner, declarations)}`, { name: innerName.text, kind: 'other' }))
        this.declaration(path, inner)
      }
    }
  }

  /** The members of a class, an interface, an object type or an enum, where `instance` and `statics` name their holders. */
  private members(members: readonly ts.Node[], owner: string, instance: string | undefined, statics: string | undefined): void {
    for (const member of members) if (isMember(member)) this.member(member, owner, instance, statics)
  }

  /** One member's examples, then what its type and its parameters hold. */
  member(member: ts.ClassElement | ts.TypeElement | ts.EnumMember, owner: string, instance: string | undefined, statics: string | undefined): void {
    if (this.read.has(member) || this.leftOut.has(member)) return
    const flags = ts.getCombinedModifierFlags(member as ts.Declaration)
    const doc = docOf(member)
    if ((member.name && ts.isPrivateIdentifier(member.name)) || flags & ts.ModifierFlags.Private || doc?.tags.some(tag => tag.name === 'internal')) {
      this.leftOut.add(member)
      return
    }
    this.read.add(member)
    const name = memberName(member)
    const path = name === undefined ? owner : `${owner}.${name}`
    // A static member is one of the class itself, not of an instance
    const holder = flags & ts.ModifierFlags.Static ? statics : instance
    const kind =
      ts.isPropertySignature(member) || ts.isPropertyDeclaration(member) || ts.isGetAccessor(member) || ts.isSetAccessor(member) || ts.isIndexSignatureDeclaration(member)
        ? 'property'
        : ts.isMethodSignature(member) || ts.isMethodDeclaration(member)
          ? 'method'
          : 'other'
    const declarations = member.name ? this.checker.getSymbolAtLocation(member.name)?.declarations : undefined
    // A computed key, such as `[Symbol.iterator]`, has no name a type can index by, so what the member holds is unreached
    const named = name !== undefined && !(member.name && ts.isComputedPropertyName(member.name))
    const indexed = ts.isIndexSignatureDeclaration(member)
    const site: MemberSite = {
      name: name ?? '',
      kind,
      holder: kind === 'other' ? undefined : holder,
      key: named ? (member.name && ts.isNumericLiteral(member.name) ? member.name.text : JSON.stringify(name)) : undefined,
    }
    this.examples.push(...examplesIn(doc, `${path}${signatureName(member, declarations)}`, site))
    const reached = site.holder === undefined || !named ? undefined : memberOf(site.holder, site.name)
    const single = !this.overloaded(member as ts.SignatureDeclaration)
    if (ts.isConstructorDeclaration(member)) {
      this.parameters(member, path, statics !== undefined && single ? `ConstructorParameters<${statics}>` : undefined, undefined)
    } else if (ts.isMethodSignature(member) || ts.isMethodDeclaration(member)) {
      const method = reached !== undefined && single ? objectOf(reached) : undefined
      this.parameters(member, path, method && `Parameters<${method}>`, method && `ReturnType<${method}>`)
    } else if (ts.isSetAccessor(member)) {
      // A setter's value is the property's type
      const [value] = member.parameters
      if (value?.type) this.type(value.type, path, reached)
    } else if (indexed) {
      const [key] = member.parameters
      this.type(member.type, path, site.holder !== undefined && key?.type ? `${objectOf(site.holder)}[${key.type.getText()}]` : undefined)
    } else if ((ts.isPropertySignature(member) || ts.isPropertyDeclaration(member) || ts.isGetAccessor(member)) && member.type) {
      this.type(member.type, path, reached)
    } else {
      this.node(member, path)
    }
  }

  /** A function's or a method's parameters, where `parameters` names their types as a tuple, and `returns` its return type. */
  private parameters(fn: ts.SignatureDeclarationBase, path: string, parameters: string | undefined, returns: string | undefined): void {
    fn.parameters.forEach((parameter, index) => {
      if (parameter.type) this.type(parameter.type, path, parameters !== undefined && !parameter.dotDotDotToken ? `${parameters}[${index}]` : undefined)
    })
    if (fn.type) this.type(fn.type, path, returns)
  }

  /** A type, where `type` names it: an object type's fields, also through unions, arrays and function types. */
  private type(node: ts.Node, path: string, type: string | undefined): void {
    if (ts.isTypeLiteralNode(node)) this.members(node.members, path, type, undefined)
    else if (ts.isParenthesizedTypeNode(node)) this.type(node.type, path, type)
    else if (ts.isUnionTypeNode(node) || ts.isIntersectionTypeNode(node)) for (const each of node.types) this.type(each, path, type && objectOf(type))
    else if (ts.isArrayTypeNode(node)) this.type(node.elementType, path, type && `${objectOf(type)}[number]`)
    else if (ts.isTypeOperatorNode(node) && node.operator === ts.SyntaxKind.ReadonlyKeyword) this.type(node.type, path, type)
    else if (isArrayReference(node)) this.type(node.typeArguments[0], path, type && `${objectOf(type)}[number]`)
    else if (ts.isFunctionTypeNode(node)) this.parameters(node, path, type && `Parameters<${objectOf(type)}>`, type && `ReturnType<${objectOf(type)}>`)
    else if (ts.isConstructorTypeNode(node)) this.parameters(node, path, type && `ConstructorParameters<${objectOf(type)}>`, type && `InstanceType<${objectOf(type)}>`)
    else this.node(node, path)
  }

  /** Any other node: what it holds, with no type named for it. */
  private node(node: ts.Node, path: string): void {
    ts.forEachChild(node, child => (isMember(child) ? this.member(child, path, undefined, undefined) : this.type(child, path, undefined)))
  }
}

/**
 * Walks every public symbol's members: those it declares, then those a public class or interface inherits from one
 * that is not public, which only it reaches.
 */
function walkMembers(checker: ts.TypeChecker, symbols: PublicSymbol[], typesDir: string): MemberWalk {
  const walk = new MemberWalk(checker, node => !path.relative(typesDir, path.resolve(node.getSourceFile().fileName)).startsWith('..'))
  for (const item of symbols) {
    for (const declaration of (item.symbol.declarations ?? []).filter(walk.isOwn)) walk.declaration(item.name, declaration)
  }
  for (const item of symbols) {
    const { symbol } = item
    if (!(symbol.flags & (ts.SymbolFlags.Class | ts.SymbolFlags.Interface))) continue
    const own = symbol.declarations?.find(declaration => ts.isClassDeclaration(declaration) || ts.isInterfaceDeclaration(declaration))
    const statics = symbol.flags & ts.SymbolFlags.Class ? `typeof ${item.name}` : undefined
    const sides = [checker.getDeclaredTypeOfSymbol(symbol)]
    if (symbol.flags & ts.SymbolFlags.Class) sides.push(checker.getTypeOfSymbol(symbol))
    for (const property of sides.flatMap(side => checker.getPropertiesOfType(side))) {
      for (const declaration of property.declarations ?? []) {
        if (isMember(declaration) && walk.isOwn(declaration)) walk.member(declaration, item.name, own && typeName(item.name, own), statics)
      }
    }
  }
  return walk
}

/**
 * The `@example`s in a public symbol's declarations that the walk did not read and did not leave out on purpose: each
 * would never compile, so it is reported rather than skipped.
 */
function unreachedExamples(walk: MemberWalk, item: PublicSymbol): string[] {
  const found: string[] = []
  const visit = (node: ts.Node) => {
    if (walk.leftOut.has(node)) return
    if ((node as { jsDoc?: unknown[] }).jsDoc?.length && !walk.read.has(node) && docOf(node)?.tags.some(tag => tag.name === 'example')) {
      const source = node.getSourceFile()
      found.push(
        `${item.name}: the @example at ${path.basename(source.fileName)}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1} is never compiled, as the check does not reach it; move it to the member it shows.`,
      )
    }
    ts.forEachChild(node, visit)
  }
  for (const declaration of (item.symbol.declarations ?? []).filter(walk.isOwn)) visit(declaration)
  return found
}

/**
 * The documentation line the links of the package at `root` name: its major and minor version, such as `4.1` for
 * 4.1.0-beta.6.
 */
export function docsLine(root = repoRoot): string {
  const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string }
  return version.split('.').slice(0, 2).join('.')
}

/** The files whose documentation links a reader follows: the package's JSDoc, and the templates a new app is made from. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(file)
    if (entry.name.endsWith('.template')) return [file]
    return /\.ts$/.test(entry.name) && !/\.(spec|test-d)\.ts$/.test(entry.name) ? [file] : []
  })
}

const DOCS_LINK = /https:\/\/meocord\.dev\/docs\/([^/\s|}]+)\//g

/**
 * The links under `root`'s `src` to another line of the documentation than `line`, which would send a reader to pages
 * for another version; `fix` rewrites them to `line` instead, and returns the files it rewrote.
 */
export function staleDocsLinks(line: string, fix: boolean, root = repoRoot): string[] {
  const stale: string[] = []
  for (const file of sourceFiles(path.join(root, 'src'))) {
    const text = readFileSync(file, 'utf8')
    // With forward slashes on every system, so a refusal reads the same on any runner
    const name = path.relative(root, file).split(path.sep).join('/')
    if (fix) {
      const fixed = text.replace(DOCS_LINK, (link, linked: string) => (linked === line ? link : `https://meocord.dev/docs/${line}/`))
      if (fixed !== text) {
        writeFileSync(file, fixed)
        stale.push(name)
      }
      continue
    }
    text.split('\n').forEach((content, index) => {
      for (const [, linked] of content.matchAll(DOCS_LINK)) {
        if (linked !== line) {
          stale.push(`${name}:${index + 1}: links docs/${linked}; link docs/${line}, the package's line, or run with --fix.`)
        }
      }
    })
  }
  return stale
}

/** The lines a snippet's wrapped lines go between, opening a class of them as the README's examples write one. */
const CLASS_WRAPPER = { open: ['@Controller()', 'export class Example {'], close: ['}'] }

/** How a snippet compiles: its own lines, edited where its form needs it, and the lines they go between. */
interface Wrapping {
  lines: string[]
  /** How many of `lines` are module code ahead of the wrapped ones */
  outside: number
  open: string[]
  close: string[]
}

/**
 * The type a piece of an object written for one member is checked against: the member as the type declares it,
 * required or not, and the type's other members optional. Of a union, only the object types that have the member
 * count, as `Omit` and `Pick` would not distribute over it.
 */
const PIECE_TYPE = 'type Piece<T, K extends PropertyKey> = T extends unknown ? (K extends keyof T ? Partial<Omit<T, K>> & Pick<T, K> : never) : never'

/** Why a member's example can't be checked as a piece of an object: no chain of names reaches the type holding it. */
const unheld = (name: string) =>
  `no chain of names reaches the type holding ${name === '' ? 'it' : name}, which a piece of an object is checked against; write code that uses the member instead`

/**
 * How a snippet compiles, or why it can't be checked. A member's example may be written as:
 * - the member as in an object, `level: 'quiet',` or `level: 'quiet';` as an interface writes it, or a class property
 *   set with `=` or a method implemented, `onReady(n) { … }`: each checked as a piece of an object of the type holding
 *   the member, which needs a chain of names reaching that type, and refused without one;
 * - module code, or class members after any module code before them, such as a decorator defined and then used.
 * A member's example that labels a statement anywhere, as `level: 'loud'` reads with no object around it, checks
 * nothing, so it is refused.
 */
function wrapping(code: string, member: MemberSite | undefined): Wrapping | { problem: string } {
  const lines = code.split('\n')
  if (member && member.kind !== 'other') {
    // Class members first: `name = 'x'` also parses as an object, as a destructuring default, and fails there
    const forms = member.kind === 'property' ? [objectMembers(code, member.name), lines, lines.map(line => line.replace(/;(\s*)$/, ',$1'))] : [objectMembers(code, member.name)]
    const piece = forms.find(form => form && parsesAsModule(`({\n${form.join('\n')}\n})`))
    if (piece && member.holder !== undefined) {
      const type = member.key === undefined ? `Partial<${objectOf(member.holder)}>` : `Piece<${objectOf(member.holder)}, ${member.key}>`
      return { lines: piece, outside: 0, open: [PIECE_TYPE, `const example: ${type} = {`], close: ['}'] }
    }
    // Written as in an object, with no type to check it against: compiled as class members, it would fail misleadingly
    if (piece && !parsesAsModule(code)) return { problem: `it is written as in an object, but ${unheld(member.name)}.` }
  }
  if (parsesAsModule(code)) {
    const labelled = member && labelIn(code)
    const label = labelled?.label.text
    // The member written with no object around it, `level: 'loud'`, or an index signature's key so written
    if (member && labelled && ts.isExpressionStatement(labelled.statement) && (label === member.name || member.name === '')) {
      const how = member.holder === undefined ? `, and ${unheld(member.name)}` : `; write it as in an object, \`${label}: …,\``
      return { problem: `it reads as the label \`${label}:\`, which checks nothing${how}.` }
    }
    // Any other label, such as a loop's: refused too, as a member's example that labels a statement can't be told from one
    // that checks nothing
    if (member && label !== undefined) return { problem: `it labels a statement \`${label}:\`, which a member's example can't, as a member written as a label checks nothing; write the code without the label.` }
    return { lines, outside: lines.length, open: [], close: [] }
  }
  for (let index = 0; index < lines.length; index++) {
    if (!/^(@|constructor\(|async |private |public |protected |readonly |static |[A-Za-z_$][\w$]*\()/.test(lines[index])) continue
    const outside = lines.slice(0, index).join('\n')
    const members = lines.slice(index).join('\n')
    if (parsesAsModule(outside) && parsesAsModule(`class Example {\n${members}\n}`)) return { lines, outside: index, ...CLASS_WRAPPER }
  }
  return { lines, outside: 0, ...CLASS_WRAPPER }
}

/** The first labelled statement of a snippet, at any depth, as a member written with no object around it reads. */
function labelIn(code: string): ts.LabeledStatement | undefined {
  const find = (node: ts.Node): ts.LabeledStatement | undefined => (ts.isLabeledStatement(node) ? node : ts.forEachChild(node, find))
  return find(ts.createSourceFile('snippet.ts', code, ts.ScriptTarget.ES2022, true))
}

/**
 * Class members written for the member `name`, a property set with `=` or a method implemented, as the members of an
 * object literal, line for line; none unless every one is a plain property or method and one is `name`.
 */
function objectMembers(code: string, name: string): string[] | undefined {
  const head = 'class Example {\n'
  const text = `${head}${code}\n}`
  if (!parsesAsModule(text)) return undefined
  const declaration = ts.createSourceFile('members.ts', text, ts.ScriptTarget.ES2022, true).statements[0]
  if (!declaration || !ts.isClassDeclaration(declaration) || !declaration.members.some(member => memberName(member) === name)) return undefined
  const edits: { start: number; end: number; text: string }[] = []
  for (const member of declaration.members) {
    const plain = (ts.canHaveDecorators(member) ? (ts.getDecorators(member) ?? []) : []).length === 0
    const modifiers = (ts.canHaveModifiers(member) ? (ts.getModifiers(member) ?? []) : []).map(modifier => modifier.kind)
    if (!plain) return undefined
    if (ts.isPropertyDeclaration(member)) {
      if (modifiers.length > 0 || !member.initializer || member.type || member.questionToken || member.exclamationToken) return undefined
      edits.push({ start: member.name.end, end: member.initializer.getStart(), text: ': ' })
    } else if (ts.isMethodDeclaration(member) || ts.isGetAccessor(member) || ts.isSetAccessor(member)) {
      if (modifiers.some(kind => kind !== ts.SyntaxKind.AsyncKeyword)) return undefined
    } else {
      return undefined
    }
    edits.push(text[member.end - 1] === ';' ? { start: member.end - 1, end: member.end, text: ',' } : { start: member.end, end: member.end, text: ',' })
  }
  let edited = text
  for (const edit of edits.sort((a, b) => b.start - a.start)) edited = edited.slice(0, edit.start) + edit.text + edited.slice(edit.end)
  return edited.slice(head.length, edited.length - '\n}'.length).split('\n')
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
function readmeBlocks(): { example: Example; firstLine: number }[] {
  const lines = readFileSync(path.join(repoRoot, 'README.md'), 'utf8').split('\n')
  const blocks: { code: string; firstLine: number }[] = []
  for (let i = 0; i < lines.length; i++) {
    if (!/^```(ts|typescript)\s*$/.test(lines[i])) continue
    const end = lines.findIndex((line, j) => j > i && line.startsWith('```'))
    blocks.push({ code: lines.slice(i + 1, end).join('\n'), firstLine: i + 2 })
    i = end
  }
  return blocks.map(({ code, firstLine }, index) => ({
    example: { owner: 'README.md', label: `README.md: its example${blocks.length > 1 ? ` ${index + 1}` : ''}`, code },
    firstLine,
  }))
}

/** What {@link checkDocs} checks, and where. */
export interface DocsCheck {
  /** The entry points that ship types, as the specifier an example imports to its declaration file */
  entries: Map<string, string>
  /** The package's own declarations: a member declared elsewhere, such as one of discord.js, is not the package's */
  typesDir: string
  /** The folder the examples compile as files of, which their imports resolve from */
  examplesDir: string
  /** The stand-ins an example may name without declaring */
  fixturesFile?: string
  /** The declarations of discord.js, whose names an example may use unimported */
  discordTypes?: string
  /** Code to compile besides the JSDoc's, such as the README's blocks, each with the line its code starts on */
  blocks?: { example: Example; firstLine: number }[]
}

/** What {@link checkDocs} found. */
export interface DocsReport {
  problems: string[]
  symbols: PublicSymbol[]
  /** The examples compiled, and how many of them a member gave */
  examples: number
  memberExamples: number
}

/** Checks every public symbol's JSDoc against the standard and compiles every example it reaches. */
export function checkDocs({ entries, typesDir, examplesDir, fixturesFile, discordTypes, blocks = [] }: DocsCheck): DocsReport {
  const roots = [...entries.values(), discordTypes, fixturesFile].filter((file): file is string => file !== undefined)
  const base = ts.createProgram(roots, compilerOptions)
  const symbolMap = publicSymbols(base, entries, typesDir)
  const symbols = [...symbolMap.values()]
  const checker = base.getTypeChecker()
  const problems: string[] = []
  // The module an example imports a fixture from, as a path relative to the examples
  const fixturesPath = fixturesFile && path.relative(examplesDir, fixturesFile).replaceAll(path.sep, '/').replace(/\.ts$/, '.js')
  const fixturesModule = fixturesPath && (fixturesPath.startsWith('.') ? fixturesPath : `./${fixturesPath}`)

  // Where each importable name comes from; a name with two sources is refused rather than guessed
  const sources = importSources(symbolMap, discordTypes ? { 'discord.js': exportedSymbols(base, discordTypes) } : {})
  if (fixturesFile) {
    for (const name of exportedSymbols(base, fixturesFile).keys()) {
      if (sources.has(name)) problems.push(`${path.relative(repoRoot, fixturesFile)}: ${name} shadows an export of ${[...sources.get(name)!].join(', ')}.`)
      sources.set(name, (sources.get(name) ?? new Set()).add(fixturesModule!))
    }
  }

  const files = new Map<string, { label: string; code: string; lineOf: (number | undefined)[] }>()
  /**
   * Adds one snippet as a file of its own, its own imports first, then the names it uses from the package,
   * discord.js and the fixtures. `firstLine` is where its first line stands, for reporting.
   */
  const addExample = ({ owner, label, code: snippet, member }: Example, firstLine = 1) => {
    // A library the example shows, such as a schema library, is imported by the example itself, first
    const lines = snippet.split('\n')
    const start = Math.max(0, lines.findIndex(line => !/^import .+ from '[^']+'$/.test(line) && line.trim() !== ''))
    const ownImports = lines.slice(0, start).filter(line => line.trim() !== '')
    const wrapped = wrapping(lines.slice(start).join('\n'), member)
    if ('problem' in wrapped) {
      problems.push(`${label}: ${wrapped.problem}`)
      return
    }
    const { lines: exampleLines, outside, open, close } = wrapped
    const body = `${[...exampleLines.slice(0, outside), ...open, ...exampleLines.slice(outside), ...close].join('\n')}\n`
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
      autoImports.push(`import { ${name} } from '${module}'`)
    }
    // The compiled file, with the snippet's line number for each of its lines
    const code: string[] = []
    const lineOf: (number | undefined)[] = []
    const push = (text: string, snippetLine?: number) => {
      code.push(text)
      lineOf.push(snippetLine)
    }
    lines.slice(0, start).forEach((line, i) => line.trim() !== '' && push(line, firstLine + i))
    for (const line of autoImports) push(line)
    exampleLines.slice(0, outside).forEach((line, i) => push(line, firstLine + start + i))
    for (const line of open) push(line)
    exampleLines.slice(outside).forEach((line, i) => push(line, firstLine + start + outside + i))
    for (const line of close) push(line)
    push('export {}')
    // Keyed by a counter: on a case-insensitive disk, UseTheme and useTheme would be one file
    files.set(path.join(examplesDir, `${files.size}.ts`), { label, code: `${code.join('\n')}\n`, lineOf })
  }

  for (const item of symbols) {
    problems.push(...documentationProblems(checker, item))
    if (item.external || !item.group) continue
    item.examples.forEach(example => addExample(example))
  }
  // The reference shows a member's examples with it, so they compile as a reader copies them too
  const grouped = symbols.filter(item => item.group)
  const walk = walkMembers(checker, grouped, typesDir)
  walk.examples.forEach(example => addExample(example))
  for (const item of grouped) problems.push(...unreachedExamples(walk, item))
  // The README's TypeScript blocks: the landing page's example must compile as a reader copies it
  blocks.forEach(({ example, firstLine }) => addExample(example, firstLine))

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
    [...files.keys()].filter(file => !augmenting.includes(file)).concat(fixturesFile ?? []),
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
  return { problems, symbols, examples: files.size, memberExamples: walk.examples.length }
}

function main(): void {
  const line = docsLine()
  const examplesDir = path.join(repoRoot, '.jsdoc-examples')
  // The declarations an example's `import … from 'discord.js'` resolves to, as an ES module, as the package's own
  // re-exports of it resolve: its CommonJS typings would declare every name a second time
  const discordTypes = ts.resolveModuleName('discord.js', path.join(examplesDir, 'x.ts'), compilerOptions, ts.sys, undefined, undefined, ts.ModuleKind.ESNext).resolvedModule
    ?.resolvedFileName
  if (!discordTypes) throw new Error('discord.js could not be resolved. Run bun install first.')
  const report = checkDocs({
    entries: entryPoints(),
    typesDir: path.join(repoRoot, 'dist/types'),
    examplesDir,
    fixturesFile: path.join(repoRoot, 'scripts/jsdoc-examples/fixtures.ts'),
    discordTypes,
    blocks: readmeBlocks(),
  })
  const problems = [...staleDocsLinks(line, false), ...report.problems]

  const own = report.symbols.filter(item => !item.external)
  const following = own.filter(item => item.group)
  console.log(`${report.examples} examples of ${following.length} of ${own.length} public symbols checked, ${report.memberExamples} of them on members.`)

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

if (import.meta.main) {
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
}
