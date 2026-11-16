/**
 * Compares two versions of a package's public declarations, member by member, with the TypeScript checker: each
 * export of the old version and each member of it must still be there, and accept and return what it did. An
 * addition is compatible. Run by check-api-compat.ts.
 */
import ts from 'typescript'
import { type Allowlist, isRetired } from './allowlist.js'

/** A change that can break code written against the old declarations, at a path such as `CommandMetadata.specificity`. */
export interface ApiBreak {
  path: string
  problem: string
}

/** Each name a module exports, resolved through re-exports to the symbol it names. */
function exportsOf(checker: ts.TypeChecker, file: ts.SourceFile): Map<string, ts.Symbol> {
  const module = checker.getSymbolAtLocation(file)
  if (!module) throw new Error(`${file.fileName} is not a module the compiler can read`)
  return new Map(
    checker.getExportsOfModule(module).map(symbol => [symbol.name, symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol]),
  )
}

/** A member keyed by a well-known symbol, such as `[Symbol.iterator]`, under its name without the compiler's per-file id. */
const wellKnown = (name: string) => name.replace(/^__@(\w+)@\d+$/, '[Symbol.$1]')

const isOptional = (symbol: ts.Symbol) => (symbol.flags & ts.SymbolFlags.Optional) !== 0

const isReadonly = (symbol: ts.Symbol) =>
  (symbol.declarations ?? []).some(declaration => ts.getCombinedModifierFlags(declaration) & ts.ModifierFlags.Readonly)

/** Whether a parameter may be left out: optional, defaulted or a rest. */
const parameterOptional = (parameter: ts.Symbol) =>
  (parameter.declarations ?? []).some(
    declaration => ts.isParameter(declaration) && (declaration.questionToken !== undefined || declaration.initializer !== undefined || declaration.dotDotDotToken !== undefined),
  )

const isRest = (parameter: ts.Symbol | undefined) =>
  (parameter?.declarations ?? []).some(declaration => ts.isParameter(declaration) && declaration.dotDotDotToken !== undefined)

/**
 * Finds the breaks between two entry files of one program: `before` as published, `after` as built. Every export,
 * member and signature of `before` is checked; only what `after` adds goes unchecked.
 */
export function apiBreaks(checker: ts.TypeChecker, before: ts.SourceFile, after: ts.SourceFile): { breaks: ApiBreak[]; review: string[] } {
  const breaks: ApiBreak[] = []
  const review: string[] = []
  const seen = new Set<string>()
  // A class's type parameters are reached through its type and its constructor; each break is reported once
  const reported = new Set<string>()
  const report = (path: string, problem: string) => {
    if (reported.has(`${path}\0${problem}`)) return
    reported.add(`${path}\0${problem}`)
    breaks.push({ path, problem })
  }
  const show = (type: ts.Type) => checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation)

  /** The name a type is declared under, with its type arguments, such as `Route<T>`; a named type is one declaration. */
  const named = (type: ts.Type) => (type.aliasSymbol ?? type.getSymbol())?.name

  /**
   * Whether a value of `source` is still accepted where `target` is now expected. The two come from different
   * declaration files, so a type both versions declare under one name is the same type here: a class with private
   * members would otherwise never be assignable to its own copy, and its own changes are checked at its export.
   */
  function relate(source: ts.Type, target: ts.Type): boolean {
    if (source === target || show(source) === show(target)) return true
    if (source.isUnion()) return source.types.every(member => relate(member, target))
    if (target.isUnion()) return target.types.some(member => relate(source, member))
    const name = named(source)
    if (name && name !== '__type' && name !== '__object' && name === named(target)) {
      const args = (type: ts.Type) => type.aliasTypeArguments ?? checker.getTypeArguments(type as ts.TypeReference) ?? []
      const [a, b] = [args(source), args(target)]
      return a.length === b.length && a.every((arg, index) => relate(arg, b[index]!))
    }
    return checker.isTypeAssignableTo(source, target)
  }
  const assignable = relate

  /** Two texts as `before → after`, a long pair cut to where they differ, with some context on either side. */
  const changed = (before: string, after: string) => {
    if (before.length + after.length <= 400) return `${before} → ${after}`
    let start = 0
    while (start < before.length && before[start] === after[start]) start++
    let end = 0
    while (end < before.length - start && end < after.length - start && before.at(-1 - end) === after.at(-1 - end)) end++
    const cut = (text: string) => {
      const [from, to] = [Math.max(0, start - 60), Math.min(text.length, text.length - end + 60)]
      const shown = text.slice(from, Math.min(to, from + 300))
      return `${from > 0 ? '…' : ''}${shown}${from + shown.length < text.length ? '…' : ''}`
    }
    return `${cut(before)} → ${cut(after)}`
  }

  // A type as `show` builds it, and a signature as `signatureToString` builds it with an arrow, as nodes
  const typeNode = (type: ts.Type) => checker.typeToTypeNode(type, undefined, ts.NodeBuilderFlags.NoTruncation | ts.NodeBuilderFlags.IgnoreErrors)
  const signatureNode = (signature: ts.Signature) =>
    checker.signatureToSignatureDeclaration(
      signature,
      ts.SyntaxKind.FunctionType,
      undefined,
      ts.NodeBuilderFlags.NoTruncation | ts.NodeBuilderFlags.IgnoreErrors | ts.NodeBuilderFlags.WriteTypeParametersInQualifiedName,
    )
  const printer = ts.createPrinter({ removeComments: true })
  const printed = ts.createSourceFile('printed.ts', '', ts.ScriptTarget.Latest)

  /** Which of `parameters` a built node names, by the symbol the node builder gives each identifier it writes; -1 for none. */
  const parameterAt = (node: ts.Node, parameters: readonly ts.TypeParameter[]) => {
    const symbol = ts.isIdentifier(node) ? (node as ts.Identifier & { symbol?: ts.Symbol }).symbol : undefined
    return symbol ? parameters.findIndex(parameter => parameter.symbol === symbol) : -1
  }

  /** Whether a type names one of `parameters`: by symbol, so a literal or a member spelling the name doesn't. */
  const mentions = (type: ts.Type, parameters: readonly ts.TypeParameter[]) => {
    const visit = (node: ts.Node): boolean => parameterAt(node, parameters) >= 0 || ts.forEachChild(node, visit) === true
    const node = typeNode(type)
    return node !== undefined && visit(node)
  }

  /**
   * A built node printed as `show` prints it, with each of `parameters` named by its position, `T0`, `T1` and so on:
   * by symbol, so a literal or a member spelling the name, or another type of that name, is printed as it is.
   */
  const byPosition = (node: ts.Node | undefined, parameters: readonly ts.TypeParameter[]) => {
    if (!node) return ''
    const rename = (context: ts.TransformationContext) => (root: ts.Node) =>
      ts.visitNode(root, function visit(child: ts.Node): ts.Node {
        const index = parameterAt(child, parameters)
        return index >= 0 ? ts.factory.createIdentifier(`T${index}`) : ts.visitEachChild(child, visit, context)
      })
    const result = ts.transform(node, [rename])
    const text = printer.printNode(ts.EmitHint.Unspecified, result.transformed[0]!, printed)
    result.dispose()
    return text
  }

  /**
   * A generic's type parameters, by position: none removed, none added without a default, none whose default is
   * dropped, and each constraint the same or wider, so every type argument the old version took is still taken. A
   * signature (`called`) that had none was called without type arguments, which the compiler infers, so it may gain any.
   */
  function compareTypeParameters(path: string, olds: readonly ts.TypeParameter[], news: readonly ts.TypeParameter[], called = false) {
    if (news.length < olds.length) report(path, `has ${news.length} type parameters where it had ${olds.length}`)
    // A list of as many type arguments as the old version had still fits when each parameter past it has a default
    const required = news.findLastIndex(parameter => !parameter.getDefault()) + 1
    if (required > olds.length && !(called && olds.length === 0)) report(path, `requires ${required} type arguments where it took ${olds.length}`)
    olds.forEach((old, index) => {
      const next = news[index]
      if (!next) return
      if (old.getDefault() && !next.getDefault()) report(path, `requires type parameter ${next.symbol.name}, which had a default`)
      const [oldConstraint, newConstraint] = [old.getConstraint(), next.getConstraint()]
      if (!newConstraint) return
      const shown = (constraint: ts.Type | undefined, parameters: readonly ts.TypeParameter[]) =>
        constraint ? byPosition(typeNode(constraint), parameters) : 'unknown'
      if (oldConstraint && shown(oldConstraint, olds) === shown(newConstraint, news)) return
      if (!oldConstraint || !relate(oldConstraint, newConstraint)) {
        report(path, `narrowed type parameter ${old.symbol.name}: extends ${oldConstraint ? show(oldConstraint) : 'unknown'} → extends ${show(newConstraint)}`)
      }
    })
  }

  /** The type parameters a type or a class declares, in order. */
  const declaredParameters = (symbol: ts.Symbol): ts.TypeParameter[] => {
    const declaration = (symbol.declarations ?? []).find(node => ts.getEffectiveTypeParameterDeclarations(node as ts.DeclarationWithTypeParameterChildren).length > 0)
    return declaration
      ? ts.getEffectiveTypeParameterDeclarations(declaration as ts.DeclarationWithTypeParameterChildren).map(node => checker.getTypeAtLocation(node) as ts.TypeParameter)
      : []
  }

  /** A function's signatures: the calls each old one takes must reach a new one that returns as it did, or the one at its index must take them. */
  function compareSignatures(path: string, olds: readonly ts.Signature[], news: readonly ts.Signature[], what: string) {
    if (olds.length === 0) return
    if (news.length === 0) return report(path, `is no longer ${what}`)
    if (news.length < olds.length) report(path, `has ${news.length} ${what === 'callable' ? 'call' : 'construct'} signatures where it had ${olds.length}`)
    // A generic overload the old version has no counterpart for, compared as text, can change which overload a call
    // resolves to: listed for review
    const asText = (signature: ts.Signature) => byPosition(signatureNode(signature), signature.getTypeParameters() ?? [])
    if (news.length > olds.length) {
      news.forEach((next, index) => {
        if (next.getTypeParameters()?.length && !olds.some(old => asText(old) === asText(next))) {
          review.push(`${path} (overload ${index + 1} of ${news.length}): added ${changed('', asText(next)).replace(/^ → /, '')}`)
        }
      })
    }
    const required = (params: readonly ts.Symbol[]) => params.filter(param => !parameterOptional(param)).length
    const bare = (type: ts.Type) => (type.flags & ts.TypeFlags.TypeParameter) !== 0
    // A rest parameter takes each argument as its element type
    const argumentType = (param: ts.Symbol, rest: boolean) => {
      const type = checker.getTypeOfSymbol(param)
      return rest ? (checker.getIndexTypeOfType(type, ts.IndexKind.Number) ?? type) : type
    }

    /**
     * Whether `callee` accepts a call with `caller`'s arguments: it requires no more of them, takes each, and each
     * argument's type fits its parameter. A parameter typed by the callee's own type parameter, which no argument from
     * another declaration is assignable to, is read as its constraint, and takes anything without one.
     */
    function accepts(callee: ts.Signature, caller: ts.Signature): boolean {
      const given = caller.getParameters()
      const taken = callee.getParameters()
      if (required(taken) > required(given)) return false
      const restAt = isRest(taken.at(-1)) ? taken.length - 1 : Infinity
      return given.every((param, index) => {
        const target = taken[Math.min(index, restAt)]
        if (!target) return false
        // An argument typed by the caller's own type parameter is related through its constraint by the checker itself
        const argument = argumentType(param, isRest(param))
        const parameter = argumentType(target, index >= restAt)
        const bound = bare(parameter) ? checker.getBaseConstraintOfType(parameter) : parameter
        return !bound || assignable(argument, bound)
      })
    }

    /**
     * What breaks code calling `old` once `next` stands where it stood and no signature accepts its calls: arguments
     * required or no longer taken, parameter types narrowed, the return widened, type parameters narrowed. A generic
     * pair's parameters and return are compared as text and listed for review, beyond an argument it no longer takes
     * and one that no longer fits a parameter typed by a type parameter.
     */
    function compareInPlace(at: string, old: ts.Signature, next: ts.Signature) {
      const oldParams = old.getParameters()
      const newParams = next.getParameters()
      const restAt = isRest(newParams.at(-1)) ? newParams.length - 1 : Infinity
      if (required(newParams) > required(oldParams)) report(at, `requires ${required(newParams)} arguments where it required ${required(oldParams)}`)
      const generic = (old.getTypeParameters() ?? []).length > 0 || (next.getTypeParameters() ?? []).length > 0
      if (generic) compareTypeParameters(at, old.getTypeParameters() ?? [], next.getTypeParameters() ?? [], true)
      oldParams.forEach((param, index) => {
        const nextParam = newParams[Math.min(index, restAt)]
        if (!nextParam) return report(at, `takes no argument ${param.name}, which it took`)
        // A parameter made required is reported above; its type is compared without the `undefined` optional adds
        const madeRequired = parameterOptional(param) && !parameterOptional(nextParam)
        const given = argumentType(param, isRest(param))
        const oldType = madeRequired ? checker.getNonNullableType(given) : given
        const newType = argumentType(nextParam, index >= restAt)
        if (generic) {
          // Only a parameter now typed by a type parameter, through its constraint; one typed by the old signature's own
          // type parameter is covered by comparing the type parameters
          const bound = bare(newType) && !mentions(oldType, old.getTypeParameters() ?? []) ? checker.getBaseConstraintOfType(newType) : undefined
          if (bound && !assignable(oldType, bound)) report(at, `narrowed parameter ${param.name}: ${show(oldType)} → ${show(newType)} extends ${show(bound)}`)
          return
        }
        if (!assignable(oldType, newType)) report(at, `narrowed parameter ${param.name}: ${show(oldType)} → ${show(newType)}`)
      })
      if (generic) {
        if (asText(old) !== asText(next)) review.push(`${at}: ${changed(asText(old), asText(next))}`)
        return
      }
      if (!assignable(next.getReturnType(), old.getReturnType())) report(at, `widened return: ${show(old.getReturnType())} → ${show(next.getReturnType())}`)
    }

    // TypeScript tries a signature with a parameter typed by a literal, such as `'x'`, ahead of the others
    const specialized = (signature: ts.Signature) =>
      signature.getDeclaration()?.parameters.some(param => param.type?.kind === ts.SyntaxKind.LiteralType) ?? false
    const inCallOrder = (signatures: readonly ts.Signature[]) => [...signatures.filter(specialized), ...signatures.filter(s => !specialized(s))]
    const [oldOrder, newOrder] = [inCallOrder(olds), inCallOrder(news)]

    const typeArity = (signature: ts.Signature) => (signature.getTypeParameters() ?? []).length
    const takesTypeArguments = (signature: ts.Signature, count: number) =>
      (signature.getTypeParameters() ?? []).filter(parameter => !parameter.getDefault()).length <= count && count <= typeArity(signature)
    // What a call without type arguments sees of a signature: its parameters and return, its type parameters by position
    const parameterShape = (signature: ts.Signature) =>
      signature
        .getParameters()
        .map(param => `${param.name}: ${byPosition(typeNode(checker.getTypeOfSymbol(param)), signature.getTypeParameters() ?? [])}`)
        .join(', ')
    const shape = (signature: ts.Signature) =>
      `${parameterShape(signature)} => ${byPosition(typeNode(signature.getReturnType()), signature.getTypeParameters() ?? [])}`
    // A call without type arguments sees no change when the parameters read the same and the new return fits the old
    const unchangedUntyped = (was: ts.Signature, now: ts.Signature) =>
      shape(was) === shape(now) ||
      // `relate` would match a type parameter by name, so a return naming one is compared by position, through `shape`
      (parameterShape(was) === parameterShape(now) && !mentions(was.getReturnType(), was.getTypeParameters() ?? []) && assignable(now.getReturnType(), was.getReturnType()))

    // Each old signature's calls, typed as it declares them, were answered by the first old signature that accepts them,
    // and now by the first new one, as TypeScript resolves an overloaded call; a call that passes type arguments only by
    // one that takes that many. Each pair is compared once
    const compared = new Set<string>()
    const reviewed = new Set<string>()
    const compareResolved = (at: string, was: ts.Signature, now: ts.Signature, typed: boolean) => {
      if (asText(was) === asText(now)) return
      const pair = `${olds.indexOf(was)}\0${news.indexOf(now)}`
      if (compared.has(`${typed}\0${pair}`)) return
      compared.add(`${typed}\0${pair}`)
      if (typeArity(was) > 0 || typeArity(now) > 0) {
        if (typed) compareTypeParameters(at, was.getTypeParameters() ?? [], now.getTypeParameters() ?? [])
        if ((typed || !unchangedUntyped(was, now)) && !reviewed.has(pair)) {
          reviewed.add(pair)
          review.push(`${at}: ${changed(asText(was), asText(now))}`)
        }
        return
      }
      if (!assignable(now.getReturnType(), was.getReturnType())) report(at, `widened return: ${show(was.getReturnType())} → ${show(now.getReturnType())}`)
    }
    olds.forEach((old, index) => {
      const at = olds.length > 1 ? `${path} (overload ${index + 1})` : path
      const answering = (signatures: readonly ts.Signature[], typeArguments?: number) =>
        signatures.find(candidate => (typeArguments === undefined || takesTypeArguments(candidate, typeArguments)) && accepts(candidate, old))
      const now = answering(newOrder)
      if (!now) {
        // No signature takes its calls: compared with the one at its place, which reports what stops them
        const next = news[index]
        if (next) compareInPlace(at, old, next)
        return
      }
      compareResolved(at, answering(oldOrder) ?? old, now, false)
      const count = typeArity(old)
      if (count === 0) return
      const typedNow = answering(newOrder, count)
      if (typedNow) compareResolved(at, answering(oldOrder, count) ?? old, typedNow, true)
      // No signature takes as many type arguments: compared with the one its other calls reach, which says why
      else compareTypeParameters(at, old.getTypeParameters() ?? [], now.getTypeParameters() ?? [])
    })
  }

  /**
   * A type's members. A member's own type may widen, as a union or an enum gains a member, but not narrow; a method's
   * parameters may not narrow, and its return may not widen.
   */
  function compareType(path: string, old: ts.Type, next: ts.Type) {
    const key = `${path}\0${checker.typeToString(old)}`
    if (seen.has(key)) return
    seen.add(key)

    compareSignatures(path, old.getCallSignatures(), next.getCallSignatures(), 'callable')
    compareSignatures(path, old.getConstructSignatures(), next.getConstructSignatures(), 'constructible')

    for (const kind of [ts.IndexKind.String, ts.IndexKind.Number]) {
      const oldIndex = checker.getIndexInfoOfType(old, kind)
      if (oldIndex && !checker.getIndexInfoOfType(next, kind)) report(path, `lost its ${kind === ts.IndexKind.String ? 'string' : 'number'} index`)
    }

    // Only object types have members to walk; a union, a literal or a primitive is compared whole
    if (!(old.flags & ts.TypeFlags.Object) || old.getCallSignatures().length > 0) return
    for (const member of checker.getPropertiesOfType(old)) {
      // A class's own `prototype` is its instance type, compared at the class itself
      if (member.name === 'prototype') continue
      const at = `${path}.${wellKnown(member.name)}`
      const nextMember =
        checker.getPropertyOfType(next, member.name) ??
        checker.getPropertiesOfType(next).find(candidate => wellKnown(candidate.name) === wellKnown(member.name))
      if (!nextMember) {
        report(at, 'was removed')
        continue
      }
      const madeRequired = isOptional(member) && !isOptional(nextMember)
      if (madeRequired) report(at, 'was made required')
      if (!isReadonly(member) && isReadonly(nextMember)) report(at, 'was made readonly')
      // Compared without the `undefined` an optional member adds, once its being made required is reported
      const oldType = madeRequired ? checker.getNonNullableType(checker.getTypeOfSymbol(member)) : checker.getTypeOfSymbol(member)
      const newType = checker.getTypeOfSymbol(nextMember)
      if (oldType.getCallSignatures().length > 0 && checker.getPropertiesOfType(oldType).length === 0) {
        compareSignatures(at, oldType.getCallSignatures(), newType.getCallSignatures(), 'callable')
      } else if (oldType.flags & ts.TypeFlags.Object && (oldType as ts.ObjectType).objectFlags & ts.ObjectFlags.Anonymous) {
        compareType(at, oldType, newType)
      } else if (!assignable(oldType, newType)) {
        report(at, `narrowed: ${show(oldType)} → ${show(newType)}`)
      }
    }
  }

  const olds = exportsOf(checker, before)
  const news = exportsOf(checker, after)
  for (const [name, old] of olds) {
    const next = news.get(name)
    if (!next) {
      report(name, 'is no longer exported')
      continue
    }
    if (old.flags & ts.SymbolFlags.Value) {
      if (!(next.flags & ts.SymbolFlags.Value)) report(name, 'is no longer a value')
      else compareType(name, checker.getTypeOfSymbol(old), checker.getTypeOfSymbol(next))
    }
    if (old.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias | ts.SymbolFlags.Class | ts.SymbolFlags.Enum)) {
      if (!(next.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias | ts.SymbolFlags.Class | ts.SymbolFlags.Enum))) {
        report(name, 'is no longer a type')
        continue
      }
      const oldType = checker.getDeclaredTypeOfSymbol(old)
      const newType = checker.getDeclaredTypeOfSymbol(next)
      compareTypeParameters(name, declaredParameters(old), declaredParameters(next))
      if (oldType.flags & ts.TypeFlags.Object) compareType(name, oldType, newType)
      else if (!assignable(oldType, newType)) report(name, `narrowed: ${show(oldType)} → ${show(newType)}`)
    }
  }
  return { breaks, review }
}

/** A break in one entry's declarations, under the id the allowlist names it by, such as `common Meta.specificity`. */
export interface EntryBreak extends ApiBreak {
  id: string
  file: string
}

/**
 * Whether the allowlist may accept a break outside a major release: a member whose type was narrowed. Code that
 * reads the member still compiles; only code that builds its own value with the wider type breaks.
 */
const narrowsMember = ({ path, problem }: ApiBreak) => path.includes('.') && problem.startsWith('narrowed: ')

/**
 * The breaks judged against the allowlist, compared with `baseline`: the entries the baseline has retired, which are
 * not read; the breaks no other entry names; the entries that name no break; and, unless the release is a major one,
 * the entries that allow a break other than a narrowed member type.
 */
export function judgeBreaks(breaks: EntryBreak[], allowlist: Allowlist, major: boolean, baseline: string) {
  const retired = Object.keys(allowlist).filter(id => isRetired(allowlist[id], baseline))
  const active = new Set(Object.keys(allowlist).filter(id => !retired.includes(id)))
  const allowed = new Set(breaks.filter(({ id }) => active.has(id)).map(({ id }) => id))
  return {
    unlisted: breaks.filter(({ id }) => !active.has(id)),
    allowed,
    stale: [...active].filter(id => !allowed.has(id)),
    majorOnly: major ? [] : [...new Set(breaks.filter(entry => active.has(entry.id) && !narrowsMember(entry)).map(({ id }) => id))],
    retired,
  }
}
