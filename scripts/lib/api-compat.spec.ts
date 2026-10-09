import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { apiBreaks } from './api-compat.js'

/** The breaks between two declaration files, compiled together in memory as the check compiles the real ones. */
function breaksBetween(before: string, after: string): string[] {
  const files: Record<string, string> = { '/before.d.ts': before, '/after.d.ts': after }
  const options: ts.CompilerOptions = { strict: true, noEmit: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext }
  const host = ts.createCompilerHost(options)
  const read = host.getSourceFile.bind(host)
  host.getSourceFile = (name, language) => (name in files ? ts.createSourceFile(name, files[name]!, language) : read(name, language))
  host.fileExists = name => name in files || ts.sys.fileExists(name)
  const program = ts.createProgram(Object.keys(files), options, host)
  return apiBreaks(program.getTypeChecker(), program.getSourceFile('/before.d.ts')!, program.getSourceFile('/after.d.ts')!).map(
    ({ path, problem }) => `${path} ${problem}`,
  )
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
  ])('allows %s', (_, before, after) => {
    expect(breaksBetween(before, after)).toEqual([])
  })
})
