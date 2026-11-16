import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { type ApiBreak, apiBreaks, judgeBreaks } from './api-compat.js'

/** The breaks between two declaration files, compiled together in memory as the check compiles the real ones. */
function breaksBetween(before: string, after: string): string[] {
  return compare(before, after).breaks
}

/** {@link compared}, each break as one line. */
function compare(before: string, after: string): { breaks: string[]; review: string[] } {
  const { breaks, review } = compared(before, after)
  return { breaks: breaks.map(({ path, problem }) => `${path} ${problem}`), review }
}

/** The breaks and the generic signatures to review between two declaration files, compiled together in memory. */
function compared(before: string, after: string): { breaks: ApiBreak[]; review: string[] } {
  const files: Record<string, string> = { '/before.d.ts': before, '/after.d.ts': after }
  const options: ts.CompilerOptions = { strict: true, noEmit: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext }
  const host = ts.createCompilerHost(options)
  const read = host.getSourceFile.bind(host)
  host.getSourceFile = (name, language) => (name in files ? ts.createSourceFile(name, files[name]!, language) : read(name, language))
  host.fileExists = name => name in files || ts.sys.fileExists(name)
  const program = ts.createProgram(Object.keys(files), options, host)
  return apiBreaks(program.getTypeChecker(), program.getSourceFile('/before.d.ts')!, program.getSourceFile('/after.d.ts')!)
}

/** Whether `calls` compile against `declarations`, as tsc judges code written for the old version against the new one. */
function compiles(declarations: string, calls: string): boolean {
  const name = '/calls.ts'
  const options: ts.CompilerOptions = { strict: true, noEmit: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext }
  const host = ts.createCompilerHost(options)
  const read = host.getSourceFile.bind(host)
  host.getSourceFile = (file, language) => (file === name ? ts.createSourceFile(file, `${declarations}\n${calls}\n`, language) : read(file, language))
  host.fileExists = file => file === name || ts.sys.fileExists(file)
  const program = ts.createProgram([name], options, host)
  return ts.getPreEmitDiagnostics(program, program.getSourceFile(name)).length === 0
}

describe('apiBreaks', () => {
  it.each([
    ['an export removed', 'export declare const a: number; export declare const b: number', 'export declare const a: number', ['b is no longer exported']],
    ['an export renamed', 'export interface Options { a: number }', 'export interface Settings { a: number }', ['Options is no longer exported']],
    ['a member removed', 'export interface Meta { name: string; specificity: number[] }', 'export interface Meta { name: string }', ['Meta.specificity was removed']],
    ['a member made required', 'export interface Options { a?: number }', 'export interface Options { a: number }', ['Options.a was made required']],
    ['a member made readonly', 'export interface Options { a: number }', 'export interface Options { readonly a: number }', ['Options.a was made readonly']],
    ['a member narrowed', "export interface Options { mode: 'a' | 'b' }", "export interface Options { mode: 'a' }", ['Options.mode narrowed: "a" | "b" → "a"']],
    ['a parameter narrowed', 'export declare function f(a: string | number): void', 'export declare function f(a: string): void', ['f narrowed parameter a: string | number → string']],
    ['a return widened', 'export declare function f(): string', 'export declare function f(): string | undefined', ['f widened return: string → string | undefined']],
    ['an argument made required', 'export declare function f(a?: string): void', 'export declare function f(a: string): void', ['f requires 1 arguments where it required 0']],
    ['a parameter removed', 'export declare function f(a: string, b: number): void', 'export declare function f(a: string): void', ['f takes no argument b, which it took']],
    [
      'an overload removed',
      'export declare function f(a: string): string; export declare function f(a: number): number',
      'export declare function f(a: string): string',
      ['f has 1 call signatures where it had 2'],
    ],
    [
      'a method parameter narrowed',
      'export declare class Store { consume(key: string | number): void }',
      'export declare class Store { consume(key: string): void }',
      ['Store.consume narrowed parameter key: string | number → string'],
    ],
    [
      'a class member removed, with private members on both sides',
      'export declare class Registry { private items; get(id: string): number; all(): number[] }',
      'export declare class Registry { private items; get(id: string): number }',
      ['Registry.all was removed'],
    ],
    ['a type argument made required', 'export interface Box<T = string> { value: T }', 'export interface Box<T = string, U> { value: T; other: U }', ['Box requires 2 type arguments where it took 1']],
    [
      "a type parameter's constraint narrowed",
      'export declare function mock<T extends object>(kind: new () => T): T',
      'export declare function mock<T extends object & { send: unknown }>(kind: new () => T): T',
      ["mock narrowed type parameter T: extends object → extends object & { send: unknown; }"],
    ],
    [
      "a type's type parameter constraint narrowed",
      'export interface Box<T extends string | number> { value: T }',
      'export interface Box<T extends string> { value: T }',
      ['Box narrowed type parameter T: extends string | number → extends string'],
    ],
    ['a type parameter removed', 'export declare function f<A, B>(a: A, b: B): void', 'export declare function f<A>(a: A, b: unknown): void', ['f has 1 type parameters where it had 2']],
    ["a type parameter's default removed", 'export declare function f<T = string>(): T', 'export declare function f<T>(): T', ['f requires type parameter T, which had a default']],
  ])('fails on %s', (_, before, after, expected) => {
    expect(breaksBetween(before, after)).toEqual(expected)
  })

  it.each([
    ['an export added', 'export declare const a: number', 'export declare const a: number; export declare const b: string'],
    ['an optional member added', 'export interface Options { a: number }', 'export interface Options { a: number; b?: string }'],
    ['a member made optional', 'export interface Options { a: number }', 'export interface Options { a?: number }'],
    ['a union widened, as an option gains a value', "export interface Options { mode: 'a' }", "export interface Options { mode: 'a' | 'b' }"],
    ['a parameter widened', 'export declare function f(a: string): void', 'export declare function f(a: string | number): void'],
    ['a return narrowed', 'export declare function f(): string | undefined', 'export declare function f(): string'],
    ['an optional argument added', 'export declare function f(a: string): void', 'export declare function f(a: string, b?: number): void'],
    [
      'an overload appended',
      'export declare function f(a: string): string',
      'export declare function f(a: string): string; export declare function f(a: number): number',
    ],
    [
      'a class unchanged but for a new method, with private members',
      'export declare class Registry { private items; get(id: string): Registry }',
      'export declare class Registry { private items; get(id: string): Registry; size(): number }',
    ],
    ['a type argument added with a default', 'export interface Box<T> { value: T }', 'export interface Box<T, U = never> { value: T }'],
    ['an enum member added', 'export declare enum Kind { A = 0 }', 'export declare enum Kind { A = 0, B = 1 }'],
    [
      "a type parameter's constraint widened",
      'export declare function f<T extends string>(a: T): T',
      'export declare function f<T extends string | number>(a: T): T',
    ],
    ['a type parameter renamed', 'export declare function f<T extends string>(a: T): T[]', 'export declare function f<K extends string>(a: K): K[]'],
  ])('allows %s', (_, before, after) => {
    expect(breaksBetween(before, after)).toEqual([])
  })

  describe('generic signatures', () => {
    it('lists one whose parameters or return changed, by position, without failing it', () => {
      const result = compare(
        'export declare function get<T>(key: string, fallback: T): T',
        'export declare function get<K>(key: string, fallback: K): K | undefined',
      )

      expect(result).toEqual({ breaks: [], review: ['get: <T0>(key: string, fallback: T0) => T0 → <T0>(key: string, fallback: T0) => T0 | undefined'] })
    })

    it('lists an overload inserted before the others, and compares those it keeps as they were', () => {
      const result = compare(
        'export declare function make<T>(kind: T): T; export declare function make<T>(kind: T, name: string): T',
        'export declare function make<T>(kind: T): T; export declare function make<T>(kind: T, raw: true): T; export declare function make<T>(kind: T, name: string): T',
      )

      expect(result).toEqual({ breaks: [], review: ['make (overload 2 of 3): added <T0>(kind: T0, raw: true) => T0'] })
    })

    it('lists nothing for one unchanged but for its type parameters’ names', () => {
      expect(compare('export declare function f<T>(a: T): T[]', 'export declare function f<U>(a: U): U[]').review).toEqual([])
    })
  })

  describe('overloads: a changed signature is compared with the first new one that answers its calls', () => {
    // Each case's truth is tsc's: the old version's calls, compiled against the new declarations
    const CASES: [string, string, string, string, string[]?][] = [
      ['A1 gaining a required argument, a zero-argument overload ahead', 'export declare function f(a: string): string', 'export declare function f(): void; export declare function f(a: string, b: string): string', "const r: string = f('x')"],
      ['A2 an overload lost, another inserted ahead', 'export declare function f(a: string): string; export declare function f(a: number): number', 'export declare function f(a: boolean): boolean; export declare function f(a: string): string', 'const r: number = f(1)'],
      ['A3 a parameter narrowed, a zero-argument overload ahead', 'export declare function f(a: string | number): void', 'export declare function f(): void; export declare function f(a: string): void', 'f(1)'],
      ['A4 a return widened, an overload for another type ahead', 'export declare function f(a: string): string', 'export declare function f(a: number): number; export declare function f(a: string): string | undefined', "const r: string = f('x')"],
      ['A5 a method gaining a required argument, a params form ahead', 'export declare class T { l(key: string): string }', 'export declare class T { l<K extends string>(key: K, p: number): string; l(key: string, extra: string): string }', "declare const t: T; const r: string = t.l('k')"],
      ['A6 a generic gaining a required argument, a zero-argument overload ahead', 'export declare function f<T>(a: T): T', 'export declare function f(): void; export declare function f<T>(a: T, b: T): T', 'const r: number = f(1)'],
      ['A7 both overloads changed, the second narrowed', 'export declare function f(a: string): string; export declare function f(a: number | boolean): number', 'export declare function f(a: string, b?: 1): string; export declare function f(a: number, b?: 1): number', 'const r: number = f(true)'],
      ['A8 a parameter narrowed, a generic overload ahead that takes fewer arguments', 'export declare function f(a: string, b: number): string', 'export declare function f<T extends string>(a: T): string; export declare function f(a: string, b: boolean): string', "const r: string = f('x', 1)"],
      [
        'A9 a wider overload inserted ahead of a kept one, with another return',
        "export interface Narrow { kind: 'narrow' } export interface Wide { kind: string } export declare function f(a: string): Narrow",
        "export interface Narrow { kind: 'narrow' } export interface Wide { kind: string } export declare function f(a: string | number): Wide; export declare function f(a: string): Narrow",
        "const r: Narrow = f('x')",
      ],
      [
        'A10 the same as a method',
        "export interface Narrow { kind: 'narrow' } export interface Wide { kind: string } export declare class T { m(a: string): Narrow }",
        "export interface Narrow { kind: 'narrow' } export interface Wide { kind: string } export declare class T { m(a: string | number): Wide; m(a: string): Narrow }",
        "declare const t: T; const r: Narrow = t.m('x')",
      ],
      [
        'A11 a generic overload removed, which calls passing a type argument reach',
        'export declare function A<_R = unknown>(path: string, name?: string): (target: object) => void',
        'export declare function A(path: string, name?: string): (target: object) => void',
        "A<void>('x')",
      ],
      ['B1 a method made generic behind a params form', 'export declare class T { l(key: string): string }', 'export declare class T { l<K extends string>(key: K, p: number): string; l<K extends string>(key: K): string }', "declare const t: T; const r: string = t.l('k')", ['T.l: (key: string) => string → <T0 extends string>(key: T0) => string']],
      ['B2 made generic behind a zero-argument overload', 'export declare function f(a: string): string', 'export declare function f(): void; export declare function f<T extends string>(a: T): string', "const r: string = f('x')"],
      ['B3 both overloads made generic', 'export declare function f(a: string): string; export declare function f(a: number): number', 'export declare function f<T extends string>(a: T): string; export declare function f<T extends number>(a: T): number', "const r: string = f('x'); const n: number = f(1)", ['f (overload 1): (a: string) => string → <T0 extends string>(a: T0) => string', 'f (overload 2): (a: number) => number → <T0 extends number>(a: T0) => number']],
      ['B4 an optional argument added, an overload for another type ahead', 'export declare function f(a: string): string', 'export declare function f(a: number): number; export declare function f(a: string, b?: string): string', "const r: string = f('x')"],
      ['B5 a rest parameter ahead that takes the old arguments', 'export declare function f(a: string): string', 'export declare function f(...a: string[]): string; export declare function f(a: string, b: number): number', "const r: string = f('x')"],
      [
        'B6 a changed overload whose calls a kept one ahead still takes',
        "export declare function f(a: string): void; export declare function f(a: 'x'): void",
        "export declare function f(a: string): void; export declare function f(a: 'x', b: 1): void",
        "f('x')",
      ],
      [
        'B7 two changed overloads whose calls the first new one takes',
        "export declare function f(a: 'x'): string; export declare function f(a: string): string",
        "export declare function f(a: string, b?: 1): string; export declare function f(a: 'x', b?: 1): string",
        "const r: string = f('x'); const s: string = f('anything')",
      ],
      [
        'B9 a wider overload inserted ahead of one with a literal parameter, which TypeScript tries first',
        "export interface Narrow { kind: 'narrow' } export interface Wide { kind: string } export declare function f(a: 'x'): Narrow",
        "export interface Narrow { kind: 'narrow' } export interface Wide { kind: string } export declare function f(a: string | number): Wide; export declare function f(a: 'x'): Narrow",
        "const r: Narrow = f('x')",
      ],
      [
        'B8 an overload the one ahead already answered, unchanged',
        "export interface Narrow { kind: 'narrow' } export interface Wide { kind: string } export declare function f(a: string | number): Wide; export declare function f(a: string): Narrow",
        "export interface Narrow { kind: 'narrow' } export interface Wide { kind: string } export declare function f(a: string | number): Wide; export declare function f(a: string): Narrow",
        "const r: Wide = f('x')",
      ],
      [
        'A12 a parameter narrowed where another overload takes a subset of it',
        'export declare function f(a: string | number): void',
        'export declare function f(a: string): void; export declare function f(a: number, b: 1): void',
        'declare const a: string | number; f(a)',
      ],
      [
        'A13 a parameter split across two overloads, each taking one part',
        'export declare function g(a: string | number): void',
        'export declare function g(a: string): void; export declare function g(a: number): void',
        'declare const a: string | number; g(a)',
      ],
      [
        'A14 a type parameter added without a default, another overload inserted ahead',
        'export declare function f<T>(a: T): T',
        'export declare function f(a: string): string; export declare function f<T, U>(a: T): T',
        "f<string>('x')",
      ],
      ['A15 null dropped from a parameter', 'export declare function f(a: string | null): void', 'export declare function f(a: string): void', 'f(null)'],
      ['A16 undefined dropped from a required parameter', 'export declare function f(a: string | undefined): void', 'export declare function f(a: string): void', 'f(undefined)'],
      ['A17 null dropped from an optional parameter', 'export declare function f(a?: string | null): void', 'export declare function f(a?: string): void', 'f(null)'],
      ['A18 null dropped, a method', 'export declare class K { m(a: string | null): void }', 'export declare class K { m(a: string): void }', 'declare const k: K; k.m(null)'],
      ['A19 null dropped, an overload for another type ahead', 'export declare function f(a: string | null): void', 'export declare function f(a: number): void; export declare function f(a: string): void', 'f(null)'],
      ['A20 undefined dropped, an overload for another type ahead', 'export declare function f(a: string | undefined): void', 'export declare function f(a: number): void; export declare function f(a: string): void', 'f(undefined)'],
      ['A21 null dropped as the parameter is made generic', 'export declare function f(a: string | null): void', 'export declare function f<T extends string>(a: T): void', 'f(null)'],
      ['A22 a parameter narrowed to a constraint as it is made generic', 'export declare function f(a: string | number): void', 'export declare function f<T extends string>(a: T): void', 'f(1)'],
      [
        'A23 a wider overload inserted ahead of one with a union of literals, which TypeScript does not try first',
        "export interface Narrow { kind: 'narrow' } export interface Wide { kind: string } export declare function h(a: 'x' | 'y'): Narrow",
        "export interface Narrow { kind: 'narrow' } export interface Wide { kind: string } export declare function h(a: string): Wide; export declare function h(a: 'x' | 'y'): Narrow",
        "const r: Narrow = h('x')",
      ],
      [
        'A24 an argument no longer fitting a type parameter now typing its parameter, the old type spelling a type parameter as a literal',
        "export declare function f<T>(x: T, mode: 'T' | 'U'): void",
        "export declare function f<T, M extends 'U' = 'U'>(x: T, mode: M): void",
        "f(1, 'T')",
      ],
      [
        'A25 the same, the old type spelling a type parameter as a member',
        'export declare function f<T>(x: T, o: { T: string }): void',
        'export declare function f<T, O extends { T: number } = { T: number }>(x: T, o: O): void',
        "f(1, { T: 'a' })",
      ],
      [
        'A26 the same, the old type another type of the name of a type parameter',
        'export declare namespace Outer { interface U { a: string } } export declare function f<U>(x: U, y: Outer.U): void',
        'export declare namespace Outer { interface U { a: string } } export declare function f<U, V extends { b: number } = { b: number }>(x: U, y: V): void',
        "f(1, { a: 'x' })",
      ],
      [
        'A27 the same, the old type naming no type parameter',
        'export declare function f<T>(x: T, mode: string): void',
        "export declare function f<T, M extends 'U' = 'U'>(x: T, mode: M): void",
        "f(1, 'T')",
      ],
      [
        'B10 an optional argument taken by an optional parameter, another overload ahead',
        'export declare function f(a?: string): void',
        'export declare function f(a: number): void; export declare function f(a?: string, b?: number): void',
        "f(); f(undefined); f('x')",
      ],
      ['B11 a required argument that takes undefined made optional', 'export declare function f(a: string | undefined): void', 'export declare function f(a?: string): void', "f(undefined); f('x')"],
    ]

    it.each(CASES)('%s: fails exactly when the old calls stop compiling', (_, before, after, calls, review = []) => {
      expect(compiles(before, calls)).toBe(true)
      const result = compare(before, after)

      expect(result.breaks.length > 0).toBe(!compiles(after, calls))
      expect(result.review).toEqual(expect.arrayContaining(review))
    })

    it('names type parameters by position in a review line, and leaves a literal or a member spelling one as it is', () => {
      const before = "export declare function f<T>(x: T, mode: 'T' | 'U', o: { T: T }): T"
      const after = "export declare function f<U>(x: U, mode: 'T' | 'U', o: { T: U }): U | undefined"

      expect(compare(before, after).review).toEqual(['f: <T0>(x: T0, mode: "T" | "U", o: { T: T0; }) => T0 → <T0>(x: T0, mode: "T" | "U", o: { T: T0; }) => T0 | undefined'])
    })

    it('lists a generic signature whose literal changed, though the new literal spells the new type parameter as the old one spelled the old', () => {
      const before = "export declare function f<A>(x: A, m: 'A'): void"
      const after = "export declare function f<B>(x: B, m: 'B'): void"

      expect(compiles(after, "f(1, 'A')")).toBe(false)
      expect(compare(before, after).review).toEqual(['f: <T0>(x: T0, m: "A") => void → <T0>(x: T0, m: "B") => void'])
    })

    it('reports a type parameter added without a default where no signature takes the old calls', () => {
      const before = 'export declare function f<T>(a: T): T'
      const after = 'export declare function f<T, U>(a: T, b: U): T'

      expect(compare(before, after).breaks).toEqual(['f requires 2 arguments where it required 1', 'f requires 2 type arguments where it took 1'])
    })

    it('reports a parameter narrowed to the constraint of the type parameter now typing it', () => {
      const before = 'export declare function f(a: string | number): void'
      const after = 'export declare function f<T extends string>(a: T): void'

      expect(compare(before, after).breaks).toEqual(['f narrowed parameter a: string | number → T extends string'])
    })

    it('reports type arguments no signature takes against the signature the other calls reach', () => {
      const before = 'export declare function f<T>(a: T): T'
      const after = 'export declare function f(a: string): string; export declare function f<T, U>(a: T): T'

      expect(compare(before, after).breaks).toEqual(['f requires 2 type arguments where it took 1'])
    })

    it('lists nothing for a non-generic overload added ahead of a kept generic one, whose type arguments still reach it', () => {
      const before = 'export declare function A<_R = unknown>(path: string, name?: string): (target: object) => void'
      const after = `export declare function A(path: string, name?: string): (target: object) => void; ${before}`

      expect(compiles(after, "A('x'); A<void>('x')")).toBe(true)
      expect(compare(before, after)).toEqual({ breaks: [], review: [] })
    })

    it('lists nothing for a non-generic overload added ahead of a kept generic one, returning the same type under an alias', () => {
      const decorator = '<P, R>(target: object, descriptor: TypedPropertyDescriptor<(params: P) => R>) => void'
      const before = `export declare function A<_R = unknown>(path: string): ${decorator.replace('descriptor', '_descriptor')}`
      const after = `type Decorator = ${decorator}; export declare function A(path: string): Decorator; ${before}`

      expect(compiles(before, "const d: ReturnType<typeof A<void>> = A('x')")).toBe(true)
      expect(compiles(after, "const d: ReturnType<typeof A<void>> = A('x'); A<void>('x')")).toBe(true)
      expect(compare(before, after)).toEqual({ breaks: [], review: [] })
    })

    it('lists for review a non-generic overload added ahead of a kept generic one whose return no longer fits', () => {
      const types = "export interface Narrow { kind: 'narrow' } export interface Wide { kind: string }"
      const before = `${types} export declare function A<_R = unknown>(path: string): Narrow`
      const after = `${types} export declare function A(path: string): Wide; export declare function A<_R = unknown>(path: string): Narrow`

      expect(compiles(before, "const r: Narrow = A('x')")).toBe(true)
      expect(compiles(after, "const r: Narrow = A('x')")).toBe(false)
      expect(compare(before, after).review).toEqual(['A: <T0 = unknown>(path: string) => Narrow → (path: string) => Wide'])
    })

    it('lists for review a generic overload added ahead whose return names a type parameter of the same name in another place', () => {
      const before = 'export declare function f<T, U>(a: T, b: U): T'
      const after = `export declare function f<U, T, V>(a: U, b: T): T; ${before}`

      expect(compiles(before, "const r: string = f('x', 1); const s: string = f<string, number>('x', 1)")).toBe(true)
      expect(compiles(after, "const s: string = f<string, number>('x', 1)")).toBe(true)
      expect(compiles(after, "const r: string = f('x', 1)")).toBe(false)
      expect(compare(before, after).review).toContain('f: <T0, T1>(a: T0, b: T1) => T0 → <T0, T1, T2>(a: T0, b: T1) => T1')
    })

    it('lists only the generic overload requiring more type arguments added ahead of a kept one, which calls passing one skip', () => {
      const before = 'export declare function f<T>(a: T): T'
      const after = `export declare function f<T, U>(a: T): T; ${before}`

      expect(compiles(after, "const r: string = f('x'); const s: string = f<string>('x')")).toBe(true)
      expect(compare(before, after)).toEqual({ breaks: [], review: ['f (overload 1 of 2): added <T0, T1>(a: T0) => T0'] })
    })

    it('compares an unconstrained generic signature with itself, not with a concrete overload inserted ahead of it', () => {
      const before = 'export declare function f<T>(a: T): T'
      const after = 'export declare function f(a: string): string; export declare function f<T>(a: T): T'

      expect(compiles(after, 'const r: number = f(1)')).toBe(true)
      expect(compare(before, after)).toEqual({ breaks: [], review: [] })
    })

    it('reports a break once when two old overloads reach the same pair', () => {
      const types = "export interface Narrow { kind: 'narrow' } export interface Wide { kind: string }"
      const before = `${types} export declare function f(a: string): Narrow; export declare function f(a: 'x' | 'y'): Narrow`
      const after = `${types} export declare function f(a: string | number): Wide; export declare function f(a: string): Narrow; export declare function f(a: 'x' | 'y'): Narrow`

      expect(compiles(after, "const r: Narrow = f('x')")).toBe(false)
      expect(breaksBetween(before, after)).toEqual(['f (overload 1) widened return: Narrow → Wide'])
    })

    // Lenient against tsc: the inserted generic answers the old calls, and its return names its own type parameter,
    // which the checker cannot relate to the old return across two declarations
    it('lists for review, without failing, a generic inserted ahead of a kept signature, though the old calls stop compiling', () => {
      const before = 'export declare function g(a: string): string'
      const after = 'export declare function g<V>(a: V): V | undefined; export declare function g(a: string): string'
      const result = compare(before, after)

      expect(compiles(after, "const r: string = g('x')")).toBe(false)
      expect(result).toEqual({
        breaks: [],
        review: ['g (overload 1 of 2): added <T0>(a: T0) => T0 | undefined', 'g: (a: string) => string → <T0>(a: T0) => T0 | undefined'],
      })
    })
  })

  describe('type parameters', () => {
    // Each case: the declarations before and after, code written against the old ones, and the breaks expected
    const CASES: [string, string, string, string, string[]][] = [
      ['a function gaining one without a default', 'export declare function f<T>(a: T): T', 'export declare function f<T, U>(a: T): T', "f<string>('x')", ['f requires 2 type arguments where it took 1']],
      [
        'a method gaining one without a default',
        'export declare class K { m<T>(a: T): T }',
        'export declare class K { m<T, U>(a: T): T }',
        "declare const k: K; k.m<string>('x')",
        ['K.m requires 2 type arguments where it took 1'],
      ],
      ['an interface gaining one without a default', 'export interface Box<T> { v: T }', 'export interface Box<T, U> { v: T }', 'declare const b: Box<string>', ['Box requires 2 type arguments where it took 1']],
      ['a type alias gaining one without a default', 'export type A<T> = { v: T }', 'export type A<T, U> = { v: T }', 'declare const a: A<string>', ['A requires 2 type arguments where it took 1']],
      [
        'a class gaining one without a default, reported once',
        'export declare class C<T> { constructor(a: T) }',
        'export declare class C<T, U> { constructor(a: T) }',
        "declare const c: C<string>; new C<string>('x')",
        ['C requires 2 type arguments where it took 1'],
      ],
      ['a function made generic, its calls inferring the type argument', 'export declare function f(a: string): string', 'export declare function f<T extends string>(a: T): string', "f('x')", []],
      [
        'a method made generic, its calls inferring the type argument',
        'export declare class K { m(a: string): string }',
        'export declare class K { m<T extends string>(a: T): string }',
        "declare const k: K; k.m('x')",
        [],
      ],
      [
        'a class made generic, which a type reference without arguments no longer names',
        'export declare class C { constructor(a: string) }',
        'export declare class C<T> { constructor(a: T) }',
        "declare const c: C; new C('x')",
        ['C requires 1 type arguments where it took 0'],
      ],
      [
        "a class's constraint narrowed, reported once",
        'export declare class C<T extends string | number> { constructor(a: T) }',
        'export declare class C<T extends string> { constructor(a: T) }',
        'new C<number>(1)',
        ['C narrowed type parameter T: extends string | number → extends string'],
      ],
      [
        'a class losing a default, reported once',
        'export declare class C<T = string> { constructor(a: T) }',
        'export declare class C<T> { constructor(a: T) }',
        'declare const c: C',
        ['C requires type parameter T, which had a default'],
      ],
      [
        'a class losing one, reported once',
        'export declare class C<T, U> { constructor(a: T) }',
        'export declare class C<T> { constructor(a: T) }',
        'declare const c: C<string, number>',
        ['C has 1 type parameters where it had 2'],
      ],
      ['one losing its default as another is added with one', 'export type A<T = string> = { v: T }', 'export type A<T, U = string> = { v: T }', 'declare const a: A', ['A requires type parameter T, which had a default']],
      [
        'two reordered, the constrained one first',
        'export type A<T, U extends string> = { u: U; t: T }',
        'export type A<U extends string, T> = { u: U; t: T }',
        "declare const a: A<number, 'x'>",
        ['A narrowed type parameter T: extends unknown → extends string'],
      ],
      ['a function gaining one with a default', 'export declare function f<T>(a: T): T', 'export declare function f<T, U = string>(a: T): T', "f<string>('x')", []],
      ['a method gaining one with a default', 'export declare class K { m<T>(a: T): T }', 'export declare class K { m<T, U = string>(a: T): T }', "declare const k: K; k.m<string>('x')", []],
      ['an interface gaining one with a default', 'export interface Box<T> { v: T }', 'export interface Box<T, U = string> { v: T }', 'declare const b: Box<string>', []],
      ['a type alias gaining one with a default', 'export type A<T> = { v: T }', 'export type A<T, U = string> = { v: T }', 'declare const a: A<string>', []],
      [
        'a class gaining one with a default',
        'export declare class C<T> { constructor(a: T) }',
        'export declare class C<T, U = string> { constructor(a: T) }',
        "declare const c: C<string>; new C<string>('x')",
        [],
      ],
    ]

    it.each(CASES)('%s: reports exactly what stops the old code compiling', (_, before, after, uses, expected) => {
      expect(compiles(before, uses)).toBe(true)
      expect(compiles(after, uses)).toBe(expected.length === 0)
      expect(compare(before, after).breaks).toEqual(expected)
    })
  })
})

describe('judgeBreaks', () => {
  /** What the allowlist leaves to refuse when it names the one break between two declaration files. */
  function judged(before: string, after: string, major: boolean) {
    const breaks = compared(before, after).breaks.map(found => ({ ...found, id: `core ${found.path}`, file: 'dist/types/core/index.d.ts' }))
    expect(breaks).toHaveLength(1)
    const { unlisted, stale, majorOnly } = judgeBreaks(breaks, { [breaks[0]!.id]: { reason: 'Deliberate.' } }, major, '4.2.3')
    return [...unlisted.map(({ id }) => id), ...stale, ...majorOnly]
  }

  const removal = ['export interface Meta { name: string; specificity: number[] }', 'export interface Meta { name: string }'] as const

  it.each([
    ['a narrowed member type in a patch', "export interface State { readonly items: readonly unknown[] }", 'export interface State { readonly items: readonly string[] }', false, []],
    ['a removed member in a major', ...removal, true, []],
    ['a removed member in a patch', ...removal, false, ['core Meta.specificity']],
    ['a narrowed parameter in a patch', 'export declare function f(a: string | number): void', 'export declare function f(a: string): void', false, ['core f']],
  ])('judges an allowlist entry for %s', (_, before, after, major, refused) => {
    expect(judged(before, after, major)).toEqual(refused)
  })

  describe("by the entry's version and the baseline", () => {
    // The narrowing 4.2.3 shipped: once 4.2.3 was the baseline its entry named a break no longer there (#922)
    const id = 'decorator MeoCordOptions.controllers'
    const narrowing = { id, file: 'dist/types/decorator/index.d.ts', path: 'MeoCordOptions.controllers', problem: 'narrowed: unknown[] → object[]' }

    it.each([
      ['retires an entry its baseline ships', [], '4.2.3', '4.2.3', { unlisted: [], allowed: [], stale: [], retired: [id] }],
      ['allows nothing by a retired entry, so a break the baseline lacks is refused', [narrowing], '4.2.3', '4.2.3', { unlisted: [id], allowed: [], stale: [], retired: [id] }],
      ['allows an entry no release has stamped', [narrowing], undefined, '4.2.3', { unlisted: [], allowed: [id], stale: [], retired: [] }],
      ['allows an entry the release pull request stamped', [narrowing], '4.2.4', '4.2.3', { unlisted: [], allowed: [id], stale: [], retired: [] }],
      ['refuses an unreleased entry that names no break', [], '4.2.4', '4.2.3', { unlisted: [], allowed: [], stale: [id], retired: [] }],
      ['refuses an unstamped entry that names no break', [], undefined, '4.2.3', { unlisted: [], allowed: [], stale: [id], retired: [] }],
      ['keeps a prerelease entry while its stable release is unpublished', [narrowing], '4.3.0-beta.1', '4.2.3', { unlisted: [], allowed: [id], stale: [], retired: [] }],
      ['retires a prerelease entry once its stable release is the baseline', [], '4.3.0-beta.1', '4.3.0', { unlisted: [], allowed: [], stale: [], retired: [id] }],
      ['keeps an entry while an older line publishes a hotfix', [narrowing], '4.2.4', '4.0.9', { unlisted: [], allowed: [id], stale: [], retired: [] }],
    ])('%s', (_, breaks, version, baseline, expected) => {
      const { unlisted, allowed, stale, retired } = judgeBreaks(breaks, { [id]: { reason: 'Deliberate.', ...(version && { version }) } }, false, baseline)
      expect({ unlisted: unlisted.map(entry => entry.id), allowed: [...allowed], stale, retired }).toEqual(expected)
    })
  })
})
