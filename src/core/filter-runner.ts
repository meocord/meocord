import 'reflect-metadata'
import { type Container } from 'inversify'
import { type ExceptionFilter } from '@src/interface/index.js'
import { type ExecutionContext } from '@src/common/execution-context.js'
import { perHandler, sourcePrototype, stageClasses } from '@src/core/guard-runner.js'
import { bindShared } from '@src/core/interceptor-runner.js'
import { refuse } from '@src/util/refusal.util.js'

export type FilterClass = new (...args: any[]) => ExceptionFilter

/** A filter class, and the params its `ExecutionContext.getParams()` returns. */
export interface FilterWithParams {
  provide: FilterClass
  params?: Record<string, any>
}

export type FilterEntry = FilterClass | FilterWithParams

/** A context that can carry one filter's params. */
export type FilterContext = ExecutionContext & {
  withParams(params: Record<string, unknown> | undefined): ExecutionContext
}

function filterClass(entry: FilterEntry): FilterClass {
  return typeof entry === 'object' ? entry.provide : entry
}

/** Private metadata: the error types a filter's `@Catch` names; empty to catch everything. */
export const CATCH_TYPES = Symbol('catch_types')

/** Private metadata: the filters a class-level `@UseFilter` applies, on the class. */
export const CLASS_FILTERS = Symbol('class_filters')

/** Private metadata: the filters a method-level `@UseFilter` applies, on the method. */
export const METHOD_FILTERS = Symbol('method_filters')

/**
 * A handler's filters by level, the level closest to the handler first: the method's, then the
 * classes' from the one declaring the handler down to the controller, then the global ones.
 */
export function handlerFilterLevels(
  prototype: object,
  methodName: string,
  globals: readonly FilterEntry[],
): FilterEntry[][] {
  const { method, classes } = ownFilterLevels(prototype, methodName)
  return [[...method], [...classes], [...globals]]
}

/** A handler's method and class filters, the classes innermost first, resolved once. */
const ownFilterLevels = perHandler((prototype: object, methodName: string) => {
  const source = sourcePrototype(prototype, methodName)
  if (!source) return { method: [] as FilterEntry[], classes: [] as FilterEntry[] }
  return {
    method: (Reflect.getOwnMetadata(METHOD_FILTERS, source, methodName) as FilterEntry[]) ?? [],
    classes: [...stageClasses(prototype, methodName)]
      .reverse()
      .flatMap(cls => (Reflect.getOwnMetadata(CLASS_FILTERS, cls) as FilterEntry[]) ?? []),
  }
})

/** Binds a filter as a singleton, after checking it is one. */
export function prepareFilter(container: Container, entry: FilterEntry): void {
  const cls = filterClass(entry)
  if (!Reflect.hasOwnMetadata(CATCH_TYPES, cls)) {
    throw refuse(new Error(`${cls.name || 'A filter'}: used as an exception filter, but not decorated with @Catch().`))
  }
  bindShared(container, cls)
}

/** The first filter, level by level, whose `@Catch` matches `error`. */
export function matchFilter(levels: readonly (readonly FilterEntry[])[], error: unknown): FilterEntry | undefined {
  for (const level of levels) {
    for (const entry of level) {
      // Every filter reaching here was checked for @Catch at startup, so its types are always recorded
      const types = Reflect.getOwnMetadata(CATCH_TYPES, filterClass(entry)) as (abstract new (...args: any[]) => unknown)[]
      if (types.length === 0 || types.some(type => error instanceof type)) return entry
    }
  }
  return undefined
}

/** Runs one filter on `error`, with the context carrying the filter's params. */
export async function callFilter(
  entry: FilterEntry,
  container: Container,
  context: FilterContext,
  error: unknown,
): Promise<void> {
  const cls = filterClass(entry)
  prepareFilter(container, entry)
  const filter = container.get<ExceptionFilter>(cls)
  if (typeof filter.catch !== 'function') {
    throw new Error(`Filter ${cls.name} does not have a valid catch method.`)
  }
  await filter.catch(error, context.withParams(typeof entry === 'object' ? entry.params : undefined))
}
