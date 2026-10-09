/**
 * Compares two versions of a package's public declarations, member by member, with the TypeScript checker: each
 * export of the old version and each member of it must still be there, and accept and return what it did. An
 * addition is compatible. Run by check-api-compat.ts.
 */
import ts from 'typescript'

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
export function apiBreaks(checker: ts.TypeChecker, before: ts.SourceFile, after: ts.SourceFile): ApiBreak[] {
  const breaks: ApiBreak[] = []
  const seen = new Set<string>()
  const report = (path: string, problem: string) => breaks.push({ path, problem })
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

  /** A function's signatures: each old one must be matched, in order, by one that accepts and returns as it did. */
  function compareSignatures(path: string, olds: readonly ts.Signature[], news: readonly ts.Signature[], what: string) {
    if (olds.length === 0) return
    if (news.length === 0) return report(path, `is no longer ${what}`)
    if (news.length < olds.length) report(path, `has ${news.length} ${what === 'callable' ? 'call' : 'construct'} signatures where it had ${olds.length}`)
    olds.forEach((old, index) => {
      const next = news[index]
      if (!next) return
      const at = olds.length > 1 ? `${path} (overload ${index + 1})` : path
      const oldParams = old.getParameters()
      const newParams = next.getParameters()
      const required = (params: readonly ts.Symbol[]) => params.filter(param => !parameterOptional(param)).length
      if (required(newParams) > required(oldParams)) report(at, `requires ${required(newParams)} arguments where it required ${required(oldParams)}`)
      if (old.getTypeParameters()?.length !== next.getTypeParameters()?.length) {
        report(at, `has ${next.getTypeParameters()?.length ?? 0} type parameters where it had ${old.getTypeParameters()?.length ?? 0}`)
        return
      }
      // A generic signature's parameters and return name its own type parameters, which the checker cannot relate across
      // two declarations; its arity is checked above, and the rest of it by the overloads and members around it
      if (old.getTypeParameters()?.length) return
      oldParams.forEach((param, at2) => {
        const nextParam = newParams[at2] ?? (isRest(newParams.at(-1)) ? newParams.at(-1) : undefined)
        if (!nextParam) return report(at, `takes no argument ${param.name}, which it took`)
        // A parameter made required is reported above; its type is compared without the `undefined` optional adds
        const madeRequired = parameterOptional(param) && !parameterOptional(nextParam)
        const oldType = madeRequired ? checker.getNonNullableType(checker.getTypeOfSymbol(param)) : checker.getTypeOfSymbol(param)
        const newType = checker.getTypeOfSymbol(nextParam)
        if (!assignable(oldType, newType)) report(at, `narrowed parameter ${param.name}: ${show(oldType)} → ${show(newType)}`)
      })
      const oldReturn = old.getReturnType()
      const newReturn = next.getReturnType()
      if (!assignable(newReturn, oldReturn)) report(at, `widened return: ${show(oldReturn)} → ${show(newReturn)}`)
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
      const params = (symbol: ts.Symbol) => (checker.getDeclaredTypeOfSymbol(symbol) as ts.InterfaceType).typeParameters?.length ?? 0
      if (params(next) > params(old) && (next.declarations ?? []).some(declaration => (ts.getEffectiveTypeParameterDeclarations(declaration as ts.DeclarationWithTypeParameterChildren) ?? []).slice(params(old)).some(parameter => !parameter.default))) {
        report(name, `requires ${params(next)} type arguments where it took ${params(old)}`)
      }
      if (oldType.flags & ts.TypeFlags.Object) compareType(name, oldType, newType)
      else if (!assignable(oldType, newType)) report(name, `narrowed: ${show(oldType)} → ${show(newType)}`)
    }
  }
  return breaks
}
