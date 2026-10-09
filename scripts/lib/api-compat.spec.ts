import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { apiBreaks } from './api-compat.js'

/** The breaks between two declaration files, compiled together in memory as the check compiles the real ones. */
function breaksBetween(before: string, after: string): string[] {
  return compare(before, after).breaks
}

/** The breaks and the generic signatures to review between two declaration files, compiled together in memory. */
function compare(before: string, after: string): { breaks: string[]; review: string[] } {
  const files: Record<string, string> = { '/before.d.ts': before, '/after.d.ts': after }
  const options: ts.CompilerOptions = { strict: true, noEmit: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext }
  const host = ts.createCompilerHost(options)
  const read = host.getSourceFile.bind(host)
  host.getSourceFile = (name, language) => (name in files ? ts.createSourceFile(name, files[name]!, language) : read(name, language))
  host.fileExists = name => name in files || ts.sys.fileExists(name)
  const program = ts.createProgram(Object.keys(files), options, host)
  const { breaks, review } = apiBreaks(program.getTypeChecker(), program.getSourceFile('/before.d.ts')!, program.getSourceFile('/after.d.ts')!)
  return { breaks: breaks.map(({ path, problem }) => `${path} ${problem}`), review }
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
})
